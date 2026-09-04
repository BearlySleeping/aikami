# Agent platform hardening — execution plan

Status: proposed execution pack; contracts are **draft**, not implemented or individually approved.
Baseline: `f73e5fae`, audited 2026-09-04. This planning PR changes documentation only.

## Outcome and boundaries

Make Aikami's agent workflow trustworthy, inexpensive to operate, and approachable on NixOS/Linux, macOS and native Windows. Keep Moon, Biome, Pi, Herdr, worktrees, existing process helpers and contract verification. Improve them incrementally; do not introduce a replacement workflow platform.

“100x” is an ambition, not a measurable acceptance threshold. Success means fewer false-green gates, no cross-run damage, reproducible setup, lower cost/time per accepted task, and explicit evidence for supported platforms. No contract may claim a speedup without a comparable baseline.

**One entry point: C-468.** Start outside the automated contract pipeline: its dependency loading, validation and locking are among the things being repaired. Use an ordinary agent session in a dedicated worktree. Initial repairs must not depend on a successful automated pipeline run.

This pack deliberately excludes gameplay work, mass alias migrations, cloud deployment, upstream Herdr rewrites and a repo-wide TypeScript cleanup. C-449 AC-4 already owns maintainer Cloudflare/SOPS onboarding; C-479 owns the credential-free contributor path and links to that existing work. C-450 owns historical contract-status reconciliation; do not repeat that sweep. Unrelated C-466/C-467 remain untouched.

## PR map and initial model allocation

One row = one intended implementation PR. File ranges are planning estimates, not permission to expand scope. Count additions, modifications, renames, deletions, lockfiles and generated files in the actual GitHub diff.

| Order | Artifact | Outcome | Executor / thinking | Target changed files | Prerequisites |
|---|---|---|---|---|---|
| 01 | [C-468](../contracts/C-468-agent-test-foundation.md), thin | Repair Pi dependency loading; deterministic automation CI | Claude Sonnet 5 / medium | 5–15 | None |
| 02 | [Task prompt](agent-platform-hardening/instruction-repair.md) | Correct active instructions and generators, not application imports | DeepSeek V4 Flash / high | 20–45 | C-468 |
| 03 | [C-469](../contracts/C-469-revision-bound-validation.md), full | Canonical fail-closed validation and revision-bound promotion | Claude Sonnet 5 / high | 10–30 | C-468; PR 02 |
| 04 | [C-470](../contracts/C-470-pipeline-ownership.md), full | Safe locks, ID allocation and result ownership | Claude Opus 5 / high | 8–20 | C-468, C-469; PR 02 |
| 05 | [C-471](../contracts/C-471-owned-service-lifecycle.md), full | Owned service lifecycle and application readiness | Claude Sonnet 5 / high | 10–30 | C-468, C-470; PR 02 |
| 06 | [C-472](../contracts/C-472-testable-worker-lifecycle.md), full | Testable lifecycle controller and supported Herdr transport | Claude Sonnet 5 / high | 12–35 | C-469, C-470, C-471 |
| 07 | [C-473](../contracts/C-473-pipeline-usage-ledger.md), full | Complete attempt/run accounting | Claude Sonnet 5 / medium | 8–20 | C-472 |
| 08 | [C-474](../contracts/C-474-role-context-profiles.md), thin | Lean role contexts and explicit model configuration | Claude Sonnet 5 / medium | 8–25 | C-473; PR 02 |
| 09 | [C-475](../contracts/C-475-executable-agent-guidance.md), thin | Tested examples and instruction-drift checks | Claude Sonnet 5 / medium | 10–30 | C-474; PR 02 |
| 10 | [C-476](../contracts/C-476-strictness-coverage-ratchet.md), thin | Close enforcement gaps without a mass migration | Claude Sonnet 5 / medium | 10–40 | C-469, C-475 |
| 11 | [C-477](../contracts/C-477-compiled-svelte-lifecycle-tests.md), full | Real reactivity/lifecycle tests alongside pure Bun tests | Claude Sonnet 5 / high | 8–25 | C-468, C-475 |
| 12 | [C-478](../contracts/C-478-reproducible-agent-resources.md), thin | Pinned resources and reproducible update provenance | DeepSeek V4 Flash / high | 8–20 | C-468, C-474, C-475 |
| 13 | [C-479](../contracts/C-479-portable-contributor-onboarding.md), full | Credential-free contributor onboarding on three OS families | Claude Sonnet 5 / high | 10–30 | C-471, C-472, C-478 |
| 14 | [C-480](../contracts/C-480-agent-evaluation-and-routing.md), thin | Reproducible agent evaluations and measured routing | Claude Sonnet 5 / medium | 8–20 | C-473, C-474, C-475, C-476, C-477, C-478, C-479 |

