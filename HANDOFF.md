# Bobcat Plus — AI Scheduler Handoff

You are picking up the `LLM-algorithm` branch of a Chrome extension that scrapes
Texas State's Banner + DegreeWorks and lets students build a weekly schedule
with AI help. Read `CLAUDE.md` first for the broader project context. This
doc covers only the AI scheduler pipeline (`extension/scheduleGenerator.js`)
and the known problems left to solve.

---

## Architecture (v3 hybrid)

One function — `BP.handleUserTurn({ userMessage, rawData, studentProfile, ... })`
— runs a 5-stage pipeline:

```
[ userMessage ]
      │
      ▼
┌────────────────────────┐
│ 1. Intent LLM          │  gpt-4o-mini, temp 0
│    callIntent()        │  Returns frozen IntentSchema v1:
│                        │    { intent, confidence, recap,
│                        │      newCalendarBlocks, newAvoidDays,
│                        │      removeAvoidDays, resetAvoidDays,
│                        │      statedPreferences { noEarlierThan,
│                        │        noLaterThan, targetCredits,
│                        │        careerKeywords, *Weights }, ... }
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 1b. calibrateIntent-   │  Deterministic post-processor. Scans the
│     Weights()          │  raw message for hedge ("preferably"…) or
│                        │  hard ("cannot"/"never"…) language near
│                        │  each weight field and caps at 0.7 or
│                        │  floors at 1.0. Rescues LLM miscalibration.
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 2. Context recap       │  Surfaced to the student immediately
│    (UI action)         │  so misreads are caught in <1s.
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 3. Affinity LLM        │  Scores each eligible course 0-1 for
│    callAffinity()      │  career-goal fit. Skipped when no career
│                        │  keywords. Cached per (eligibleHash,
│                        │  careerKeywords). Cache is WIPED at the
│                        │  top of each turn to prevent cross-turn
│                        │  bias — see handleUserTurn().
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 4. CSP solver          │  solveMulti() runs 4 orderings (MRV,
│    (deterministic)     │  reverse-MRV, 2 seeded shuffles) and
│                        │  pools dedup'd results. Hard constraints
│                        │  (calendarBlocks, hardAvoidDays, creditCap,
│                        │  lab pairing) NEVER violated. Max 2000
│                        │  results / 200k nodes — see SOLVER_*_CAP.
│                        │
│    solveWithRelaxation │  If 0 results, relax softly in order:
│                        │    1. morning cutoff  (if weight < 1.0)
│                        │    2. late cutoff     (if weight < 1.0)
│                        │    3. soft avoid days
│                        │    4. credit band widening
│                        │    5. online preference
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 5. Ranking             │  scoreSchedule() emits metrics for each
│    pickTop3()          │  feasible schedule; applyVector() combines
│                        │  them via 3 different weight vectors
│                        │  (affinity / online / balanced).
│                        │  Top-3 uses tiered Jaccard dedup on
│                        │  course sets — identical coursesets are
│                        │  rejected even across orderings.
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 6. Rationale LLM       │  callRationales() — grounded 2-sentence
│                        │  explanation per schedule, passed ONLY
│                        │  structured facts (no invention).
└──────────┬─────────────┘
           │
           ▼
     [ actions[] → tab.js ]
```

### Why this shape

- **LLM for understanding, deterministic for constraints.** The LLM is
  good at parsing ambiguous English but bad at respecting hard rules. The
  CSP solver guarantees no time conflicts and no violated hard constraints.
- **Frozen schema, post-processing for calibration.** The intent schema
  version is pinned (`INTENT_SCHEMA_VERSION`). When the LLM miscalibrates a
  weight ("preferably" → 0.9), the deterministic calibrator corrects it in
  code — no prompt-engineering battles.
- **Defense in depth.** After the solver runs, `validateSchedule()` checks
  every top schedule against calendarBlocks and course conflicts. Should
  never fire, but catches data-quality bugs (sections with bad meeting data).

### File boundaries

| File | Role |
|---|---|
| `extension/scheduleGenerator.js` | The whole AI pipeline, plain script, attaches to `window.BP`. No ESM. |
| `extension/tab.js` | UI. Consumes `handleUserTurn`, processes the actions[] array. |
| `extension/tab.html` / `tab.css` | Shell + styles. |
| `extension/background.js` | Scrapes Banner + DegreeWorks. **Don't touch** unless fixing scrape bugs. |
| `tests/intent-fixture.js` | Node runner. Property-test assertions (not exact match) against 5 student prompts. `OPENAI_API_KEY=... node tests/intent-fixture.js`. |

---

## Known problems (in rough priority)

### 1. Schedule variety is still homogeneous

**Symptom:** When a student gives no preferences and says "build me a schedule",
all three returned schedules look nearly identical — same CS core, differing
only in one elective and lab section. User wants each of the three to be an
*archetype*:
- Schedule A: evenly spread across 5 days
- Schedule B: compressed into Tue/Thu
- Schedule C: all-mornings or all-afternoons

**Root cause:** The three weight vectors (affinity / online / balanced)
converge when the student is silent. With no career keywords, `affinityNorm`
is 0.5 uniformly. With no online preference, `onlineRatio` barely moves.
Only `balance` meaningfully differentiates — and balance rewards spread, so
all three schedules trend toward MWF+TR mixes.

**Suggested fix:** Replace the current 3 weight vectors with 3 *archetype
scorers* that actively penalize schedules that don't match their shape:

