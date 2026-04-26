# Forward Planner — design note

**Status:** ⬜ *Open. RFC; not implemented.* Owns the multi-semester planning
surface ("when do I graduate, what do I take when, what if I change pace").
Pairs with `[course-catalog.md](course-catalog.md)` (the data layer it consumes)
and `[grad-tracker.md](grad-tracker.md)` (the cheap MVP that ships before this).

**Scope boundary.** This doc designs the *planner*: the thing that takes a
RequirementGraph + completed coursework + a course catalog + planning
preferences and returns a Plan (sequence of term slates). It does **not** design
single-term section selection (that is the existing `scheduler/solver/`*
pipeline) and it does **not** design the requirement parser
(`[requirement-graph.md](requirement-graph.md)`). It consumes both.

**Why this doc exists before the catalog one.** The planner's needs constrain
the catalog's shape. Specifically: the planner is a hot loop that re-runs on
every UX interaction (slider drag, pin, override). It cannot tolerate network
fetches in that loop. That hard constraint forces the catalog to be in-memory
and pre-loaded — a decision that cascades into bundling, versioning, and
refresh strategy. So: planner first, catalog second.

---

## 1. What this produces

A `Plan` is the output of the planner. It is the central data structure of
this layer.

```ts
interface Plan {
  terms: TermSlate[];               // ordered, oldest first
  unscheduled: PlannedCourse[];     // requirements with no assigned term (planner gave up or user pinned to "later")
  graduationTerm: TermCode | null;  // null when infeasible under current constraints
  totalCreditsPlanned: number;
  totalCreditsRemaining: number;    // before this plan, after applied[]
  satisfaction: SatisfactionTable;  // many-to-many: which rule(s) each course satisfies
  warnings: PlanWarning[];          // soft signals (low-confidence seasonality, etc.)
  infeasibilities: Infeasibility[]; // hard signals (no offering predicted, prereq cycle)
  meta: PlanMeta;                   // pace, generation timestamp, planner version
}

interface TermSlate {
  termCode: TermCode;               // "202610" = Fall 2026, etc. (Banner format)
  season: "fall" | "spring" | "summer";
  courses: PlannedCourse[];
  creditCap: number;                // user-set or default-pace; honored as hard upper bound
  creditsPlanned: number;           // sum over courses
  isSummer: boolean;
  isPinned: boolean;                // true if user explicitly created/locked this slate
  notes: string[];                  // surfaced-to-UI annotations ("over cap," etc.)
}

interface PlannedCourse {
  course: CourseRef;                // {discipline, number}
  credits: number;                  // pulled from CourseCatalog
  satisfiesRules: string[];         // ruleId[] from RequirementGraph (many-to-many)
  pinnedToTerm: TermCode | null;    // user-locked
  reasonAdded: "required" | "elective-fill" | "user-pin" | "minor-add";
  confidence: ConfidenceLevel;      // composite of seasonality + prereq-cert
}

type ConfidenceLevel = "high" | "medium" | "low";

interface PlanWarning {
  kind: "seasonality-low-confidence" | "course-not-recently-offered" | "approaching-cap" | "overlap-with-other-program";
  termCode?: TermCode;
  course?: CourseRef;
  message: string;
}

interface Infeasibility {
  kind: "no-offering-window" | "prereq-cycle" | "credit-cap-too-low" | "graduation-window-exceeded";
  message: string;
  involves: CourseRef[];
}

interface SatisfactionTable {
  // courseKey -> ruleId[] (which RequirementGraph leaves this course covers)
  byCourse: Map<CourseKey, string[]>;
  // ruleId -> { satisfied: bool, by: CourseRef[] }
  byRule: Map<string, { satisfied: boolean; by: CourseRef[] }>;
}

interface PlanMeta {
  paceCredits: number;
  allowSummer: boolean;
  generatedAt: string;              // ISO timestamp
  plannerVersion: string;
  catalogVersion: string;           // pinned at plan time so re-renders reproduce
  studentSnapshot: { applied: number; inProgress: number; remaining: number };
}

type TermCode = string;             // Banner format, "YYYYTT" (e.g. "202610")
type CourseKey = string;            // "DISC|NNNN" (e.g. "MATH|2417")
type CourseRef = { discipline: string; number: string };
```