These are **model family labels supplied by the maintainer**, not guaranteed provider model IDs. Resolve the installed provider catalogue before launching; record the exact provider/model/version and effective thinking level. Do not silently substitute an unavailable model or invent a CLI slug. All allocations are hypotheses until C-480 measures them.

### Why this allocation

- **Flash/high**: bounded mechanical edits with exact tests and scope. Use its supported native setting; do not assume a wrapper's `medium` has distinct semantics.
- **Sonnet/medium**: ordinary implementation with well-specified boundaries. Use **high** for process lifecycle, portability, validation and compiled reactivity work.
- **Opus/high**: C-470 implementation because ownership mistakes can silently corrupt concurrent work. Also use one pre-implementation design review for C-469/C-470/C-471/C-472. Do not pay Opus to re-read the entire monorepo on every retry.
- **Sonnet/low**: suitable for status summaries or mechanical follow-ups after a diagnosis, not the primary executor of safety-sensitive work.
- **GPT Astra**: optional independent adversarial review of C-469/C-470/C-471/C-472 or a disputed finding. Use the provider's supported high-reasoning setting if available, otherwise its documented default; record which. Do not add it automatically to every stage.

CodeRabbit reviews every implementation PR. Its review is **not** a substitute for the project's CI. One additional model review is enough when warranted; do not run Opus, Sonnet and Astra on every diff. An implementer cannot approve its own exceptions to required gates.

## Execution and merge discipline

1. Review a contract and resolve any changed baseline before promoting it from `draft` to `approved`. Approval of this plan does not mark implementations verified. Keep frontmatter and metadata-table status consistent.
2. Create a fresh worktree/branch from updated `origin/main`. Preserve all other worktrees and the maintainer's root checkout. Use the row's artifact as the task input, not the entire pack as an implementation prompt.
3. Record baseline failures and write a regression test before fixing the behavior. Do not accept a failing baseline as permission to introduce new failures or weaken tests.
4. Implement only that row. Every commit must leave an independently reviewable outcome; dependent PRs wait for prerequisites to merge. Do not create empty PRs for future rows.
5. Run the named focused checks plus the current canonical validation plan. Until C-469 lands, use explicit commands with exit-code capture and run structural guards separately; do not rely solely on the existing `validate()` tool.
6. Publish, obtain CodeRabbit review and required CI evidence, then wait for explicit human merge approval. Revalidate the exact head after any automated or manual review fix.
7. Update the execution report with commands, counts, OS evidence and actual changed-file count. Use normal repository status tooling; do not hand-edit INDEX.md or generated dashboards.

**Diff budget:** aim for 10–40 files; reassess scope at 60; split before exceeding **99 files**. This is stricter than “under 100” being an aspiration. Also assess diff size: a 5,000-line generated file is not a small review merely because it counts as one file. Never omit relevant lockfiles or evidence to meet a count. If a coherent change cannot fit, propose a new independently mergeable contract before proceeding.

**Parallelism:** default to one implementation at a time. C-469/C-470/C-471 share orchestration surfaces: serialize their integration and refresh the next branch after merge. C-476 and C-477 may run concurrently only after a path-level overlap check; serialize shared test/Moon configuration edits. Multiple agents do not imply faster or cheaper work when their diffs collide.

