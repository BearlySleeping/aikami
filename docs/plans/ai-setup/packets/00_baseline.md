# P00 — establish the baseline (only entry point)

Mode: read-only investigation; no application edits, installs, commits, publishing or model downloads.
Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Read [dispatch rules](../dispatch.md) and [execution plan](../README.md).
Dependencies: none. Parallel: contract critique by another read-only agent is safe.

## Goal

Produce the approved-baseline proposal and evidence needed to dispatch small repairs without overwriting existing work or treating historical test counts as current facts.

## Inspect

- Git branch/head/status and the diff limited to settings, capability, config, Tauri and local-stack paths. Do not read secret values or unrelated large diffs.
- The initial research saw 25 dirty/untracked paths at `3bb9af3b`, including settings views, Tauri config, local model storage and tests. This is a warning, not permission to adopt those changes.
- Existing C-463/C-465/C-466/C-467 metadata and relevant acceptance claims; distinguish implemented from independently verified.
- Current package/Moon definitions for client, schemas, types, constants, local-ai, local-runtime, ai-gateway, local-stack and E2E; confirm actual project/task names before scheduling them.
- Current config/capability/AI-settings/sidecar/wizard tests, production routes `/capability`, `/settings`, `/setup`, and existing POM/visual conventions.
- `scripts/src/lib/agents/contract_pipeline/models.ts`: record effective model overrides/account route without exposing keys. Both default paid tiers currently point to Flash via DeepInfra.
- Native packaging/release configuration: distinguish real signed engine artifacts from development stand-ins, and list platforms actually verifiable with available tools/hardware.

## Baseline checks

Use `moon_detect_affected`, then registered focused baseline tasks via `moon_run_task`. Test-generated ignored caches are fine; no tracked source changes or automatic formatter fixes.
Use `bg` for any finite native check without a Moon task. Do not start or stop another agent's server or change deployment mode.
Record exit codes and exact failing test IDs. A missing dependency/tool is a blocker with evidence, not a passing baseline.
Do not make live paid API calls or download models to establish the baseline. Network/provider behavior uses fixtures.

## Required handoff

1. Current branch/head and a concise inventory of relevant dirty files with known/unknown ownership.
2. Proposed baseline: current approved main plus which user changes need separate resolution. Ask the user to choose; never stash, commit or reset on their behalf.
3. Current task map with project IDs, finite test/build commands and required client preload/E2E service configuration.
4. Baseline failures and verification gaps, separated by application, native packaging and environment.
5. File ownership ledger for P01–P04 and R01; reserve shared test preload/POM/barrel files to one integration owner.
6. Effective worker model/thinking/provider/billing route; premium critique requires separate account confirmation.
7. Contract critique findings, if any, that prevent approval of C-481/C-482/C-483/C-484.
8. The next eligible packet: P01 only after the human confirms baseline and dispatch.

## Stop

Return the report; do not execute P01, automatically approve contracts, provision worktrees, or alter the user's current work.
The baseline packet is not itself a code PR and does not consume an hourly CodeRabbit review slot.