The `Plan` is **immutable per generation**. A user interaction (slider, pin,
override) produces a new `Plan` rather than mutating the old one — same
contract as the existing single-term solver returning fresh schedules. This
keeps undo/redo trivial and the React-style render loop simple.

---

## 2. Inputs

```ts
interface PlannerInput {
  graph: RequirementGraph;          // from requirement-graph.md (per-student, per-catalog-year)
  applied: AppliedCourse[];         // already on the audit (completed + in-progress)
  catalog: CourseCatalog;           // from course-catalog.md (bundled + refreshed)
  preferences: PlanningPreferences;
  pins: PinnedAssignment[];         // user-set: "BIO 2430 in Fall 2026"
  overrides: TermOverride[];        // user-set: "Spring 2027 max 12 credits"
  knownTerms: TermCode[];           // start at next-registerable, extend forward enough to graduate
}

interface PlanningPreferences {
  paceCredits: number;              // target avg credits/term (default 15)
  allowSummer: boolean;             // default false
  preferGraduateBy?: TermCode;      // soft target; planner warns if missed
  fillElectives: "balanced" | "front-load" | "back-load";
  honorMinorAddSuggestions: boolean; // proactive minor surfacing on/off
}

interface PinnedAssignment {
  course: CourseRef;
  termCode: TermCode;
  reason?: string;                  // optional user note
}

interface TermOverride {
  termCode: TermCode;
  creditCap?: number;
  excludeCourses?: CourseRef[];     // "don't put X in this term"
  requireCourses?: CourseRef[];     // "X must be in this term" (similar to pin but slate-scoped)
}
```

`PlanningPreferences` are user-facing settings. `pins` and `overrides` are
the result of UX interactions (clicking a course → "lock to this term," etc.).

---

## 3. The algorithm — heuristic search, not CSP

The single-term solver
(`[scheduler/solver/solver.js](../../extension/scheduler/solver/solver.js)`)
uses CSP backtracking with a 200k-node cap. That works because it's choosing
~5 sections out of ~200 candidates. The forward planner has a different shape:
~30-40 courses to place across ~6-10 terms, with prereq orderings and
seasonality constraints. CSP backtracking on this state space is exponential
and does not return in interactive time.

**Use heuristic search.** Two phases:

### Phase A — Greedy seeding by prereq depth

1. Build the **course requirement set** — every CourseQuantifiedNode and
  CourseSlotNode leaf in the graph that is not yet satisfied. Deduplicate
   across many-to-many (a single concrete course only enters once).
2. For each candidate course, compute its **prereq depth** in the catalog's
  prereq DAG. A course with no prereqs has depth 0; a course requiring it
   has depth 1; etc.
3. Topologically sort by depth (ties broken by: pinned > catalog seasonality
  restrictions > credit weight).
4. Walk terms forward starting at `knownTerms[0]`. For each term:
  - Honor any `pins` for that term first.
  - Honor any `requireCourses` from `overrides` next.
  - Greedily fill with the lowest-depth courses whose prereqs are already
  satisfied (in `applied[]` or scheduled in earlier terms in the plan).
  - Stop adding when `creditsPlanned >= creditCap` for that term, or no more
  prereq-satisfied courses remain.
5. If a course can't be placed (no future term satisfies its prereqs +
  seasonality + cap), record an `Infeasibility` and continue.

### Phase B — Local-search improvement

The greedy seed is correct but not optimal. Two transformations refine it:

1. **Pull-forward swaps.** For each course in term T, attempt to move it to
  T-1 if T-1 has cap headroom and the move doesn't break prereqs. Accept
   moves that reduce graduation term. This shrinks the plan.
