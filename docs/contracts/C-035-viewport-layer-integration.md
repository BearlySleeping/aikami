# Contract: C-035 Viewport Layer Integration

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-034 | completed | 1.0.0 |

## Overview
This contract bridges the engine's high-performance `LpcBatchManager` mega-UBO structure with the actual SvelteKit view layer client (`game_canvas.svelte`). It establishes a deterministic initialization sequence that eliminates module-level PixiJS instantiation crashes during unit test execution and maps reactive bitECS entities into concrete custom-shaded render layers inside the visible view hierarchy.

## Design Reference
- `packages/frontend/engine/src/systems/render_system.ts`: `LpcBatchManager` slot architecture.
- `apps/frontend/pwa/src/lib/components/game/game_canvas.svelte`: Canvas layout node target.
- `packages/frontend/engine/src/rendering/sprite_composer.ts`: Multi-layer shader context.

## Changes Detail
### Modified Files

#### `packages/frontend/engine/src/rendering/sprite_composer.ts`
- Defer internal `GlProgram` and `GpuProgram` instantiations out of the immediate file top-level execution scope.
- Wrap structural compilation inside an explicit initialization gate function `initLpcShaders()` called exclusively inside the active renderer creation pipeline context to allow headless environments to import the file without DOM dependency failures.

#### `packages/frontend/engine/src/pixi_app.ts`
- Introduce explicit pipeline initialization hook that sets up the backend-agnostic context.
- Ensure that `LpcBatchManager` instances attach structural view dependencies exclusively inside the application target viewport container tree elements.

#### `apps/frontend/pwa/src/lib/components/game/game_canvas.svelte`
- Bind the engine's initialization loops inside the Svelte 5 `$effect` lifecycle hooks.
- Stream entity composition parameters safely from active database layers down into active component frames.

## Acceptance Criteria
### AC-1: Elimination of Headless Import Environment Crashes
- **Given** a headless test shell engine context running without a visible document window or active WebGL canvas object.
- **When** executing tests that import `rendering/sprite_composer.ts` or `systems/render_system.ts`.
- **Then** the module must load successfully without executing runtime GPU structural evaluations or throwing target-agnostic initialization errors.
- *Test Hook*: Validate workspace engine tests pass without throwing driver-missing constraints.

### AC-2: Structured View Frame Injection Mappings
- **Given** an active rendering matrix processing 64 distinct visual elements.
- **When** character identity parameters change states dynamically during frame updates.
- **Then** attributes must execute their internal alignment translations via `aInstanceIndex` arrays safely within the bounding canvas.
- *Test Hook*: Monitor viewport structure profiles to ensure frames complete within active loop budgets.

## Implementation Notes
1. Open `packages/frontend/engine/src/rendering/sprite_composer.ts`. Move direct compilation calls out of top-level scope.
2. Update viewport loop targets to coordinate safely across application mounting scopes.
3. Validate entire workspace configurations via integrated validation checks.
