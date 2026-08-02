# Contract Pipeline — Primary Development Flow

The contract pipeline is the **primary development workflow** for Aikami. Every
feature, bug-fix, and improvement flows through a contract specification that is
written, critiqued, implemented, verified, and reviewed — all orchestrated by
Pi AI agents running in isolated Herdr workspaces.

```
Source → Write → Critique → Implement → Verify → Review → Merge
  │        │         │           │          │         │
  │    draft    approved    in_progress  implemented  verified
  │                                                     │
  └── prompt / issue / todo / existing contract ────────┘
```

## Quick Start

```bash
# Chat-draft a new feature (auto-generates contract ID, opens the writer):
bun run contract --source prompt --root

# Run an existing contract (skips writer + critique, starts implementation):
bun run contract C-370 --root

# From a GitHub Issue:
bun run contract --source issue #102

# Resume a previous run:
bun run contract --resume <run-id>
```

## Source Modes — How to Start a Contract

The `--source` flag picks the source of the contract. If omitted, the mode is
inferred from the target: **no target → `prompt`**, a bare `C-XXX` or path →
**existing contract**.

### 1. Prompt (`--source prompt`, default with no target) — Chat Drafting

Best for **new ideas and exploratory features**. Pi auto-generates the next
`C-XXX` ID, creates a placeholder contract, and opens an interactive writer pi
session. You describe the feature in natural language and the writer renames
the placeholder to `C-XXX-<slug>.md` and fills out every section of the
contract template.

```bash
bun run contract --source prompt --root
# or simply:
bun run contract
```

**What happens:**
1. Auto-generates `C-NNN` (next available number) and creates a placeholder at `docs/contracts/C-NNN.md`
2. Switches to branch `contract/C-NNN` (with `--root`)
3. Opens a writer pi session in **interactive TUI mode**
4. You type your feature description — the writer creates `docs/contracts/C-NNN-<slug>.md`
   (the placeholder is removed automatically) and completes the full contract
5. Pipeline continues: critique → implement → verify → review

**No `--root`?** The pipeline creates a Git worktree at `.pi/workspaces/` instead
of switching your current branch. Worktrees isolate file changes from your
working tree — useful for background/CI runs.

### 2. Issue (`--source issue`) — From GitHub Issues / Roadmap

Freeze a GitHub Issue into a contract. The issue body becomes the problem
baseline; the writer expands it into a full specification. `--issue` is an
alias for `--source issue`.

```bash
bun run contract --source issue #102
bun run contract --source issue https://github.com/BearlySleeping/aikami/issues/102
bun run contract --source issue C-370    # lookup from backlog reference
bun run contract --issue 54              # alias
```

**What it does:**
- Fetches the GitHub Issue via `gh issue view`
- Generates a contract from `TEMPLATE.md` populated with issue metadata
- Links `issue_number` and `issue_url` in YAML frontmatter
- Sets `source: issue`

The contract file is created immediately (no writer stage). To run it through
the full pipeline:

```bash
bun run contract C-XXX --root
```

### 3. Existing Contract (`--source <path|C-XXX>`, default with a target)