2. **Distribution swaps.** For each pair of terms (T, T+1), if T is over its
  target pace and T+1 is under, swap one course between them if prereqs
   allow. This evens out load.

Iterate Phase B until no improvement in one pass (typically 2-3 passes on a
30-course plan).

### Why not pure CSP


| Approach                              | Time on 30-course/8-term plan | Optimal?                           |
| ------------------------------------- | ----------------------------- | ---------------------------------- |
| CSP backtracking with all constraints | minutes-hours                 | yes                                |
| Greedy by prereq depth                | <100ms                        | no, but close                      |
| Greedy + 2-opt local search           | <500ms                        | within 5% of optimal in benchmarks |
| Greedy + simulated annealing          | <2s                           | very close to optimal              |


The 2-opt heuristic returns within 5% of the CSP optimum on academic
scheduling benchmarks (this is a well-studied problem). The remaining gap is
not user-perceptible; "graduate Spring 2030" vs "graduate Fall 2029" is a
real difference, but "your plan uses 47 cr in spring vs the optimal 48" is
not.

### Ordering heuristic — why prereq depth first

Most scheduling heuristics use MRV (most-restricted-variable, fewest
candidates first). For multi-semester planning, prereq depth is a stronger
signal: a course at depth 3 *cannot* be placed before its 3 prereq layers
are placed, regardless of how many term slots it would otherwise fit. MRV
within prereq-depth tiers is the right secondary sort (already in the
algorithm above as "ties broken by" clauses).

---

## 4. Per-term constraint structure

`TermSlate.creditCap` is the load-bearing detail. The planner reads it
*per slate*, not from a global pace setting. This enables three UX
surfaces from the same underlying algorithm:

1. **Pace slider (v1).** User sets `preferences.paceCredits = 15`. The
  planner initializes every `TermSlate.creditCap = 15`. Slider drag updates
   the preference and regenerates the plan.
2. **Per-term overrides (v1.5).** User clicks Spring 2027 → "max 12 cr." A
  `TermOverride` with `creditCap: 12` lands in `overrides[]`. The planner
   uses `12` for that slate and `paceCredits` for the rest.
3. **Drag-and-replan (deferred — see §6).** User drags BIO 2430 from Spring
  2027 to Fall 2026. A `PinnedAssignment` is added; the planner regenerates
   with that pin honored.

The reason this matters architecturally: if we baked `paceCredits` into the
algorithm as a global, we'd have to rewrite when (1.5) lands. Per-slate caps
from day one mean (1.5) and (2) are pure UX work, not solver work.

---

## 5. UX surfaces and shipping order

### v1 — pace slider + read-only plan

A grid view: 8 columns (one per term, oldest left), each column a stack of
course cards. A header strip shows total progress and graduation term. A
single slider on top: "Target pace: 12 / 15 / 18 cr/sem." Slider snaps
between three pre-computed plans (computed once on load — see §7).

This is the v1 ship. It answers the most common student question — "when do
I graduate?" — without taking a position on user-driven editing.

### v1.5 — per-term overrides

Each term card gains a small `⚙` icon. Click → a popover lets the user set
`creditCap` for that term, mark it as "skip" (e.g. studying abroad), or
toggle "summer enabled" if it's a summer slot.

The planner re-runs server-side (well, in-extension; same idea) on each
override change. Because the planner is fast (<500ms after Phase A+B) and
the catalog is in-memory, this feels instant.

### v2 — drag-and-replan (deferred)

User drags a course card from one term to another. Drop is interpreted as
a `PinnedAssignment`. The planner regenerates with that pin honored.

**Why deferred:** the UX edge cases are subtle. If the user drops BIO 2430
on Fall 2026 but Fall 2026 has no BIO 2430 offering (per seasonality), do we
silently move it back, show a red error, or accept the pin and warn? Each
answer has merit. We'll defer this until we've watched real users use v1 and
v1.5.

