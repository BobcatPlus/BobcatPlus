---
name: file-bug-from-diagnosis
description: When a teammate finds a bug, file a Jira ticket and create a matching diagnosis doc. Use when the user says "I found a bug" / "this is broken" / "let's track this" and the failure has a non-obvious cause worth writing down.
---

# Skill — File a bug from a diagnosis

When a non-obvious bug surfaces, do these steps in order. Don't ask
for permission between them; just do them and report.

## 1. Reproduce + run the test suite

- Reproduce the bug if you can.
- Run `node tests/unit/run.js`. If anything is red, note which tests
  and whether the failure is related to the bug.

## 2. Write a short diagnosis

Draft the diagnosis as if it were going to live at
`docs/bugs/scrum-{N}-{slug}.md`. Sections:

- **Symptom** — what the user sees.
- **Why it matters (UX)** — one paragraph.
- **Hypothesis** — your best theory of where the failure lives.
- **Scope of fix (expected)** — what files, what code paths.
- **Verification** — how we'll know it's actually fixed.

If it's clearly a one-line fix (typo, missing null check), skip the
doc — it doesn't pass the "non-obvious failure mode" bar. Just file
the Jira ticket and fix it.

## 3. File the Jira ticket

Use the Atlassian MCP. Project key = `SCRUM`, issue type = `Bug`.
Summary should be short and start with the user-facing symptom.
Description should link the diagnosis doc (paths use `docs/bugs/...`).

Add at least one `area:` label (`area:scheduler`, `area:ui`,
`area:auth`, `area:scraper`, `area:docs`).

## 4. Save the diagnosis doc

Once you have the Jira key, save the diagnosis at
`docs/bugs/scrum-{N}-{slug}.md` and link it from
`docs/open-bugs.md` under "Has an in-repo diagnosis".

## 5. Report back

Tell the user:

- Jira key + URL.
- Diagnosis doc path.
- One sentence on the most likely fix area.
