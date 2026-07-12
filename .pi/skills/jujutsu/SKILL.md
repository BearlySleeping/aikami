---
name: jujutsu
description: >-
  Jujutsu (jj) VCS — co-located Git-compatible version control for isolated
  multi-agent workspaces. Covers `jj workspace add/forget/list`, `jj describe`,
  `jj new`, `jj squash`, `jj git push`, `jj log`, and change-id based workflows.
  Use when creating, checkpointing, reconciling, or cleaning up agent workspaces
  in the contract pipeline or any multi-task isolation scenario.
version: 1.0.0
tags: ["jujutsu", "jj", "vcs", "workspace", "agent-isolation"]
---

# Jujutsu (jj) — Multi-Agent Workspace Isolation

Jujutsu is a modern, Git-compatible version control system that supports
concurrent, co-located workspaces without directory collisions or HEAD lock
conflicts. It tracks changes automatically (no `git add`), uses change IDs
instead of branch names, and supports conflict-free concurrent editing.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Change ID** | Stable identifier for a commit-to-be (e.g. `mzvqkpln`). Survives rebases and rewrites. |
| **Workspace** | A co-located checkout sharing the same `.jj` repo but with an independent working copy. |
| **The @ revset** | The current working-copy commit in the current workspace. |
| **Auto-snapshot** | `jj` snapshots the working copy automatically — no explicit staging needed. |

## Workspace Lifecycle (Agent Isolation)

### Phase A: Create an Isolated Workspace

```bash
# jj must already be initialized (jj git init or jj init in an existing git repo)
jj workspace add .pi/workspaces/agent-task-xyz
```

The new directory is a fully independent working copy sharing the same `.jj`
metadata.  `jj` automatically tracks file changes — no staging step.

### Phase B: Checkpoint Progress

```bash
jj describe -m "Agent milestone: [Details]"
```

This records a human-readable description on the current change. Add `--no-edit`
to skip the editor.  For automated pipelines always use `-m`.

### Phase C: Reconcile & Clean Up

```bash
# 1. Finalize description
jj describe -m "Feat: Completed contract pipeline task xyz"

# 2. Switch to main workspace
cd /path/to/repo-root

# 3. Bring the agent's change into the main branch
#    Option A: squash into parent (linear history)
jj squash --from <change-id> --into main

#    Option B: use jj git push to create a branch for PR
jj git push --change <change-id> --remote origin --branch feat/task-xyz

# 4. Forget the workspace (removes from jj config only)
jj workspace forget .pi/workspaces/agent-task-xyz

# 5. Delete the directory
rm -rf .pi/workspaces/agent-task-xyz
```

### Phase D: Error Recovery

```bash
# Log the failed change ID for diagnostics
jj log -r <change-id>

# Abandon the broken change (marks it as abandoned, does NOT delete)
jj abandon <change-id>

# Clean up the workspace
jj workspace forget .pi/workspaces/agent-task-xyz
rm -rf .pi/workspaces/agent-task-xyz
```

## Reference Commands

### Workspace Management

```bash
jj workspace list              # List all workspaces
jj workspace add <path>        # Create a new co-located workspace
jj workspace forget <path>     # Remove workspace from jj config (does NOT delete files)
jj workspace root              # Print the jj repo root
```

### Change Management

```bash
jj new                         # Create a new empty change
jj describe -m "<message>"     # Set change description
jj log                         # Show change history
jj log -r <change-id>          # Show a specific change
jj status                      # Show working-copy changes
jj squash --from <id> --into <target>  # Move changes from one commit into another
jj abandon <change-id>         # Abandon a change (reversible via jj un-abandon)
jj evolve                      # Resolve divergence from concurrent edits
```

### Git Interop

```bash
jj git init                    # Initialize jj in an existing git repo
jj git push --change <id>      # Push a change as a branch to a git remote
jj git fetch                    # Fetch from git remote
jj git export                   # Export jj changes back to git refs
```

## Path Safety

- Always use `path.resolve()` or `path.join()` for constructing workspace paths.
- Workspace directories must live outside `.jj/` (the metadata directory).
- The convention is `.pi/workspaces/<sanitized-id>/` — ensure this is in `.gitignore`.

## Environment

- `jj` reads `JJ_CONFIG` for override config; most pipelines only need defaults.
- `jj` respects `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` for commit attribution.
- In Nix environments, `jujutsu` is the package name (binary is `jj`).