**Architecture note for the implementer.** Even though we don't ship drag-
and-replan in the first release, the data model already supports it: a drop
event becomes a `PinnedAssignment`, the planner regenerates, the result
includes `Infeasibility` records for any pin that breaks the plan. The UX
layer just needs to render that state. **Do not bake "no drag-and-drop" into
the data model**; the model permits it now and the UI surface for it is the
only deferral.

### v2+ — AI-assisted plan natural-language input

Outside the scope of this doc but worth noting: a future surface might let
students type "I want to graduate by Spring 2029 without summer classes" and
have an LLM translate to `PlanningPreferences`. This reuses the existing
intent-LLM infrastructure (see `[architecture.md](../architecture.md)` §3).
The data model already accommodates it — LLM output becomes `pins + overrides + preferences`, planner runs as normal. The schedule-builder LLM
that lives in `[scheduler/llm/intent.js](../../extension/scheduler/llm/intent.js)`
today is the natural source code for this when we get there.

---

## 6. Drag-and-replan — preserved design notes

Even though v2, the design questions are real and recording them now keeps
us from re-litigating later.

### When the pin is impossible

A `PinnedAssignment` can be infeasible for three reasons:

1. **Seasonality.** The course isn't offered in that term.
2. **Prereq.** The pinned term is before the prereqs can be satisfied.
3. **Cap.** The pinned term has no room and other course commitments are
  themselves pinned.

Handling: planner records an `Infeasibility`, leaves the pin in `pins[]`,
moves on. UX renders the slate with a red banner: "BIO 2430 pinned to Fall
2026 but no offering predicted that term — keep pin and verify with
department, or unpin." User chooses.

### Cascade behavior

Pinning course X to term T may force its prereqs into earlier terms,
displacing previously-placed courses. The planner does this automatically
in Phase A. UX needs to *show* the cascade — animate displaced courses, or
list "moved by your pin" in a side panel. Without this, drag feels magical
but is actually opaque.

### Multi-pin interactions

User pins X to Fall 2026 AND Y to Spring 2027. If X is a prereq of Y the
planner accepts both. If Y is a prereq of X the planner records two pins
and an `Infeasibility` (`prereq-cycle`). UX must surface both.

### Implementation cost

Roughly 2 weeks once v1.5 ships. The planner work is none (already
designed-in). The UX work is the cascade animation + the pin-conflict
banners. Defer until empirical demand from v1.5 users.

---

## 7. Performance contract

These are the load-bearing performance numbers. If we miss any of them, the
UX falls apart.


| Operation                      | Target          | Mechanism                                                |
| ------------------------------ | --------------- | -------------------------------------------------------- |
| Initial plan generation (cold) | <2s             | Catalog already in memory; greedy seed is the cost       |
| Pace-slider snap (warm)        | <16ms (instant) | Pre-compute plans for {12, 15, 18} on initial generation |
| Per-term override re-plan      | <500ms          | Greedy + 2-opt from existing plan as seed                |
| Pin add/remove re-plan         | <500ms          | Same                                                     |
| Catalog lookup (any course)    | <1ms            | In-memory `Map<CourseKey, CourseFact>`                   |
| Seasonality check              | <1ms            | In-memory `Map<CourseKey, Seasonality>`                  |


**Hard rule:** the planner never makes a network call. Network access is
the catalog's job, on extension load and on background refresh. If a
required course isn't in the in-memory catalog at plan time, the planner
treats it as `confidence: low` with a `seasonality-low-confidence` warning
and proceeds. It does **not** block on a fetch.

**Pre-compute scope.** On first plan generation, compute three plans in
parallel: `paceCredits ∈ {12, 15, 18}`. Cache the three. Slider snap is a
cache lookup. Recompute the cache only on pin/override changes.

---

## 8. Infeasibility handling

The planner can determine that no plan exists under the current
constraints. This is rare but real. Causes:

1. **Pace too low for window.** Student wants to graduate by Spring 2027
  but has 60 credits remaining and `paceCredits = 12`. Math says 5
   semesters minimum.
