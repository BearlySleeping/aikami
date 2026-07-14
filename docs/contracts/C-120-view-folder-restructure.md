<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-120 View Folder Restructure & ViewModel Inheritance

## Goal
Enforce strict structural isolation within `src/lib/views/` so that every View/ViewModel pair resides in its own designated subfolder. Move the configuration view out of the developer ghetto into production space, and establish the Dev-overrides-Prod class extension model.

## Context
Our directory structure currently has multiple views floating loose inside parent folders (like `/views/game/`), violating the structural isolation rule. Additionally, configuration code currently living under `/views/dev/config/` is identical to what we need for production provider setup. We need to normalize this.

## Tasks

1. **Promote and Isolate Provider Configuration View:**
   - Move the contents of `src/lib/views/dev/config/` to a new production folder: `src/lib/views/settings/providers/`.
   - Rename files if necessary to match the domain name: `providers_view.svelte` and `providers_view_model.svelte.ts`.
   - Remove legacy, un-isolated floating files in the old directory.

2. **Implement Dev Configuration Overrides:**
   - In `src/lib/views/dev/config/` (or a dedicated dev view folder), create `dev_providers_view_model.svelte.ts`.
   - Have this class extend the production model:
```ts
     import { ProvidersViewModel } from '$lib/views/settings/providers/providers_view_model.svelte';
     export class DevProvidersViewModel extends ProvidersViewModel {
         // Override methods to mock API responses or toggle dev-only UI flags
     }
     ```
   - Ensure the Svelte view component in production can seamlessly accept this subclass instance via standard polymorphism.

3. **Restructure Isolated Views (Enforce Subfolders):**
   - Group any view/view-model pairs currently floating together inside `src/lib/views/game/` into clean, isolated subfolders (e.g., `src/lib/views/game/hud/`, `src/lib/views/game/canvas/`).
   - Move character creation views inside `src/lib/views/character/` into an explicit `create/` subfolder (`src/lib/views/character/create/`).
   - Clean up any dead legacy route constants remaining in `src/lib/constants/routes.ts` that were left behind during `C-119`.

## Out of Scope
- Building the actual logic for the start menu elements or the gameplay state machines.
- Adding actual UI design changes; focus purely on folder layout, imports, and component isolation.

## Acceptance Criteria
- No directory under `src/lib/views/` contains multiple standalone View or ViewModel files directly in its root; all are isolated inside specific architectural domains.
- The dev configuration page properly instantiates and utilizes the extended `DevProvidersViewModel`.
- `bun test` or compilation steps pass completely with zero broken import references across the repo.