```js
const ARCHETYPES = {
  spread:     { daysUsedBonus: 1.0,  compactnessPenalty: 0 },
  compact:    { daysUsedBonus: -1.0, compactnessPenalty: 0 },  // prefers ≤2 days
  allMorning: { afternoonPenalty: 1.0 },
  allAfternoon: { morningPenalty: 1.0 },
};
```

Pick any 3 archetypes that look meaningfully different given the eligible
pool (e.g., skip `compact` if only 1 Tue/Thu schedule is feasible). Fallback
is the current vectors.

### 2. `noLaterThan` was not enforced — partially fixed in 8e49fa8

**Symptom:** "Done by 5pm every day" got ignored; schedule included a 5-6:20pm
class. Root cause: the intent schema had `noLaterThan` but no scorer /
solver code consulted it. A late-cutoff penalty is now wired into
`scoreSchedule` / `applyVector`, a relaxation step for it, honored/unhonored
rendering, and a calibrator entry for "done by"/"finish by"/"out by"
language.

**Still to verify:** the intent LLM reliably extracts the time from "done by
5pm" into `noLaterThan: "1700"`. If you find it misses, tighten the prompt
example in `buildIntentPrompt()`.

### 3. Section-level preference handling

**Symptom:** "I don't like early mornings" + CS 4371 has sections at
Tue/Thu 9:30am (11 seats) and Tue/Thu 12:30pm (13 seats) — solver picked
9:30. The scorer's `morningPenalty` only fires if the LLM set
`noEarlierThan` to a specific time. For fuzzy "don't like early mornings"
with no specific cutoff, there's no penalty.

**Suggested fix:** When `morningCutoffWeight > 0` but `noEarlierThan` is
null, apply a soft monotonic penalty proportional to how early the class
starts (e.g., `(960 - startMinutes) / 240` capped at 1.0 so anything before
8am eats a full unit). Similar for late end.

### 4. `removeAvoidDays` / `resetAvoidDays` reliability

**Symptom:** Intent LLM sometimes fails to emit `resetAvoidDays: true` when
the student's next message implies it ("now make me one that just has no
classes on Friday" after a prior "only Tue/Thu"). Schema and orchestrator
support this; the LLM just doesn't always recognize the reset cue.

**Suggested fix:** Either tighten the prompt examples (cheap, try first) or
add a deterministic detector: if the user's message contains "just" / "now"
/ "actually" / "instead" AND introduces a new day preference, force
`resetAvoidDays: true` even if the LLM said false.

### 5. Affinity over-generalization

**Symptom:** Student says "I need a science course" → intent LLM expands
career to include biology, student gets BIO ★0.90 badges even though they
expressed no biology interest. Career cache is already wiped per-turn (see
handleUserTurn), but the expansion within a single turn is too aggressive.

**Suggested fix:** Tighten the `CAREER KEYWORD EXPANSION` section in
`buildIntentPrompt()` to require *explicit* career language ("want to work
in", "career in", "interested in") before expanding. Generic requirement
talk ("need a science course") should leave `careerKeywords: []`.

### 6. Advisor summary feature (requested, never built)

The user asked for a feature that extracts insights from conversation
history + final schedule and produces a structured markdown block for an
advising session:
- "Student snapshot" — career direction, hard constraints, open questions
- "Proposed schedule" — courses + CRNs
- "For the advisor to address" — unmet requirements, prereq gaps, ambiguous
  career signals

Scope: one gpt-4o call at temp 0.3, strict JSON in + markdown out,
exportable as PDF or clipboard. Estimated ~100 LOC + a button in the chat
panel.

---

## Debugging recipes

- **See the trace UI:** there's a collapsible "Thinking · N steps" block in
  the chat. Each stage emits trace entries; click to expand.
- **Run the intent fixture:** `OPENAI_API_KEY=sk-... node tests/intent-fixture.js`
  — 5 prompts, property assertions, fast feedback on prompt regressions.
- **Isolate ranking from solver:** in devtools on the tab page, call
  `BP.scoreSchedule(result, preferences, affinityScores)` directly with a
  stub — the scorer is pure.
- **Inspect relaxations:** the actions array includes a
  `show_relaxation_notice` action listing what was dropped. If a student
  asked for "no mornings" and didn't get them, check whether the
  morning-cutoff relaxation fired (it's the first one).

---

## Don't break these

- **`withSessionLock` in background.js.** Banner registration is stateful;
  parallel POSTs corrupt each other. See CLAUDE.md's "Session mutex" section.
- **`INTENT_SCHEMA_VERSION`.** The schema is frozen. If you change shape
  (add/remove a field), bump the version and update every consumer.
- **Affinity cache wipe in handleUserTurn.** Without it, career keywords
  from a prior turn silently bias the next.
- **Jaccard tiered dedup in pickTop3.** Don't simplify it back to section-
  signature-only; that regresses the "same courses, different lab" bug.

---

## Recent commit history (branch: LLM-algorithm)

- `8e49fa8` — Enforce noLaterThan in scorer + calibrator (this handoff)
- `88dcdce` — Positive day framing + avoid-day removal/reset
- `62722e2` — Fix day-balance scorer + Jaccard<1.0 fallback tier
- `dfe2da6` — × button on 'Kept clear' tag to remove avoid-days
- `6394f16` — Weight calibration + transparency for unhonored constraints
- `3e1ece2` — Reset career-signal cache per turn
- `876b777` — Intent-only golden fixture
- `e7148a9` — Online-courses bar below the calendar
- `a0c3037` — Silence chat noise when adding/locking a schedule
- `a4b27d7` — Friday overlay + Clear All button + badge copy
- `bea63cb` — Lab pairing + credit hour accuracy

See `git log LLM-algorithm ^main` for the full diff from `main`.