2. **Pin makes plan impossible.** User pins three courses to one slate but
  they total 18 cr and the slate cap is 12.
3. **Prereq cycle in catalog data.** Should not happen but possible if
  catalog is corrupted; surface loudly.
4. **No offering predicted.** A required course has not been offered in any
  recent term and seasonality data shows no predicted future offering.
   This is a data signal worth surfacing as "this course may be
   discontinued — talk to advisor."

Mirror the existing `solveWithRelaxation` contract from the single-term
solver: try the user's exact constraints, and if no plan is producible,
generate a plan with relaxations and surface them as warnings.

```ts
// Pseudocode
function planWithRelaxation(input: PlannerInput): Plan {
  const exact = plan(input);
  if (exact.graduationTerm) return exact;

  const relaxations = [
    () => ({ ...input, preferences: { ...input.preferences, paceCredits: input.preferences.paceCredits + 3 } }),
    () => ({ ...input, preferences: { ...input.preferences, allowSummer: true } }),
    () => ({ ...input, pins: [] }),  // last-resort
    () => ({ ...input, overrides: [] }),
  ];

  for (const relax of relaxations) {
    const candidate = plan(relax());
    if (candidate.graduationTerm) {
      return { ...candidate, warnings: [...candidate.warnings, /* relaxation note */] };
    }
  }

  // Truly infeasible — return diagnostic
  return { /* ... */, infeasibilities: [/* enumerate */] };
}
```

UX renders the relaxation warnings prominently: "Your pinned schedule
isn't graduable as-is. To make it work, we increased your pace from 12 to
15 cr/sem. [Reset pace] [Keep this plan]"

---

## 9. Confidence and disclaimers

Every `PlannedCourse` carries a `confidence` field aggregating:

- **Seasonality confidence** — how sure are we the course is offered that
term? See `[course-catalog.md](course-catalog.md)` §4 for the formula.
- **Prereq satisfaction certainty** — `high` if all prereqs are confirmed
applied or scheduled; `medium` if scheduled but not yet completed (in-
progress); `low` if relying on assumed catalog prereqs that are flagged
stale.
- **Catalog freshness** — derived from catalog version vs current date.

UX rule: every term card shows the lowest confidence of any course in it.
A `low` card gets a yellow border and a hover tooltip listing why. A `low`
card may not be selected as the "graduate by" milestone — the planner
treats `graduationTerm` as the latest *high*-confidence term that would
complete the plan, then notes "earliest possible Spring 2030 (low
confidence on BIO 2430 offering)."

**Always-on disclaimer.** Every multi-semester planner view shows a
persistent banner:

> Bobcat Plus is not affiliated with Texas State University. Course
> offerings, prereqs, and degree requirements change. This is a planning
> tool — verify your graduation timeline with your advisor before making
> registration or financial decisions.

This is non-dismissible. It is the trust contract.

---

## 10. Many-to-many integration

A course can satisfy multiple `RequirementGraph` rules under DegreeWorks
`NONEXCLUSIVE` (D9). The planner uses this to *minimize total courses* by
preferring courses that knock out multiple boxes.

### Assignment problem inside the planner

When the planner places course X that covers rules {A, B}, it must decide
which of {A, B} to "credit" X for. Naively (first-match) this can leave
later requirements unsatisfiable. The right algorithm is **maximum
bipartite matching** on the courses-vs-rules graph, run after Phase A and
before Phase B.

Edge cases:

- `EXCLUSIVE` qualifier (`DontShare`) on a rule — that rule's match must be
rule-unique. The matching algorithm enforces this as a hard constraint.
- Multiple satisfying paths — a course matches both `Rule-A` (in the major)
and `Rule-B` (in the core). If the major is `EXCLUSIVE` and the core is
`NONEXCLUSIVE`, prefer the major slot (semantic priority: tighter
constraints first).
- Recompute on every plan change. Cheap (< ~500 courses × ~40 rules).

### UX surface

Result of matching is `SatisfactionTable`. UX surfaces this two ways:

