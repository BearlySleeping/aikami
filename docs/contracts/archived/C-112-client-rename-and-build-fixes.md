<!-- completed: 2026-06-29 -->
# Contract C-112: App Rename & Build Fixes (Purist Approach)

## Context

Our desktop application is named `client` and needs to be renamed to `client` to reflect its Tauri architecture. Additionally, the build throws a prerender crawling error on `[chatId]`, and Vite throws an `INEFFECTIVE_DYNAMIC_IMPORT` warning. Instead of suppressing the warning, we will clean up ugly dynamic imports and fix the root static imports causing the bundle pollution.

## Scope

- Rename `apps/frontend/client` -> `apps/frontend/client`.
- Fix ugly dynamic imports in `combat_view_model.svelte.ts`, `npc_repository.svelte.ts`, etc.
- `svelte.config.js` and `src/routes/(authenticated)/chat/[chatId]/+page.ts` (New).

## Acceptance Criteria

- [ ] **Directory & Package Rename:** Rename `apps/frontend/client` to `apps/frontend/client`. Update the `name` field in `package.json` to `@aikami/client`.
- [ ] **Workspace Updates:** Perform a workspace search-and-replace to fix any references to `apps/frontend/client` or `@aikami/client` (check `apps/e2e` scripts, `.moon` configs, etc.).
- [ ] **Fix Crawling Error:** Create `apps/frontend/client/src/routes/(authenticated)/chat/[chatId]/+page.ts` exporting `export const entries = () => [];`. In `svelte.config.js`, add `prerender: { handleUnseenRoutes: 'ignore' }` inside the `kit` object.
- [ ] **Code Smell Cleanup (Ugly Imports):**
    - Replace inline types like `import('@aikami/frontend/engine').EngineBridge` with standard top-level `import type { EngineBridge }`.
    - Replace lazy circular-dependency band-aids like `const { chatRepository } = await import(...)` with standard static imports.
- [ ] **Fix `INEFFECTIVE_DYNAMIC_IMPORT` at the Root:**
    - Do NOT modify `vite.config.ts`.
    - The warning occurs because `@aikami/frontend/engine` is dynamically imported in `game_view_model.svelte.ts`, but it is likely statically imported elsewhere in the app (or re-exported in a barrel `index.ts`).
    - Find all static imports of `@aikami/frontend/engine` in the client app. If they are only used for types, change them to `import type`. If they are runtime imports, remove or refactor them so the engine is strictly lazy-loaded.

## Implementation Notes

1. Run `bun run build` repeatedly while fixing the imports. The goal is for the build to pass silently _without_ adding an `onwarn` suppression to Vite.

---

## Execution Log (2026-06-11)

### Step 1 — Dynamic import cleanup

**combat_view_model.svelte.ts**: Replaced inline `import('@aikami/frontend/engine').EngineBridge` with top-level `import type { EngineBridge }`.

**npc_repository.svelte.ts**: Replaced lazy `await import('@aikami/frontend/repositories/chat.ts')` (sub-path violation) with static `import { chatRepository } from '@aikami/frontend/repositories'` (package root).

**game_view_model.svelte.ts**: Replaced inline `import('@aikami/frontend/engine').EngineBridge` and `.GameWorld` with top-level `import type { EngineBridge, GameCommand, GameWorld }`.

### Step 2 — Static engine import fixes

**chat_view_model.svelte.ts** (PRIMARY ROOT CAUSE): Replaced static `import { createEngineBridge }` with `import type { EngineBridge }` + lazy `_getEngineBridge()` method using `await import('@aikami/frontend/engine')`. Two `createEngineBridge()` call sites in `sendMessage()` now await the cached bridge.

**lpc_url_config.ts** and **lpc_asset_catalog.ts**: Created `$lib/data/lpc_models.ts` with local const objects mirroring `LpcAnimationState` and `LpcDirection` enum values. Added `getLpcStateRow` local implementation. This removes two static engine imports.

**lpc_view_model.svelte.ts**: Replaced enum imports (`LpcAnimationState`, `LpcDirection`, `getLpcStateRow`) with local models from `$lib/data/lpc_models`. Kept `createPixiApp`, `LpcBatchManager`, `TextureManager` as static engine imports (required for synchronous Svelte context initialization in constructor).

**lpc_character_renderer.svelte**: Replaced enum imports with local models. `TextureManager` lazy-initialized via `_getTextureManager()` async getter (only called in already-async `loadAndSlice()`).

### Step 3 — Prerender crawling fix

**svelte.config.js**: Added `prerender: { handleUnseenRoutes: 'ignore' }` inside `kit`.

**`+page.ts`**: Created `src/routes/(authenticated)/chat/[chatId]/+page.ts` with `export const entries = () => [];`.

### Step 4 — Directory rename

Renamed `apps/frontend/client` → `apps/frontend/client`. Updated `name` field in `package.json` to `@aikami/client`.

### Step 5 — Workspace-wide search-and-replace

Updated `apps/frontend/client` → `apps/frontend/client` in:
- `.moon/workspace.yml` (project path + defaultProject)
- `.moon/task-templates/vite-application.yml` (comment)
- `biome.json`, `README.md`
- `scripts/` (herdr, test_blackbox, deploy, generate_context, pin_dependencies)
- `packages/` (constants, services tsconfig, frontend configs/engine/components/parser READMEs)
- `apps/e2e/` (moon.yml, playwright.config.ts, POM files, tests directory)
- All filepath comments inside `apps/frontend/client/src/` (200+ files)
- Renamed `apps/e2e/tests/client/` → `apps/e2e/tests/client/`

Ran `bunx moon sync` after workspace config changes.

### Verification

- ✅ `bun run build`: passes silently, no prerender crawling error
- ✅ `bun run build`: no `INEFFECTIVE_DYNAMIC_IMPORT` warning
- ✅ `bun run typecheck`: 0 errors, 0 warnings
- ✅ `bunx moon sync`: all 32 projects synced
