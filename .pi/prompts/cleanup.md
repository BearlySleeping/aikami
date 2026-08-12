---
description: Tear down finished contract-pipeline workspaces — git worktrees, herdr workspaces, and merged branches
argument-hint: "[--all | --legacy | <path>]  (default: list, then clean only merged PRs)"
---

# Workspace Cleanup

Remove the leftovers of finished contract-pipeline runs: git worktrees, their
herdr workspaces, and merged local branches.

## What you are cleaning

A single contract run leaves up to three things behind:

| Artifact | Where | Removed by |
|---|---|---|
| git worktree | `~/.herdr/worktrees/<repo>/contract-task-c-XXX-*` or `.pi/workspaces/run-*` | `git worktree remove` |
| herdr workspace | herdr state keyed by workspace id | `herdr worktree remove` |
| local branch | `contract-task-c-XXX-*` | `git branch -d` after merge |

`scripts/src/lib/ops/workspace_cleanup.ts` drives all three off
`git worktree list --porcelain` — the authoritative source — so it covers both
legacy `.pi/workspaces/` checkouts and herdr-native worktrees in one pass.

## 🔴 Self-guard — read this before running anything

**If you are running inside a contract review pane, that pane IS a workspace.**
Removing it kills your own session mid-command.

`workspace_cleanup.ts` refuses to remove the worktree it is running inside. It
detects this two ways:

- `CONTRACT_PIPELINE_WORKSPACE_PATH` — set on every worker and review tab
- `process.cwd()` — running from anywhere beneath the checkout

Either anchor matching (the path itself, or anything beneath it) skips removal.
So the safe command below **cannot** kill your session — but it also means the
current workspace will still be there when it finishes. That is expected. Tell
the user how to finish the job after they close the tab.

Never pass `--include-self`. It exists to force-clean the current worktree and
is only correct from a shell that is not inside one.

## Steps

**1. Show what exists, without touching anything.**

Running with **no arguments only lists** — it is the dry run. It also resolves
merged-PR status, so the output already tells you what is safe to remove:

```bash
bun run workspace:cleanup
```

Report the list back to the user: path, branch, `🔀 MERGED` status, `[herdr]` /
`[legacy]` tags, and any workspace skipped by the self-guard.

**2. Clean the finished ones.**

Only workspaces whose branch has a merged PR. This is the safe one and what you
should run unless the user asked for more — it also deletes the merged remote
branch, which the PR has already consumed:

```bash
bun run workspace:cleanup --pr-merged
```

Only if the user explicitly asked to clean **everything**, including branches
with open or absent PRs (this does not delete remote branches):

```bash
bun run workspace:cleanup --all
```

Other forms: `--legacy` restricts to `.pi/workspaces/` checkouts, and a bare
`<path>` cleans one specific worktree.

**3. Report honestly.**

State exactly which workspaces were removed and which were skipped, with the
reason for each skip. If the current workspace was skipped by the self-guard,
say so and give the finishing command:

```
This tab's own workspace (<path>) was skipped — cleanup cannot remove the
worktree it is running inside. Close this tab, then from the repo root:

  bun run workspace:cleanup --pr-merged
```

**4. Check the root checkout is clean.**

After a merge the root should be on `main` with nothing uncommitted:

```bash
git -C <repo-root> status --porcelain --untracked-files=no
git -C <repo-root> rev-parse --abbrev-ref HEAD
```

If the root is dirty, name the files. A dirty root aborts `git pull --ff-only`,
which is the failure the user hits next. Do not commit or stash on their behalf
— report the paths and let them decide.

## Guardrails

- **Never** remove a worktree whose branch has unpushed commits. If
  `workspace:cleanup` reports one, surface it and stop.
- **Never** run `git worktree remove --force` by hand to work around a refusal.
  The refusal is the safety mechanism.
- **Never** delete `.pi/contract-runs/` manifests — they are the resume state
  for incomplete runs and are small.
- Do not touch the main checkout, `main`, or any branch that is not a
  `contract-task-*` / `run-*` artifact.