1. On a course card: "ENG 4358 covers British Lit, Early Lit, AND Single
  Author — one course, three boxes." (D9 quote.)
2. On a rule view: "Single Author Requirement — satisfied by ENG 4358 (also
  covering British Lit, Early Lit)."

When the user pins or unpins a course, the matching re-runs. UX must
animate the satisfaction redistribution clearly so users understand why
"covers 3 boxes" suddenly became "covers 1 box" after they removed
something.

---

## 11. Cross-program integration

### Proactive minor suggestions

The planner runs a comparison pass after the main plan. For each minor in
a hand-curated short list (Math, Stats, Business, Pop Culture, etc. —
~10-15 entries per major), fetch that program's `RequirementGraph` from
the catalog (it may need a What-If endpoint call if not bundled — cached
per-student for 30 days). Compute the diff: how many of the minor's
required courses does the student already have applied + planned?

Surface a notification when accidental completion is high:

> You've already covered 4 of 6 Math Minor courses through your CS major
> requirements. Adding the minor would cost you 2 more courses (~6 credits).
> [Show me how it changes my plan] [Not interested]

Threshold: surface when accidental completion ≥ 50%. Configurable in
preferences.

### What-if catalog year switching (deferred)

A student on catalog 2022 might want to know what graduating under catalog
2026 would look like (sometimes earlier catalogs are more or less
restrictive). The mechanic mirrors the minor case: fetch the alternate
catalog's `RequirementGraph`, run the planner with current `applied[]`
against it, present a side-by-side: "Under 2022 catalog: graduate Spring
2027. Under 2026: graduate Fall 2027 (one extra requirement)."

Defer until Phase 4 advising-flow lands. Architecturally cheap when ready.

---

## 12. Integration with single-term solver

The forward planner produces a `Plan`. The user, having decided on it,
clicks "Build my Fall 2026 schedule" — this hands the corresponding
`TermSlate` (its course list) to the existing single-term solver
(`scheduler/index.js → handleUserTurn`).

The integration contract:

