---
name: rebase-and-reopen-pr
description: Rebase a feature branch onto main and reopen its PR after conflicts go stale. Use when the user says "this PR has conflicts" / "rebase X onto main" / "reopen PR N" / "PR #N closed itself".
---

# Skill — Rebase + reopen a PR

Do these steps in order. Stop and report only if something blocks
progress (cancelled push, true conflict you can't resolve, etc).

## 1. Capture state

```sh
git fetch --all --prune
git branch --show-current
git status --short
gh pr view <N> --repo BobcatPlus/BobcatPlus --json state,mergeable,headRefName,baseRefName
```

If the working tree has uncommitted work, stash it with a clearly
named stash (`git stash push -u -m "wip-<branch>-<reason>-$(date +%s)"`)
and tell the user before continuing.

## 2. Rebase onto current main

`origin` should point at the org. If you're on a fork remote, use
`github-desktop-BobcatPlus/main` as the base instead — see
`compass.md` for the one-time remote rename.

```sh
git checkout <branch>
git rebase origin/main      # or github-desktop-BobcatPlus/main
```

Resolve conflicts file-by-file. For docs conflicts, prefer the
incoming `main` version unless the branch's change is specifically
load-bearing for that branch's feature.

## 3. Verify

- `node tests/unit/run.js` — must pass.
- Diff sanity: `git diff --stat origin/main...HEAD` — confirm the diff
  matches the branch's purpose, no surprise files.

## 4. Push

```sh
git push --force-with-lease origin HEAD
```

`--force-with-lease` is mandatory after a rebase. It refuses if
someone else pushed in the meantime — that's the safety we want.

## 5. PR

Try `gh pr reopen <N>` first. If GitHub refuses (which it sometimes
does after a force-push when the merge state was problematic), open a
fresh PR with the same branch and title and link back to the old one
in the description.

```sh
gh pr create --base main --head <branch> \
  --title "[SCRUM-<key>] <short summary>" \
  --body "Replaces #<old> (force-pushed after rebase)..."
```

Report the PR URL and whether it's the original number or a fresh
one.
