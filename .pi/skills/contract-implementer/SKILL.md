---
name: contract-implementer
description: >-
  Implements Aikami features from contract specifications in docs/contracts/ (docs/ is a separate repo cloned inside main, gitignored).
  Flow: plan → implement → QA (sandbox + E2E + visual) → validate → docs → handoff. Use when implementing features
  defined in docs/contracts/*.md. PROGRESS.md is auto-generated via `bun knowledge:sync`; INDEX.md is read-only;
  execution reports live at the bottom of individual contract files.
  Also covers GitHub Roadmap integration via `bun run contract --issue` and PR-contract lifecycle linkage.
---

# Contract Implementer

The authoritative phase-by-phase flow lives in the `/contract` prompt (`.pi/prompts/contract.md`). This skill carries the supporting reference material.

For the complete pipeline user guide (source modes, CLI options, workflows), see:
📄 **`docs/guides/contract-pipeline.md`**

## Sources of Truth

| File | Role | Writable? |
|---|---|---|
| `docs/contracts/TEMPLATE.md` | Contract template — single source of truth | ✅ (reviewed deliberately) |
| `docs/contracts/C-*.md` | Contract spec + execution report at bottom | ✅ (Status field, report) |
| `docs/contracts/INDEX.md` | Priority ranking | 🔴 READ-ONLY — never edit |
| `docs/contracts/PROGRESS.md` | Status dashboard | 🔴 AUTO-GENERATED — run `bun knowledge:sync`, never hand-edit |
| `docs/TODO.md` | Backlog ingestion buffer | ✅ (parsed by `parseBacklog`) |
| GitHub Issues | Macro backlog authority | ✅ (sync via `bun run contract --issue`) |
| GitHub Project #1 | Roadmap board | ✅ (managed via contract pipeline) |

## Contract YAML Frontmatter

Every contract MUST have YAML frontmatter at the top:

```yaml
---
id: C-XXX
title: "Feature Title"
source: "todo | roadmap | direct"
status: draft
github:
  issue_number: 123
  issue_url: "https://github.com/..."
  project_item_id: null
  pr_url: null
created_at: "2026-07-26T15:30:00Z"
---
```

- `source`: How the contract was created — `todo` (from TODO.md), `roadmap` (from GitHub Issue), `direct` (interactive)
- `github`: Populated when synced with GitHub. `pr_url` is set when a PR is created for this contract.
- `status`: Uses the contract lifecycle status (see below).

## Status Lifecycle & Roadmap Mapping

```
draft → approved → in_progress → implemented → verified → completed
                                      ↘ verification_failed → implemented
draft → blocked
draft → superseded
```

Contract statuses map to GitHub Project v2 roadmap columns:

| Contract Status | Roadmap Column |
|---|---|
| `draft`, `approved`, `todo` | **Todo** / Backlog |
| `in_progress` | **Implementing** |
| `implemented` | **Verifying** |
| `review`, `in_review` | **In Review** |
| `verified`, `done`, `completed` | **Done** |
| `verification_failed` | **Implementing** (back to implement) |

Sync commands:
- `bun run contract` — Interactive contract pipeline (primary interface)

## PR & Issue Linkage

When a PR is created for a contract (via `gh_create_pr` or the contract pipeline):
- The PR body auto-includes `Closes #<issue_number>` if the contract has a linked GitHub Issue.
- The contract YAML frontmatter should be updated with `pr_url`.
- The roadmap item transitions to **In Review**.

When the PR is merged:
- Run `bun run sync:prs` to auto-update the contract status to `verified`.
- The roadmap item moves to **Done**.
- The linked GitHub Issue is closed.

- `draft`: contract written but not approved for implementation.
- `approved`: contract reviewed (via `/contract-critique`) and approved by user.
- `in_progress`: implementation has started.
- `implemented`: implementer believes code is ready. Set BY `/contract` prompt.
- `verified`: independent verifier passed all mandatory ACs. Set BY `/contract-verify` prompt.
- `completed`: merged and CI passed. Set manually after merge.
- `verification_failed`: verifier found issues. Returns to implementer.
- `blocked`: cannot proceed due to unresolved dependency.
- `superseded`: replaced by another contract.

## Contract Source Modes

Contracts can be created from three sources via `bun run contract [ID] --source <mode>`:

| Mode | Command | Description |
|---|---|---|
| `todo` (default) | `bun run contract C-370` | Parse docs/TODO.md, generate from backlog item |
| `roadmap` | `bun run contract #102 --source roadmap` | Fetch GitHub Issue, freeze into contract |
| `direct` | `bun run contract --source direct` | Interactive step-by-step drafting session |

## Working Modes: Worktree vs Root

Two working modes are supported when running a contract pipeline:

| Mode | Command | Description |
|---|---|---|
| **Worktree** (default) | `bun run contract C-370` | Creates isolated `.pi/workspaces/` worktree for background agents |
| **Root** | `bun run contract C-370 --root` | Starts on branch `contract/C-370` in the repo root before launching pipeline |
| **Root + dirty** | `bun run contract C-370 --root --dirty` | Switches branch carrying uncommitted changes over |

### Root Mode Behavior
- Derives branch name `contract/C-XXX` from the contract ID.
- Checks for dirty working directory via `git status --porcelain`.
- **Without `--dirty`**: Fails fast with a clear error if uncommitted changes exist.
- **With `--dirty`**: Executes `git checkout -b contract/C-XXX` directly, carrying over staged/unstaged changes.
- Sets up the target branch in the root directory before launching the pipeline; worktrees may still be used by individual pipeline stages.

### When to Use Each
- **Worktree**: Default mode for background/automated pipeline runs, multi-agent isolation, CI/CD.
- **Root**: Start the pipeline from a specific branch in your working tree; useful when you want to prepare the branch state before pipeline execution.

## Handoff Protocol

1. Update `**Status**` metadata field to `implemented` — NOT `completed`.
2. Append Execution Report to the BOTTOM of the contract file:
   - Summary (2-4 sentences)
   - AC Status table (per-AC ✅/⚠️/❌ with one-line note — be honest about partials)
   - Files created / modified tables
   - Deviations from spec + rationale (any unapproved AC changes → propose Amendment)
   - Test results (unit / E2E / visual / baseline, with exact counts)
3. Knowledge sync ownership:
   - Automated contract pipeline: skip manual sync; the pre-commit hook regenerates and stages dashboards.
   - Manual implementation session: run `bun knowledge:sync` only when reviewers need current dashboards before commit.
4. Hand off for independent verification via `/contract-verify`.
5. Do NOT commit/push without explicit instruction.

## Sandbox Rule (changed)

Dev sandboxes are **OPTIONAL**. Create one only when it helps isolate:
- Pixi rendering or engine behavior
- A reusable component in controlled states
- A deterministic visual state for testing

**Production path is MANDATORY** for user-facing contracts. The feature must work through the real game/application flow.

## QA Requirements

A contract is NOT ready for handoff without:

### User-facing contracts
- Production-route E2E spec in `apps/e2e/tests/client/<feature>.spec.ts` using `$pom` POMs
- Visual suite in `apps/e2e/src/visual/suites/<feature>.visual.ts` where visual appearance is an AC
- Live verification: production route screenshot + `ai_validate_image` score ≥ 85
- State persistence check (reload → state survives) if persistence is an AC
- Error/degraded path check if offline behavior is an AC

### All contracts
- Focused tests for each AC — written before or alongside implementation
- `validate({ test: true })` passes with no new baseline failures
- Self-audit grep checks pass

### Optional: Dev sandbox
- `routes/(dev)/dev/<feature>/+page.svelte` mounting a `$views/dev/*` view + ViewModel
- Sandbox screenshot + `ai_validate_image` for visual regression

See `.pi/skills/testing/SKILL.md` for suite/POM patterns and run commands.

## Callable Functions (4-layer typed pattern)

1. Types: `packages/shared/types/src/lib/api/{name}.ts`
2. Registry: `callable_functions.ts`
3. Controller: `apps/backend/firebase/src/controllers/callable/{name}.ts`
4. Frontend: `firebaseFunctionsService.getTypedCallable('name')`

## Contract → Location Mapping

Use this decision tree BEFORE writing Architecture Directives in a contract.
Not every endpoint belongs in Firebase Functions.

```
Is the logic…
├─ Local filesystem operation (scan, read, write, serve files from disk)?
│  → packages/frontend/engine/src/ or apps/frontend/client/src/
│
├─ Heavy local processing (AI inference, image gen, TTS)?
│  → apps/backend/{image,text,voice}/ (local microservices)
│
├─ Business logic that needs Firebase Auth + Firestore/Storage?
│  ├─ Called by signed-in client? → controllers/callable/
│  ├─ Called by external services (webhooks, public API)? → controllers/api/
│  └─ Triggered by Firestore/Auth/Storage events? → controllers/firestore|auth|storage/
│
├─ Shared types, schemas, constants (no runtime)?
│  → packages/shared/{types,schemas,constants}/
│
└─ Backend library code (reusable across services)?
   → packages/backend/{ai,auth,chat,database,utils}/
```

🔴 **Golden rule**: If the operation touches `fs.readdirSync`, `writeFileSync`,
`createReadStream` on a non-`/tmp` path, or serves binary files from a local
directory — it CANNOT go in `apps/backend/firebase/src/controllers/`. Cloud
Functions are stateless and ephemeral; they have no persistent filesystem.

Static mapping (legacy reference):

```
client-*    → apps/frontend/client/src/
site-*      → apps/frontend/site/src/
shared-*    → packages/shared/{types,schemas,constants}/
backend-*   → packages/backend/{ai,auth,chat,database,utils}/
firebase-*  → apps/backend/firebase/src/
```

## Key Rules

- `validate({ test: true })` for final verification; `moon_run_task` for per-project fix/typecheck
- Never commit or push without explicit instruction
- One contract at a time; report failures honestly
- End at `implemented` — independent verifier handles the rest
- Scope changes without Amendment entries prevent `verified` status