- The single-term solver receives the `TermSlate.courses` as its required
course set (instead of the LLM-derived intent's "needed" list).
- The student's preferences (avoid days, time blocks, etc.) feed into the
solver as they always have.
- The solver returns sections; planner doesn't care which sections.

This means the planner is **complementary**, not a replacement, for the
existing scheduler. A student can use only the scheduler (current
behavior). A student can use the planner to pick courses and the scheduler
to pick sections (new behavior). A student can build manually (existing
manual builder behavior, see `[tab/schedule.js](../../extension/tab/schedule.js)`)
and use the planner for "what do I take next semester after this one?"

### Build view — non-AI fast path (sibling surface)

In parallel to the planner work, the build view (today's manual eligible-
list builder) is planned to gain a "Build Schedule" button that exposes
the existing CSP solver directly, **without** going through the LLM
intent / affinity / rationale stages. This is *not* part of the planner;
it's a separate small surface worth recording here because it shares all
the same downstream infrastructure.

The path:

```
sliders (online↔in-person, target hours) + existing eligible[]
   → buildConstraints(sliderPrefs, profile, lockedCourses)
   → solveMulti(eligible, constraints, sliderPrefs)
   → pickTop3(...)
   → render 3-5 schedule cards in build view
```

No intent LLM, no affinity LLM, no rationale LLM. Pure deterministic.

**Slider quantization.** The target-hours slider snaps to integer values,
but the solver receives `minCredits = N - 1, maxCredits = N + 1` so
`solveWithRelaxation` has wiggle room. A user dragging to "17" gets
schedules between 16-18 cr, not "no schedule found because exactly 17 is
unreachable." The solver's existing relaxation steps cover the rest.

**Why mention here.** The build-view button validates the *ambient AI*
direction (deterministic surface, AI optional) without depending on any
of the planner work. It can ship today, before L2 catalog, before the
planner. When L2 catalog lands, it gets the same eligibility-correctness
benefits the planner does (better prereq filtering, better seasonality
hints in the eligible list). When the many-to-many UX surfacing ships
(see §10), it gets the "covers 3 boxes" badges automatically since the
ranker already exposes per-schedule satisfaction info.

The button is a parallel ship to the grad-tracker MVP: small, useful,
non-blocking, validates the architectural direction.

---

## 13. What this does NOT include

- **Section-level scheduling.** Lives in `scheduler/solver/`*. The planner
hands a `TermSlate.courses` list off to it for actual section selection.
- **Live registration / hold checks.** Banner enforces these at the moment
of registration. We surface known holds (when we can detect them) but
we do not block planning on them.
- **AI-driven plan generation.** The planner is deterministic. An LLM
surface that translates "I want a chill final year" into
`PlanningPreferences + overrides` is a future additive feature, not part
of this doc.
- **Cost / financial-aid optimization.** Number of credits, summer
enrollment fees, scholarship-credit-floor compliance — out of scope.
Mention as a follow-up.
- **Graduation requirements outside DW.** Internships, capstone defenses,
language-proficiency exams that don't appear as audit rules — invisible
to us.
- **Course recommendations based on instructor / quality.** RateMyProf
integration exists in the codebase but is not a planner input.

---

## 14. Open design questions

1. **What's the right "knownTerms" extension?** Three years forward?
  Five? Until the planner says graduated? Default proposal: extend until
   `creditsRemaining` is exhausted at `paceCredits`, plus 2 buffer terms.
2. **How do we handle "summer maybe"?** A user might want summer enabled
  only as a fallback ("if it lets me graduate a semester earlier"). Three
   states: never / always / opportunistic. Default: never.
3. **Pace slider granularity.** {12, 15, 18} as discrete options? Or
  continuous 9-21? Discrete is faster (only 3 pre-computed plans), gentler
   UX. Continuous is more flexible. Recommend discrete for v1.
4. **What's a "completed" minor?** Does the planner consider a minor done
  when its requirement-graph rules are all satisfied, or does it need
   explicit student action to "add" the minor? Likely the latter for
   conservative defaults.
5. **In-progress courses (`grade === "IP"`).** Treated as planned for the
  current term, with prereqs satisfied for downstream courses, but credit
   not yet counted in `applied[]`. Confirm this matches student
   expectations.
6. **Catalog-year-switch UI.** When and how to surface? Deferred to Phase
  4 advising-flow doc.
7. **Plan persistence.** Does the user's plan survive a session? Stored
  where? `chrome.storage.local`? Need a `Plan.id` and a save/load flow.
   Likely yes; needs a small RFC.

---

## 15. Postmortem-in-advance

*Six months from now we rolled this back. What happened?*

1. **Failure mode:** Empirical seasonality data is too sparse for the
  planner to find offerings, so most courses default to `confidence: low`
   and the UI is yellow-warning soup. Trust collapses.
   **Mitigation:** Bundle a 4-term seasonality history at ship time
   (see `[course-catalog.md](course-catalog.md)` §4). Cold-cache students
   start with usable data. Threshold for "high confidence" is calibrated
   against this baseline (≥3 of 4 prior fall terms = "high confidence
   fall offering").
2. **Failure mode:** Heuristic optimum is meaningfully worse than CSP
  optimum on a real audit, surfacing a noticeably bad plan. Student
   trusts our 7-semester estimate and doesn't graduate when expected.
   **Mitigation:** Validation harness: run the planner against 5+ real
   student plans (collected via P-C verification flow) and confirm the
   planner's graduation term is within 1 semester of the truth. CI gates
   on the harness. If gap exceeds 1 semester, switch to simulated-
   annealing as a slower-but-more-optimal fallback.
3. **Failure mode:** Pin-cascade UX is too confusing — students drop a
  course, see five other courses move, get lost. Drag-and-replan v2
   ships and is unusable.
   **Mitigation:** v2 is explicitly deferred. Ship v1 + v1.5 first; watch
   real students; design v2 against observed failure modes, not
   anticipated ones.
4. **Failure mode:** Performance budget missed because the catalog is
  bigger than expected. Planner takes 5s instead of 500ms, slider feels
   broken.
   **Mitigation:** Performance regression test in CI. Catalog has a hard
   size budget enforced at build time (see
   `[course-catalog.md](course-catalog.md)` §3).
5. **Failure mode:** Many-to-many bipartite matching has a bug that
  under-counts coverage; student sees "62% complete" when truth is "75%
   complete." Trust hit.
   **Mitigation:** The matching algorithm is small and pure. Unit-test
   against hand-built `SatisfactionTable` fixtures, including known-
   tricky NONEXCLUSIVE/EXCLUSIVE mixes from rule-shape-discovery's
   inventory.
6. **Failure mode:** A student's audit has a structure we didn't see in
  the 312-audit corpus, and the planner crashes or produces nonsense.
   **Mitigation:** Defensive `try/catch` around plan generation; surface
   "we couldn't plan this — please report" with anonymized audit dump.
   Same pattern the existing solver uses for `validateSchedule` failures.

---

## 16. Concrete implementation steps (in order)

1. **Skeleton + types** — create `extension/planner/` directory; export
  the type definitions from §1 and §2 in `extension/planner/types.js`.
   Pure file, no runtime behavior.
2. **Greedy seed (Phase A)** — `extension/planner/greedy.js`. Operates on
  in-memory `RequirementGraph + CourseCatalog`. Unit tests against
   fixtures (hand-built small graphs first, then real audit fixtures).
3. **Local search (Phase B)** — `extension/planner/localSearch.js`.
  Pure functional pass over a `Plan`. Unit tests on optimization
   benchmarks.
4. **Many-to-many matching** — `extension/planner/satisfaction.js`. Pure
  matching algorithm. Unit tests with NONEXCLUSIVE / EXCLUSIVE fixtures.
5. **Infeasibility + relaxation** — `extension/planner/relaxation.js`.
  Mirror `solveWithRelaxation` shape from
   `scheduler/solver/solver.js:330+`.
6. **Pre-compute orchestrator** — `extension/planner/index.js`. Public
  entry point: `generatePlans(input) -> { plans: Plan[3], satisfaction,  warnings }` for the {12, 15, 18} pace plans.
7. **UI shell (v1)** — new `extension/tab/planner.js` and a planner page
  in `tab.html`. Renders the grid view + slider + disclaimer. Hooks to
   the planner module.
8. **Per-term overrides (v1.5)** — extend `tab/planner.js` with the
  per-term ⚙ popover. Re-runs the planner on change.
9. **Many-to-many UX surfacing** — render the "covers 3 boxes" badge on
  course cards.
10. **Validation harness** — `tests/integration/planner-real-students.js`
  runs planner against fixtured real-student plans and asserts
    graduation-term parity within 1 semester.
11. **Performance regression test** — CI gate: 30-course / 8-term plan
  generates in <2s (cold), pace snap <16ms, override <500ms.

Each step is a separate ticket (target SCRUM-TBD-1 through SCRUM-TBD-11
when filed). Steps 1-6 are code-only and can be done in parallel by
multiple developers. Step 7-8 depend on steps 1-6. Steps 9-11 are gates
before the planner is exposed to students.

---

## 17. Cross-references

- Data layer: `[course-catalog.md](course-catalog.md)` — what the planner
consumes.
- MVP: `[grad-tracker.md](grad-tracker.md)` — the cheap progress strip
that ships first and is replaced by the planner's header.
- Underlying graph: `[requirement-graph.md](requirement-graph.md)` — the
L0 structure both consume.
- Single-term solver: `[../architecture.md](../architecture.md)` §AI
scheduler — what the planner hands off to.
- Many-to-many decision: `[../decisions.md](../decisions.md)` D9.
- Advising flow (later integration point):
`[advising-flow.md](advising-flow.md)`.

