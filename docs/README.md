# Bobcat Plus — documentation index

**Read order (humans and LLMs):** use this table to load the smallest context
first, then branch by task. Deeper content lives in linked files — avoid
duplicating long tables in chat.

1. [`../CLAUDE.md`](../CLAUDE.md) — router: contexts, where to read next, rules, session hygiene.
2. [`../HANDOFF.md`](../HANDOFF.md) — what’s next, phases, short commit pointers.
3. [`decisions.md`](decisions.md) — **tiebreaker** ADR log; if any doc disagrees, this wins.

---

## Core reference (refactored `extension/`)

| Doc | One-line role |
| --- | ------------- |
| [`architecture.md`](architecture.md) | Two JS contexts, eligible + v3 AI pipelines, external systems, cache contract, v3 diagram. |
| [`invariants.md`](invariants.md) | Non-negotiables (session mutex, `bail()`, pool+timeout, affinity wipe, Jaccard, `validateSchedule`, `addToWorkingSchedule`). |
| [`file-map.md`](file-map.md) | `bg/*`, `tab/*`, entrypoints, pure `requirements/*` + `performance/*` — *where* to edit. |
| [`open-bugs.md`](open-bugs.md) | Active and deferred product issues; pointers to `bugN-*-diagnosis` files. |
| [`refactor-on-main-plan.md`](refactor-on-main-plan.md) | How `background`/`tab` were split; commit chain; blueprint deltas. |

---

## Decisions and contribution rules

| Doc | Role |
| --- | ---- |
| [`decisions.md`](decisions.md) | Append-only ADRs. Never split a decision into a new file. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to add docs; `README.md` or `CLAUDE.md` must index new markdown. |

---

## Phase and feature RFCs

| Doc | Role |
| --- | ---- |
| [`requirement-graph-rfc.md`](requirement-graph-rfc.md) | `RequirementGraph` + DegreeWorks mapping. |
| [`METRICS.md`](METRICS.md) | Phase-0 metric formulas. |
| [`advising-flow.md`](advising-flow.md) | Phases 4a / 4b / 5 product shape. |

---

## Bug and incident diagnoses

| Doc | Status | Role |
| --- | --- | ---- |
| [`bug1-morning-preference-diagnosis.md`](bug1-morning-preference-diagnosis.md) | Closed (`5975c90`) | Morning preference / solver. |
| [`bug4-eligible-diagnosis.md`](bug4-eligible-diagnosis.md) | 🟡 A/B/C shipped; live verify | Wildcard / eligible pipeline. |
| [`bug5-online-conflict-diagnosis.md`](bug5-online-conflict-diagnosis.md) | Closed (`fda436e`) | Online vs in-person conflict. |
| [`bug6-import-ux-diagnosis.md`](bug6-import-ux-diagnosis.md) | 🟡 Deferred | Import + auth banner. |
| [`bug8-banner-half-auth-login-popup-diagnosis.md`](bug8-banner-half-auth-login-popup-diagnosis.md) | Closed (D19) | `/saml/login` entry. |
| [`bug9-plans-empty-after-term-switch-diagnosis.md`](bug9-plans-empty-after-term-switch-diagnosis.md) | 🟡 Open | Plan list vs `loadSchedule` order (deferred from Refactor). |
| [`bug10-session-expired-status-bar-diagnosis.md`](bug10-session-expired-status-bar-diagnosis.md) | 🟡 Open | Auth error string in status bar. |
| [`bug11-post-saml-degreeworks-warmup-diagnosis.md`](bug11-post-saml-degreeworks-warmup-diagnosis.md) | Closed (D22 + D23) | SAML entity-decode; DW worksheet warm-up. |

---

## Baselines

| Path | Role |
| ---- | ---- |
| [`baselines/phase1-2026-04-21.json`](baselines/phase1-2026-04-21.json) | Phase-1 adapter snapshot; regen via `scripts/generate-phase1-baseline.js` when the parser/adapter changes. |

---

## Intentionally not duplicated here

- **Per-module “what the code does”** — top-of-file comments in
  `extension/**` (e.g. `requirements/wildcardExpansion.js`,
  `performance/concurrencyPool.js`, `bg/analysis.js`, `tab/auth.js`).
- **Commit narratives** — git history; use `decisions.md` for durable *why*.
