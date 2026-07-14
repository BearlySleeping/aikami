---
name: git-worktree
description: >-
  Git Worktrees for isolated multi-agent workspaces — standard Git commands
  that keep the root repo untouched. Covers `git worktree add/remove/list`,
  `git commit`, `git push`, and branch-based workflows. Replaces the deprecated
  Jujutsu (jj) approach. Use when creating, checkpointing, reconciling, or
  cleaning up agent workspaces in the contract pipeline or any multi-task
  isolation scenario.
version: 1.0.0
tags: ["git", "worktree", "vcs", "workspace", "agent-isolation"]
---

# Git Worktrees — Multi-Agent Workspace Isolation

Git Worktrees allow multiple working directories from a single repository.
Each worktree checks out a different branch, and the **root repository stays
untouched** on its current branch (typically `dev` or `main`). This gives Pi
100% standard Git compatibility — Zed Editor Git UI, Moonrepo pre-commit
hooks, and `git add` all work as expected.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Worktree** | An independent working directory linked to the main `.git` repo. |
| **Branch** | Standard Git branch — each worktree has its own branch checked out. |
| **Root repo** | The main repository directory — stays on `dev`/`main`, never moved. |
| **.pi/workspaces/** | Convention for agent worktree directories (gitignored). |

## Workspace Lifecycle (Agent Isolation)

### Phase A: Create an Isolated Worktree

```bash
# From the repo root, create a new worktree on a new branch.
# The root repo stays on its current branch.
git fetch origin
git worktree add .pi/workspaces/task-xyz -b contract-task-xyz origin/dev
```

The new directory is a fully independent working copy sharing the same
`.git` metadata. Standard `git add`, `git commit`, and `git push` work.

### Phase B: Checkpoint Progress

```bash
cd .pi/workspaces/task-xyz

# Stage all changes and commit (triggers Moonrepo pre-commit hooks)
git add -A
git commit -m "Agent milestone: [Details]"
```

### Phase C: Reconcile & Clean Up

```bash
cd .pi/workspaces/task-xyz

# 1. Finalize changes
git add -A
git commit -m "Feat: Completed contract pipeline task xyz"

# 2. Push the branch
git push -u origin contract-task-xyz

# 3. Return to root and clean up
cd /path/to/repo-root
git worktree remove .pi/workspaces/task-xyz --force
```

### Phase D: Error Recovery

```bash
# Capture diagnostics
cd .pi/workspaces/task-xyz
git log -1
git status
git diff HEAD

# Remove the worktree (does NOT delete pushed commits)
cd /path/to/repo-root
git worktree remove .pi/workspaces/task-xyz --force

# Optionally delete the local branch
git branch -D contract-task-xyz
```

## Reference Commands

### Worktree Management

```bash
git worktree list              # List all worktrees
git worktree add <path> -b <branch> <base>  # Create a new worktree
git worktree remove <path> --force          # Remove a worktree (--force for dirty state)
git worktree prune             # Prune stale worktree entries
```

### Branch & Commit

```bash
git rev-parse --abbrev-ref HEAD  # Get current branch name
git rev-parse HEAD               # Get current commit hash
git add -A                       # Stage all changes
git commit -m "<message>"        # Commit (triggers hooks)
git push -u origin <branch>      # Push and set upstream
```

### Diagnostics

```bash
git log -1 --format="%H %s"      # Last commit hash + subject
git status                       # Working tree status
git diff HEAD                    # Uncommitted changes
```

## Path Safety

- Always use resolved absolute paths for worktree directories.
- Worktree directories must be outside `.git/`.
- The convention is `.pi/workspaces/<sanitized-id>/` — ensure this is in `.gitignore`.
- `.gitignore` at the repo root applies to all worktrees.

## Environment

- `git` respects `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` for commit attribution.
- Moonrepo pre-commit hooks run on `git commit` — any hook failures block the commit.
- In Nix environments, `git` is available by default.
