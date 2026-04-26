# Graduation Tracker MVP — design note

**Status:** ⬜ *Open. RFC; not implemented.* The cheap, ships-this-week
strip that gives students an immediate answer to "where am I in my
degree?" while the full Forward Planner
(`[forward-planner.md](forward-planner.md)`) is being built.

**Scope boundary.** This is a **pure-function progress display**. It
reads `RequirementGraph + applied[]` and renders a header strip. No
prereq-aware planning, no seasonality, no multi-semester layout, no
LLM. The full planner replaces this strip when it ships; until then,
this is the "good enough" answer.

---

## 1. What it shows

A header strip at the top of the requirements / overview view in the
extension's tab page. One row, three sections:

```
┌─────────────────────────────────────────────────────────────────┐
│  62% complete  ·  47 credits remaining  ·  ~3 semesters at 15 cr/sem  │
│                                                              [pace ⌄]  │
└─────────────────────────────────────────────────────────────────┘
```


| Element                     | Source                                                                                               | Notes                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `62% complete`              | Sum of credits applied / sum of credits required across all `BlockNode` children of the DEGREE block | One number; no per-block breakdown in MVP                                                                                     |
| `47 credits remaining`      | `creditsRequired - creditsEarned`                                                                    | Pulled from `student.creditsEarnedMajorMinor` and `creditsRequiredMajorMinor` if available; otherwise computed from the graph |
| `~3 semesters at 15 cr/sem` | `Math.ceil(creditsRemaining / paceCredits)`                                                          | Naive division. The "~" is load-bearing.                                                                                      |
| `[pace ⌄]`                  | Dropdown: 12 / 15 / 18 cr                                                                            | User selection persisted in `chrome.storage.local` as `gradTracker.pace`                                                      |


A clickable info icon (`ⓘ`) opens a tooltip with the disclaimer:

> This is a credit-hour estimate. It does not account for which
> semesters courses are offered, prereq order, or degree rule
> structure. The full multi-semester planner (coming soon) will
> handle these. Until then, treat this as a rough guide. Bobcat Plus
> is not affiliated with Texas State; verify with your advisor.

---

## 2. What it does NOT do

Explicitly enumerated to prevent scope creep:

- ❌ Does not check prereq order ("you can't take MATH 4357 before MATH 2417")
- ❌ Does not check seasonality ("BIO 4430 is fall-only")
- ❌ Does not lay out a term-by-term plan
- ❌ Does not enumerate which courses are remaining
- ❌ Does not warn about courses that haven't been offered recently
- ❌ Does not consider summer enrollment
- ❌ Does not handle pinned courses, overrides, or what-if scenarios
- ❌ Does not call any LLM
- ❌ Does not require any new network endpoint

If the user asks for any of the above, the answer is "the full
planner ships in a later release." This MVP is deliberately, visibly
naive — its honesty is part of its value.

---

## 3. Inputs

```ts
interface GradTrackerInput {
  graph: RequirementGraph;          // already in extension state
  studentSnapshot: {
    creditsEarned: number;          // student.creditsEarnedMajorMinor
    creditsRequired: number;        // student.creditsRequiredMajorMinor
  };
  paceCredits: number;              // user-set; default 15
}
```

All three inputs are **already populated in extension state** by the
existing flow (`[tab/overview.js:33+](../../extension/tab/overview.js)`).
No new fetches required. This is what makes the MVP cheap.

---

## 4. Algorithm

```ts
function computeGradTracker(input: GradTrackerInput): GradTrackerOutput {
  const { creditsEarned, creditsRequired } = input.studentSnapshot;
  const creditsRemaining = Math.max(0, creditsRequired - creditsEarned);
  const percentComplete = creditsRequired > 0
    ? Math.round((creditsEarned / creditsRequired) * 100)
    : 0;
  const semestersRemaining = creditsRemaining > 0
    ? Math.ceil(creditsRemaining / input.paceCredits)
    : 0;

  return {
    percentComplete,
    creditsRemaining,
    creditsEarned,
    creditsRequired,
    semestersRemaining,
    paceCredits: input.paceCredits,
  };
}

interface GradTrackerOutput {
  percentComplete: number;          // 0-100
  creditsRemaining: number;
  creditsEarned: number;
  creditsRequired: number;
  semestersRemaining: number;       // 0 when complete
  paceCredits: number;
}
```

That's it. Pure function, ~10 lines of real logic, fully testable.

### Fallback when student snapshot is incomplete

