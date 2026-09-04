# PR 02 — repair active agent instructions

One-off task prompt, not a new always-discovered Pi skill. Parent: [execution plan](../agent-platform-hardening.md).
Dependency: C-468 merged. Executor: DeepSeek V4 Flash, high. Target: 20–45 changed files; maximum 99.

## Task

Correct active skills, role prompts, agent documentation and their generators to describe the running repository accurately. This is a bounded instruction repair, not an application refactor. The maintainer explicitly permits correcting coding standards, including inaccurate static/dynamic-import guidance.

Work in a dedicated branch/worktree. Do not edit global files under the maintainer's home directory, other agents' worktrees, existing unrelated contracts, INDEX.md or generated dashboards. Existing global-skill conflicts should be reported and addressed through project configuration in C-474, not silently patched on one machine.

## Inspect first

- `AGENTS.md`, `.pi/README.md`, `.pi/settings.json`.
- `.pi/skills/aikami-conventions/SKILL.md`, `svelte-conventions`, `testing`, `project-commands`, `git-worktree`, `contract-implementer` and relevant UI/backend skills.
- `.pi/prompts/contract-create.md`, `contract-implement.md`, `contract-verify.md`, review profiles and `yolo-overrides.md`.
- `.context/CONTEXT.md`, `.context/index.md`, relevant active architecture/setup guides.
- `scripts/src/lib/ops/generate_context.ts`, `generate_llms_txt.ts`.
- `.pi/extensions/moon_integration.ts`, `.pi/extensions/contract_pipeline.ts`, `scripts/src/lib/agents/contract_pipeline/prompt_loader.ts`, `models.ts`, `scripts/src/lib/herdr/session.ts`.

Resolve versions, aliases, service names, tools and supported parameters from actual configuration/registration. Do not repeat old architectural claims from a contract merely because it has an approved status. Keep historical contracts historical rather than sweeping the archive.

## Required corrections

1. Remove active Firebase/Cloud Run/Data Connect requirements that no longer apply. Preserve explicitly marked historical/migration discussion and any genuinely still-used infrastructure. Keep device-local Turso separate from server D1 and blob R2; offline boot/play/save must not acquire cloud dependencies.
2. Replace obsolete tool names with actual namespaced call shapes, especially `contract_stage` action `complete` and `review_decision`. All sample action/decision values must be accepted by the registered schema. Remove unsupported multi-service tool calls.
3. Make service setup conditional on the acceptance checks. Do not start GPU/voice/image/text or require a browser for a docs-only or pure-script task. Do not automatically restart shared infrastructure. Do not declare the future ownership fixes implemented before C-471 lands.
4. Correct import guidance: static imports are the ordinary dependency default; dynamic imports can reduce initial load/parse/execute cost when they create a real lazy boundary. Total emitted assets and initial loaded code are different metrics. Static reachability can defeat splitting. Do not claim barrels prevent duplicate instances or Workers cannot be tree-shaken. Keep measured exceptions; do not convert application imports in this PR.
5. Reconcile ViewModel examples with the chosen factory/export convention and method syntax. Distinguish architecture invariants from stylistic preferences. Do not mandate architectural scaffolding for a tiny pure helper merely to satisfy an example.
6. Stop claiming the current agent `validate()` is identical to all guards/CI. Until C-469 lands, prescribe explicit scoped checks and preserve failed exit codes. A CodeRabbit review or visual model score is not proof that application tests passed.
7. Correct current branch/worktree locations and approval/status instructions. Reuse implemented C-450 status tooling; no new status updater or historical backfill.
8. Fix generators before regenerating active context; do not reintroduce Zod or obsolete service maps. Keep generated outputs deterministic where practical. Avoid publishing the entire archive as mandatory reading.

## Scope fences

No mass alias migration from docs/TODO.md item 6. No application behavior changes, tool-registration redesign, model routing changes, lock/service ownership changes, or automatic resource updates. Changes to TypeScript files are limited to instruction strings and correcting documentation generation; add focused tests for changed generator behavior. Broad skill routing/size changes belong to C-474; automated drift enforcement belongs to C-475.

Do not overwrite vendored upstream skills for a transient local correction. Put project-specific rules in the project layer and record any upstream discrepancy; C-478 will own a reproducible patch/update mechanism.

## Acceptance / handoff

- Record the active source of truth for architecture, services, imports, validation and completion calls, plus the files corrected.
- All corrected tool examples match the registered names/actions/parameters. Run the registration tests fixed in C-468; manually enumerate remaining old-name hits and classify historical mentions instead of blindly replacing them.
- Run contract/prompt registration tests and focused generator tests where affected; retain exact commands and exit codes. No paid model calls, browser runs or dev-server startup are required for this documentation task.
- Review the final diff for instruction contradictions and references to unimplemented future guarantees. `git diff --check` passes; fewer than 100 changed files.
- PR body states this is instruction repair, lists any personal/global configuration follow-up, and does not claim the pipeline bugs themselves are fixed.
- Stop for CodeRabbit and human review. No merge without explicit approval.
