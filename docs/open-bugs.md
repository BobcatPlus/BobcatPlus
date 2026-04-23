# Open bugs and deferred UX

Track **non-obvious** product issues here with **one line + pointer**. Closed
bugs stay in `docs/bug*-diagnosis.md` as historical records. **Tiebreaker:**
`docs/decisions.md` overrides narrative elsewhere.

---

## Active / deferred

| # | Summary | Doc / next step |
| --- | --- | --- |
| 7 | Registration restrictions — filter sections the student cannot satisfy (major/minor/standing). | Not started. File `docs/bug7-registration-restrictions-diagnosis.md` when work begins. |
| 4 | Eligible list missing wildcard expansions — Layers A/B/C shipped; **live verification** still pending (reload extension; CS BS / English-CW audits ≥50 eligible). | `docs/bug4-eligible-diagnosis.md` |
| 6 | Import-button UX + auth-expiry handling. | `docs/bug6-import-ux-diagnosis.md` |
| — | Current schedule doesn’t render on calendar on first load (sibling to Bug 6). | Deferred — own diagnosis when investigated. |
| — | Schedule variety too homogeneous with no user prefs (Phase 3 archetypes). | Phase roadmap in `HANDOFF.md` |
| — | `removeAvoidDays` / `resetAvoidDays` reliability in intent parsing. | Small Phase 2 — tighten prompts first. |
| — | Affinity over-generalizes (“science” → BIO). | Tighten career expansion in `buildIntentPrompt()`. |
| — | Advisor summary / multi-semester planner. | `docs/advising-flow.md` |

---

## Filed from Refactor branch (fix later)

| # | Summary | Doc |
| --- | --- | --- |
| 9 | After term switch, Banner plans can load empty or out of order vs `loadSchedule` / `registrationHistory` interaction. | `docs/bug9-plans-empty-after-term-switch-diagnosis.md` |
| 10 | Auth error in status bar not preserved (UX polish). | `docs/bug10-session-expired-status-bar-diagnosis.md` |

---

## Closed (pointer only)

| Doc | Notes |
| --- | --- |
| `bug1-morning-preference-diagnosis.md` | Shipped `5975c90` |
| `bug5-online-conflict-diagnosis.md` | Shipped `fda436e` |
| `bug8-banner-half-auth-login-popup-diagnosis.md` | D19 |
| `bug11-post-saml-degreeworks-warmup-diagnosis.md` | D22 + D23 |

The [`README.md`](README.md) index lists every diagnosis file with one-line summary + status.