If `creditsRequired` is null or zero (some audit shapes don't expose
it cleanly), fall back to summing across the `RequirementGraph`:

```ts
function deriveCreditsFromGraph(graph: RequirementGraph): { earned: number; required: number } {
  let earned = 0;
  let required = 0;
  walkGraph(graph, (node) => {
    if (node.kind !== "courseQuant") return;
    if (node.take.credits?.min) {
      required += node.take.credits.min;
      const appliedCredits = node.applied
        .filter((a) => a.grade !== "IP" && a.grade !== "F")
        .reduce((s, a) => s + (a.credits || 0), 0);
      earned += Math.min(appliedCredits, node.take.credits.min);
    } else if (node.take.classes) {
      // For classes-only nodes, assume 3 credits/class as a default
      required += node.take.classes * 3;
      const appliedClasses = node.applied
        .filter((a) => a.grade !== "IP" && a.grade !== "F").length;
      earned += Math.min(appliedClasses, node.take.classes) * 3;
    }
  });
  return { earned, required };
}
```

The fallback is documented in the disclaimer too: "Credit totals
estimated from the requirement graph when not provided directly."

---

## 5. UI integration

### Where it lives

Top of the overview panel in the tab page. The overview panel is
rendered by `renderOverviewPanel` in
`[extension/tab/overview.js](../../extension/tab/overview.js)`. The
strip slots in *above* the existing student info / progress ring.

### Markup

```html
<div id="gradTrackerStrip" class="grad-tracker-strip">
  <span class="gt-pct">62% complete</span>
  <span class="gt-divider">·</span>
  <span class="gt-remaining">47 credits remaining</span>
  <span class="gt-divider">·</span>
  <span class="gt-estimate">~3 semesters at <select id="gtPace"><option>12</option><option selected>15</option><option>18</option></select> cr/sem</span>
  <button id="gtInfo" class="gt-info" aria-label="About this estimate">ⓘ</button>
</div>
```

Single new CSS file: `extension/css/tab-grad-tracker.css`. Loaded
after existing tab styles in `tab.html`.

### State + persistence

Pace dropdown change:

1. Update `chrome.storage.local` key `gradTracker.pace`.
2. Re-render the strip with the new estimate.

On load:

1. Read `gradTracker.pace` (default 15 if absent).
2. Compute and render.

When `refreshDegreeAuditOverview` updates the graph, re-render the
strip.

### Tooltip / disclaimer

Click on `ⓘ` opens a small modal (reuse existing modal pattern from
`tab/modal.js` if applicable). Modal text matches §1 disclaimer.

---

## 6. Verification path

The MVP needs to be ground-truth-correct for current students. Test
plan:

1. **Unit test.** `tests/unit/gradTracker.test.js`. Run
  `computeGradTracker` against fixtures from
   `tests/fixtures/audits/` (English BA, CS BS — both have known
   completed-credit values in the audit `auditHeader`). Assert
   percentages within 1%.
2. **Fallback unit test.** Run `deriveCreditsFromGraph` against the
  same fixtures with `creditsRequired: null` simulated. Assert it
   reaches a sensible total.
