// docs/contracts/C-021-engine-package-extraction.md
# Contract: C-021 Engine Package Extraction

## Design References
- Monorepo Boundaries: `.moon/workspace.yml`
- PWA Tauri Integration: `apps/frontend/pwa/src-tauri/`
- Target Architecture: `@aikami/engine` as the single source of truth for bitECS and PixiJS.

## Detailed Changes
1. **Package Creation**: Create `packages/engine`. Move everything currently inside `apps/frontend/game/src/engine/` into `packages/engine/src/`.
2. **Deprecation**: Delete the redundant `apps/frontend/pwa/src/lib/game/` directory entirely.
3. **Workspace Linking**: 
   - Update `packages/engine/package.json` with name `@aikami/engine`.
   - Add `@aikami/engine: workspace:*` to `apps/frontend/pwa/package.json` and `apps/frontend/game/package.json`.
4. **Unified Bridge**: The `engine_bridge.ts` inside `packages/engine` will export a singleton `EngineBridge`. Svelte 5 will import this directly to listen to `CONTEXT_ENTERED` and dispatch `/commands`.
5. **PWA Mount Component**: Create `apps/frontend/pwa/src/lib/components/game/game_canvas.svelte`. This component will import `initGame()` from `@aikami/engine` and attach the PixiJS application to a bound `<canvas>` ref on `onMount`.

## Acceptance Criteria
- **Given** the monorepo has been restructured.
- **When** running `moon run pwa:dev`.
- **Then** the SvelteKit app successfully imports `@aikami/engine` and renders the PixiJS canvas without an iframe.
- **When** running `moon run game:dev`.
- **Then** the standalone Vite app successfully imports `@aikami/engine` and runs the game loop independently of SvelteKit.
- **Then** all duplicate logic between the two apps is eliminated.

## Watch Points
- **Asset Loading**: PixiJS asset paths must be absolute or correctly resolved by both Vite (game) and SvelteKit (PWA). You may need to inject a `basePath` config when initializing the engine.
- **Tauri Window Constraints**: Ensure the `game_canvas.svelte` respects SvelteKit layout constraints so it doesn't overflow the Tauri desktop window.