## Platform and environment evidence

| Lane | Required evidence | Frequency / purpose |
|---|---|---|
| Linux native | Unit/process fixtures and minimal contributor bootstrap | Required for affected tooling PRs |
| Native Windows / PowerShell | Same contracts; spaces/Unicode paths, CRLF, process trees, no Git Bash assumption | Required for affected lifecycle/setup PRs; WSL does not count |
| macOS native | Same contracts; BSD tool differences, process shutdown and case-sensitive-safe paths | Required for affected lifecycle/setup PRs |
| Nix + direnv | Locked flake check/devShell smoke; correct env propagation and no unexpected downloads | Path-gated on environment changes |
| Actual NixOS | First rollout and changes to loader/browser/native dependency handling | Local or dedicated-runner evidence; Ubuntu with Nix is not NixOS |

Use a small three-OS tooling matrix, not the full application build on every docs change. Share matrix definitions introduced by C-468 rather than inventing one per contract. Hosted-runner evidence does not prove all CPU architectures or every OS release; reports name the tested versions/architecture. Desktop builds and GPU/local-AI tests remain separate opt-in lanes.

Minimal contributor flow must need no Pi, Herdr, paid AI key, cloud credential, SOPS private key, Docker, or Nix. Bun and Git plus the task-specific system prerequisites are stated accurately. Nix/direnv stays the preferred maintainer path, not a prerequisite for everyone.

## Cross-cutting safety decisions

- Worktree isolation is not an OS security sandbox. Worker capabilities and trusted controller operations must be separated; avoid exposing deploy/merge tools or credentials to implementation roles unnecessarily.
- Gate baseline increases, new suppressions, disabled checks and skipped tests need explicit review. An agent must not edit its evaluator to improve its score.
- No global configuration edits, privilege elevation, automatic upstream Herdr update, arbitrary port killing, production mode switch or deployment during setup/tests.
- Read-only/status/dry-run commands must not allocate IDs, change Git branches, restart services or download packages.
- Keep useful Node-only pure helpers shared with Pi. The backlog suggestion to spawn Bun for every operation is **not** adopted: spawn for actual runtime boundaries, not every pure function; avoid adding subprocess overhead to hot paths.
- Preserve existing manifest/read compatibility and evidence from earlier runs. Unknown/missing metrics are not zero cost. Never fabricate green results for untested platforms.
- New library/runner dependencies require a short necessity/alternatives note and version pin. Reuse existing tooling first.

## Measurement and escalation

Track first-pass acceptance, correctness regressions, tool-call failures, retries, cached/uncached tokens, external review/vision spend, elapsed time and **total cost per accepted task**, including failed attempts. Report missing billing data explicitly.

After two attempts at the same diagnosed failure without evidence of progress: checkpoint the work, capture the failing command and minimal diff, and request one focused diagnosis from Sonnet/high or Opus/high. Do not simply extend every timeout or repeat the entire prompt. Global budgets and any paid benchmark spend remain explicitly authorized by the maintainer; this planning PR authorizes neither.

## Baseline audit evidence (not acceptance evidence)

- Focused pipeline/Herdr suite: 196 pass, about 9.7 s.
- Pi extension suite: 174 pass, 6 fail, 1 error; missing `@earendil-works/pi-server` in the installed dependency graph.
- Local tool measurement: roughly 6,200 tokens / 23 project tools; incomplete because it excludes global/MCP/built-in and skill/context overhead.
- 66 local manifests / 217 attempts had no populated usage records. This is not a model success-rate dataset.
- A failed affected-project query was reproduced as `validate()` code 0.
- Full Moon project JSON was about 1.14 MB, over the parser's 512,000-character limit.
- Live lock replacement was reproduced with a fresh heartbeat and an old manifest transition timestamp.

Reconfirm these observations at each implementation start: the repository and installed packages can change between planning and execution.