Use a contract that already exists on disk. The **writer and critique stages are
skipped** — the pipeline starts at implementation (or later, depending on the
contract's status). This is the default when you pass a bare ID or a path:

```bash
bun run contract C-370 --root           # look up docs/contracts/C-370*.md
bun run contract docs/contracts/C-370-fix-lpc-paperdoll-base-layering-and-neck-alignment.md
bun run contract --source path C-370    # explicit
```

**Stage start depends on the contract status:**

| Contract status | Pipeline starts at |
|---|---|
| `draft` / `approved` / `in_progress` / `verification_failed` | `implement` |
| `implemented` | `verify` |
| `verified` / `completed` | `review` |

If the ID cannot be found on disk (and is not in `docs/TODO.md`), the command
errors out with a clear message.

### 4. TODO Backlog (`--source todo`, legacy)

Start from an item in `docs/TODO.md`. Every TODO item has a stable `C-XXX` ID.
Unlike path mode, the writer stage runs to author the contract from the backlog
item.

```bash
bun run contract --source todo C-370
```

The writer inspects the TODO item, reads the codebase, and fills in:
- Problem & baseline evidence (what's broken today)
- Architecture directives (which files/packages to change)
- Acceptance criteria with concrete Given/When/Then
- Implementation sequence with moon task references

## Pipeline Stages

Each stage runs as a dedicated pi agent in a Herdr pane. Stages advance
automatically — a stage calls `contract_stage_complete` to hand off to the next.

| # | Stage | Role | What It Does |
|---|-------|------|-------------|
| 1 | **Write** | `writer` | Reads the source (prompt/Issue/backlog), inspects the codebase, fills every section of `TEMPLATE.md`. Ends at status `draft`. |
| 2 | **Critique** | `critic` | Adversarial review. Fixes typos and underspecified ACs directly. Blocks only for fundamentally wrong scope or missing critical details. Advances status to `approved`. |
| 3 | **Implement** | `implementer` | Writes the actual code. Runs moon tasks, creates views/viewmodels, adds tests. Ends at `implemented`. |
| 4 | **Verify** | `verifier` | Independent verification against every AC. Runs `validate({ test: true })`, blackbox tests, visual validation. If ACs fail → back to implementer. If all pass → `verified`. |
| 5 | **Review** | `review` | Review captain. Creates a PR, waits for CodeRabbit + human review, applies autofixes in YOLO mode, merges when approved. |
| 6 | **Merge** | (orchestrator) | Squash-merges the PR, syncs `main`, cleans up worktree + branches. |

### Stage Timeouts and Safety Nets

- **Active agents never time out** — the pipeline only considers an agent
  unresponsive after idle periods (10 min default).
- Idle agents get nudged (up to 3 times) before the stage is marked blocked.
- A **hard wall-clock cap** (2-12 hours depending on stage) is the absolute
  last resort for unreachable Herdr connections.

### Verify → Implement Loop

If the verifier finds issues, it sends findings back to the implementer. This
loop can run up to 5 times. On the 5th bounce, the pipeline enters **fallback
recovery** — the review captain receives diagnostic context and decides whether
to retry, create a PR for manual review, or reject.

## Working Modes

### Root Mode (`--root` / `-r`)

Works directly in your repo root on a `contract/C-XXX` branch. No worktree
isolation — all file changes are visible in your working tree.

```bash
bun run contract C-370 --root
bun run contract --source prompt --root
```

**Behavior:**
- Creates or switches to branch `contract/C-XXX`
- Refuses to switch if the working directory is dirty (uncommitted changes)
- Use `--dirty` to carry changes over: `bun run contract C-370 --root --dirty`

### Starting With Uncommitted Changes (`--dirty`)

`--root` refuses to switch branches when your working tree has uncommitted
changes (staged or modified files). `--dirty` tells the pipeline to switch
anyway and carry your changes onto the `contract/C-XXX` branch:

```bash
# You have edits in progress but want to start a contract run anyway:
bun run contract C-370 --root --dirty
bun run contract --source prompt --root --dirty
```

This is useful mid-feature when you want to spin up a related contract without
stashing. Your uncommitted changes ride along on the new branch and are visible
to the pipeline agents.

### Worktree Mode (default)

Creates an isolated Git worktree at `.pi/workspaces/<run-id>/`. The worktree
has its own branch, working directory, and index — your repo root stays clean.

```bash
bun run contract C-370          # worktree (default)
```

Worktrees are automatically cleaned up after merge or rejection. You can list
active worktrees with:

```bash
bun workspace:list
```

### When to Use Each

| Scenario | Mode |
|----------|------|
| Interactive feature development | Root |
| Chat-drafting a new contract | Root |
| Background/CI pipeline run | Worktree |
| Multiple concurrent contracts | Worktree |
| Want to inspect/edit files during pipeline | Root |

## CLI Options — Full Reference

```
bun run contract [target] [--source <mode>] [options]
```

| Option | Description |
|--------|-------------|
| `--source prompt` | Open the interactive writer — you describe the feature in the chat (default with no target) |
| `--source issue` | Freeze a contract from a GitHub Issue/Roadmap item (alias: `--issue <#\|url>`) |
| `--source <path\|C-XXX>` | Use an existing contract — skip writer + critique, start at implementation |
| `--source todo` | Legacy: parse `docs/TODO.md` for the backlog item |
| `--root, -r` | Work on branch `contract/C-XXX` in the repo root |
| `--dirty` | Allow branch switch with uncommitted changes (only with `--root`) |
| `--resume <run-id>` | Resume an incomplete pipeline run |
| `--fresh` | Start a brand-new run (skip auto-resume detection) |
| `--dry-run` | Resolve contract and create manifest without starting agents |
| `--background` | Internal mode; do not attach Herdr |
| `--no-attach` | Run pipeline in background without auto-attaching to Herdr |
| `--ready` | Create PR as ready-for-review (skip draft); triggers CodeRabbit immediately |
| `--yolo` | Fully automated pipeline — no human in the review loop |
| `-h, --help` | Show help |

## Contract Lifecycle

```
draft → approved → in_progress → implemented → verified → completed
                  ↘ verification_failed → implemented (retry)
draft → blocked
draft → superseded
```

| Status | Set By | Meaning |
|--------|--------|---------|
| `draft` | Writer | Contract written, not yet approved for implementation |
| `approved` | Critic | Reviewed and approved; ready to implement |
| `in_progress` | Pipeline | Implementation has started |
| `implemented` | Implementer | Code written, tests pass, handoff report appended |
| `verified` | Verifier | All ACs confirmed independently |
| `completed` | Orchestrator | Merged and CI passed |
| `verification_failed` | Verifier | Issues found; returns to implementer |
| `blocked` | Any agent | Cannot proceed due to dependency or blocker |
| `superseded` | Manual | Replaced by another contract |

## YOLO Mode — Fully Automated Pipeline

```bash
bun run contract C-370 --root --yolo
```

In YOLO mode, the review stage is **fully automated**:

1. Verification passes → branch is pushed
2. Review captain creates a PR (not draft) immediately
3. CodeRabbit reviews the PR
4. Captain applies autofixes via `@coderabbitai autofix`
5. If all findings resolved → captain merges
6. If autofix cycles exhausted (2 max) → pipeline degrades to manual review

Use YOLO for low-risk, well-tested contracts where you trust the
implementer + verifier quality.

## Common Workflows

### Workflow 1: New Feature from Scratch

```bash
# 1. Chat-draft the contract
bun run contract --source prompt --root

# 2. Describe your feature in the writer pi session
#    "I want a crafting system where players combine items..."

# 3. Writer creates the contract → critique → implement → verify
#    The pipeline runs automatically through all stages.

# 4. At the review stage, review the PR, check CodeRabbit findings
#    Approve with: "merge it" or "looks good"

# 5. The orchestrator merges and cleans up.
```

### Workflow 2: Existing Contract

```bash
# 1. You already have a contract (e.g. from a previous writer session)
bun run contract C-370 --root

# 2. Pipeline skips writer + critique and runs: implement → verify → review

# 3. At review, if you want changes:
#    "needs changes" → back to implementer for fixes

# 4. Merge when ready.
```

### Workflow 3: GitHub Issue to Contract to PR

```bash
# 1. Freeze the issue as a contract
bun run contract --source issue #102

# 2. Run through the pipeline
bun run contract C-XXX --root

# 3. The review captain creates a PR linked to the issue
#    PR body auto-includes "Closes #102"

# 4. Merge closes the issue automatically.
```

### Workflow 4: YOLO for Quick Fixes

```bash
# Small bug fix, well-understood scope
bun run contract --source prompt --root --yolo

# Describe the bug → pipeline auto-runs through merge
# No human review needed — CodeRabbit handles it.
```

### Workflow 5: Resume After Interruption

```bash
# If the pipeline was interrupted (crash, reboot, etc.):
bun run contract C-370 --root --fresh   # start over
bun run contract --resume <run-id>      # resume from last checkpoint
```

## File Layout

```
docs/
├── TODO.md                          # Backlog ingestion buffer
├── contracts/
│   ├── TEMPLATE.md                  # Canonical contract template (v2.0.0)
│   ├── INDEX.md                     # Priority ranking (read-only)
│   ├── PROGRESS.md                  # Auto-generated status dashboard
│   ├── PROMOTION.md                 # Promotion lifecycle matrix
│   ├── SHARED_SECTIONS.md           # Shared reference sections
│   └── C-XXX-slug.md                # Individual contract files
└── guides/
    ├── contract-pipeline.md         # This document
    └── dev-workflow.md              # Daily development guide

.pi/
├── contract-runs/<run-id>/          # Pipeline run manifests + logs
│   ├── manifest.json
│   ├── pipeline.log
│   ├── prompts/                     # Stage prompts (debugging)
│   └── stages/                      # Stage result artifacts
└── workspaces/<run-id>/             # Git worktrees (auto-cleaned)
```

## Contracts Directory

Contracts live in `docs/contracts/` (a separate repo, gitignored inside main).

- **Creating**: Use `bun run contract` (interactive writer), `bun run contract --source issue <#|url>`, or write manually from `TEMPLATE.md`
- **Reading**: `INDEX.md` for priority order, `PROGRESS.md` for status dashboard
- **Syncing**: `bun run sync:roadmap` syncs contract statuses to GitHub Project #1

### Contract Naming

```
C-370-lpc-paperdoll-rendering.md
│     │
│     └─ Slug derived from title (lowercase, hyphenated, ≤60 chars)
└─ Stable ID (never reused even if the contract is superseded)
```

Direct-draft placeholders are named `C-XXX.md` (no slug) until the writer
renames them to `C-XXX-<slug>.md`.

## GitHub Integration

### Roadmap (Project #1)

Contract statuses map to GitHub Project v2 columns automatically:

| Contract Status | Roadmap Column |
|----------------|----------------|
| `draft`, `approved` | Todo / Backlog |
| `in_progress` | Implementing |
| `implemented` | Verifying |
| `verified`, `completed` | Done |

Sync with: `bun run sync:contracts`

### PR → Issue Linkage

When the review captain creates a PR:
- PR body includes `Closes #<issue_number>` for issue-sourced contracts
- The contract's `github.pr_url` is set in YAML frontmatter
- The roadmap item transitions to **In Review**

When the PR is merged:
- `bun run sync:prs` auto-updates contract status to `verified`
- The linked GitHub Issue is closed
- The roadmap item moves to **Done**

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CONTRACT_PIPELINE_BASE_BRANCH` | Target branch for PRs | `main` |
| `CONTRACT_PIPELINE_HEADLESS` | Force JSON mode (no TUI) | unset (auto-detect) |
| `CONTRACT_STAGE_IDLE_TIMEOUT_MS` | Idle timeout per stage | `600000` (10 min) |
| `CONTRACT_SKIP_POSTCONDITIONS` | Skip role-boundary checks | unset |

## Troubleshooting

### Pipeline stuck on a stage

Check if the worker agent is still active:
```bash
herdr pane list --workspace aikami-contract-C-XXX
```

If the agent completed but forgot to call `contract_stage_complete`, kill the
run and resume:

```bash
bun run contract --resume <run-id>
```

### "Working directory is dirty" with --root

```bash
# Option 1: Stash changes
git stash
bun run contract C-370 --root

# Option 2: Carry changes over
bun run contract C-370 --root --dirty
```

### Orphaned worktrees

```bash
bun workspace:list        # List active worktrees
bun workspace:cleanup     # Remove all
```

### Contract not found error

`bun run contract C-999` errors when the ID has no file in `docs/contracts/` and
no entry in `docs/TODO.md`. Create the contract first with `bun run contract`
(interactive writer) or `bun run contract --source issue <#|url>` (freeze from
GitHub).

## Reference

- **Contract template**: `docs/contracts/TEMPLATE.md`
- **Backlog**: `docs/TODO.md`
- **Status dashboard**: `docs/contracts/PROGRESS.md`
- **Daily dev guide**: `docs/guides/dev-workflow.md`
- **Testing conventions**: `docs/guides/TESTING.md`
- **Coding standards**: `docs/guides/CODING_STANDARDS.md`
- **Implementation skill**: `.pi/skills/contract-implementer/SKILL.md`
