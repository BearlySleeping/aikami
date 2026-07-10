---
description: Implement a contract from docs/contracts/ — plan → build → QA → docs → archive
argument-hint: "[contract name or leave empty to pick next pending]"
---

# Contract Implementation Workflow

User input: $ARGUMENTS

Single-session flow. You are architect, coder, QA, and docs writer in sequence.
Load the `aikami-conventions` skill BEFORE writing any code. If frontend UI: also `aikami-ui` + `svelte-page`. If game code: `pixijs-v8`. If Cloud Functions: `firestack`. Testing phase: `testing`.

## Phase 1: Load & Plan (architect)

1. Read `docs/contracts/PROGRESS.md` — check in-progress/completed. If picking next: read `docs/contracts/INDEX.md` for priority (INDEX.md is READ-ONLY — never edit it).
2. Read the contract fully: data model, acceptance criteria, test hooks, scope boundaries.
3. Run `moon_detect_affected` to see current project state.
4. Draft a short file plan (in your head or a scratch list — no plan files). Validate every planned path against the placement matrix:
   - Cross-project data shapes / types → `packages/shared/types/` — derived via `Static<typeof Schema>` when a schema exists, NEVER a parallel manual interface
   - Runtime validation shapes (API inputs, Firestore docs, bridge payloads) → `packages/shared/schemas/` as TypeBox
   - Constants, labels, dictionaries, provider registries, error codes → `packages/shared/constants/`
   - UI state flags (visibility, modals, loading, selection) → `*_view_model.svelte.ts`
   - ViewModels are thin bridges: no repository imports, no direct Firestore, no `app.ticker`. Services own data. Engine owns the ticker.
5. 🔴 SvelteKit route groups use LITERAL parentheses: `(dev)`, never `\(dev\)`. In bash, quote the path: `mkdir -p 'src/routes/(dev)/dev/foo'`.

## Phase 2: Implement (coder)

For each acceptance criterion:
1. Create/modify files per the plan. Follow `aikami-conventions` (snake_case files, ViewModel factory pattern, Svelte 5 runes, arrow fns, `$logger`, package-root imports, private `_` prefix).
2. Run `moon_run_task` fix+typecheck per project as you go — NOT raw bun commands. Max 3 fix iterations per failure before stepping back to rethink.
3. Commit in logical groups only when asked (see Hard Rules).

## Phase 3: QA & Verification

Do NOT skip this phase — a contract is not done until it is verified live.

1. **Self-audit** (deterministic greps on files you created — fix any hit):
   - `pixi.js` / `@pixi/` imports in `*_view_model.svelte.ts` or `.svelte` files → violation
   - `app.ticker.add` outside `packages/frontend/engine/` → violation
   - `Type.Object|Array|String|...` (TypeBox) inside `**/services/**` → violation (schemas live in `packages/shared/schemas/`)
   - Label/dictionary constants (`_LABELS`, `_DICT`, `PHASE_`) in ViewModels → move to `packages/shared/constants/`
2. **Dev sandbox** (if the contract has UI or a Dev Sandbox AC): create the page under `routes/(dev)/dev/<feature>/` with a thin `+page.svelte` that mounts a `$views/dev/*` view + ViewModel. Include `<div data-testid="game-ready" class="hidden"></div>` for the visual runner when relevant.
3. **Live check** (UI contracts): ensure client dev server is running in emulator mode — `herdr_session status`, start/restart client via `herdr_session restart client` if you added routes. Then:
   - `browser_screenshot` the dev sandbox route
   - `ai_validate_image` with a concrete expectation derived from the AC
   - Fix and re-verify if score < 80
4. **E2E + visual tests** (when the contract's Test Hooks specify them — they usually do):
   - Playwright spec in `apps/e2e/tests/client/<feature>.spec.ts` using POMs from `$pom` (create/extend POM if needed)
   - Visual suite in `apps/e2e/src/visual/suites/<feature>.visual.ts` using `defineConfig` + `export default`
   - Run them per `.pi/skills/testing/SKILL.md`. Fix failures (max 3 iterations, then report honestly).

## Phase 4: Validate

1. `validate({ test: true })` — fix+typecheck+build+test on all affected.
2. If errors: fix and re-run until clean.
3. Walk each AC and confirm it is actually met — no aspirational ✅.

## Phase 5: Docs

Decide from the contract's Target/Overview:
- **User-facing feature** (player/creator can see or use it) → write/update a SHORT page (1-3 paragraphs, link to source) in `apps/frontend/docs/src/content/docs/`.
- **Internal/refactor/infra** → no docs page.
- Either way, the execution report (Phase 6) is mandatory.

## Phase 6: Log & Archive

1. Add `<!-- completed: YYYY-MM-DD -->` as the FIRST line of the contract file.
2. Set the `**Status**` metadata field to `completed`.
3. Append the Execution Report (Summary, AC Status table, Files created/modified, Deviations, Test Results) to the BOTTOM of the contract file. Contract stays self-contained.
4. Run `bun knowledge:sync` — regenerates PROGRESS.md from contract files. 🔴 NEVER hand-edit PROGRESS.md or INDEX.md.
5. Present a diff summary + suggested Conventional Commit message (e.g., `feat(client): add session management`).
6. Ask: "Commit? Commit+push? Continue to next contract?"

## Hard Rules

- Never push without explicit instruction
- One contract at a time
- `validate()` for final verification — not raw fix/typecheck/test commands
- `moon_run_task` for per-project operations
- 🔴 NEVER run long-lived servers (`vite dev`, `bun run dev`, `moon run :dev`) in the main thread — use `herdr_session` / `firebase_emulator`
- 🔴 Route groups: literal `(dev)` — a `\(dev\)` directory breaks the route tree
- Report failures honestly — a partial implementation with a truthful report beats a fake ✅