3. **Manual verification.** Three team members open the extension on
  their own audit; eyeball the percentage against their own DW
   "percent complete" header. Within 1-2% is acceptable (DW computes
   slightly differently because of internal rules we don't model).
4. **Cross-check against existing progress ring.** The hamburger-menu
  progress ring already in the extension is a useful triangulation
   target. If our number diverges meaningfully from the ring's
   number, *first* investigate which one is correct (the ring may be
   computing locally too, or it may be reading a DW-provided value
   we should defer to). Either way, surface a one-time reconciliation
   pass before ship: which source is authoritative for percent
   complete in this product. Outcome may be: keep both with the same
   formula, deprecate the ring in favor of the strip, or vice versa.
5. **Disclaimer audit.** Show the strip to one student volunteer who
  doesn't know how it works; confirm they understand "this is an
   estimate" without prompting.

No integration test required — there's nothing async, nothing
network-bound.

---

## 7. Replacement plan

When the Forward Planner ships:

1. The strip is replaced by a richer header that includes the
  planner's predicted graduation term, derived from the actual plan
   not the naive division.
2. The tooltip's "coming soon" copy is removed.
3. The pace dropdown moves into the planner UI (it's the same
  control).
4. `extension/tab/gradTracker.js` is either deleted or reduced to a
  pure helper that the planner uses for its header section.

The MVP is **explicitly designed to be replaced**. No effort goes
into making it extensible or future-proof — it ships, it serves,
it's deleted.

---

## 8. What this unblocks

- **Visible value next week.** Students get *some* answer to "when
do I graduate?" without waiting for the planner.
- **Baseline for verification.** When the full planner ships, we can
compare: did the planner say "8 semesters" when the MVP said "8 at
15 cr/sem"? Discrepancies are diagnostics, not failures.
- **Layout precedent.** The strip's placement in the overview panel
becomes the planner's header location too — same real estate, same
CSS bones.
- **Pace UI precedent.** The 12/15/18 dropdown reused in the planner.

---

## 9. What this doesn't unblock (worth being explicit)

- **Multi-semester layout** — needs the full planner.
- **Prereq-aware "what should I take next?"** — needs L2 catalog
(`[course-catalog.md](course-catalog.md)`).
- **Seasonality warnings** — needs L2 catalog.
- **Many-to-many "covers 3 boxes"** — needs Phase 1.5
(`[requirement-graph.md](requirement-graph.md)` §5 question 5).

These all wait for their own work; the MVP doesn't accelerate them.

---

## 10. Postmortem-in-advance

*Six months from now we rolled this back. What happened?*

1. **Failure mode:** Students misread "~3 semesters" as a hard
  commitment and don't take it as an estimate. Frustration when
   reality is 4 semesters because of prereq chains.
   **Mitigation:** Disclaimer is non-dismissible on first view.
   Tooltip is one click away on every view. "~" prefix on the
   number. "Estimate" word in the strip itself if needed.
2. **Failure mode:** Credit totals are wrong because the audit
  shapes for some majors don't expose `creditsRequiredMajorMinor`
   cleanly. Strip shows nonsense.
   **Mitigation:** Fallback to graph-based derivation. If even that
   fails (graph has no credit info), hide the strip for that
   student and log a diagnostic.
3. **Failure mode:** Strip is loud / distracting; users want to
  dismiss it. Adding a dismiss button creates "where did the
   tracker go" support questions.
   **Mitigation:** Make it visually quieter than the existing
   student info header (smaller font, lighter background). No
   dismiss in v1; revisit if user feedback says otherwise.
4. **Failure mode:** Pace dropdown change triggers a re-render
  that scrolls or jitters. Janky UX.
   **Mitigation:** Strip re-render is local — doesn't touch the
   rest of the overview. Test on slow machines.

---

## 11. Concrete implementation steps (in order)

1. **Pure function module.** Create
  `extension/tab/gradTracker.js`. Export `computeGradTracker` and
   `deriveCreditsFromGraph`. ~50 lines.
2. **Unit tests.** `tests/unit/gradTracker.test.js`. Cover the
  happy path, the fallback path, edge cases (zero credits, complete,
   over-complete from advisor exceptions).
3. **CSS.** `extension/css/tab-grad-tracker.css`. ~30 lines. Loaded
  in `tab.html` after `tab-shell.css`.
4. **HTML markup.** Append the strip element inside the overview
  panel section of `tab.html`.
5. **Render wiring.** In
  `[extension/tab/overview.js](../../extension/tab/overview.js)`
   `renderOverviewPanel`, call a new `renderGradTrackerStrip(graph,  studentSnapshot)`. Hook the pace dropdown's `onchange` to
   re-render + persist.
6. **Disclaimer modal.** Tiny modal triggered by the `ⓘ` button.
  Reuse `tab/modal.js` patterns if compatible; otherwise inline.
7. **Persistence.** Read/write `gradTracker.pace` from
  `chrome.storage.local`. Default 15.
8. **Verification.** Manual eyeball pass + unit tests + one student
  volunteer.
9. **Ship.** Single PR, single feature flag-free release. The MVP
  has no risk that warrants a feature flag.

Total estimated effort: 1 person-week. Maybe less.

---

## 12. Cross-references

- Replaces (when planner ships):
`[forward-planner.md](forward-planner.md)`.
- Underlying graph: `[requirement-graph.md](requirement-graph.md)`.
- Future data layer: `[course-catalog.md](course-catalog.md)`.
- Existing UI it slots into:
`[extension/tab/overview.js](../../extension/tab/overview.js)`.
- Existing student snapshot source:
`[extension/bg/studentInfo.js](../../extension/bg/studentInfo.js)`.
- Existing modal pattern (if reusable):
`[extension/tab/modal.js](../../extension/tab/modal.js)`.

