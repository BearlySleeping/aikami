<!-- completed: 2026-06-04 -->
# Contract — C-042 Reusable LPC Sprite Component

## Metadata
| Field | Value |
|---|---|
| Source | User Request |
| Target | PWA Rendering Layer / Engine Component Boundary |
| Priority | P1 (Foundation Workflow) |
| Dependencies | C-034, C-035, C-036, C-038, C-039, C-040 |
| Status | completed |
| Completed | 2026-06-04 |
| Version | 1.0.0 |

## Overview
This contract establishes a highly optimized, reusable Svelte 5 canvas component (`LpcCharacterRenderer.svelte`) that abstracts the low-level rendering mechanics verified in the developer demo. It bridges the Svelte 5 signal-based `$props` interface directly to the zero-allocation `LpcBatchManager` uniform buffer array. It translates positions, LPC animation states, direction enums, and equipment recipe arrays into the WebGL2 multi-layer shader context without incurring runtime heap allocations or DOM-bound layout shifts.

## Design Reference
- `apps/frontend/client/src/routes/(authenticated)/dev/lpc-demo/+page.svelte`: Handles raw canvas lifecycle binding via `$effect` hooks and explicit uniform buffer initialization.
- `packages/frontend/engine/src/rendering/animation_controller.ts`: Defines `LpcAnimationState` and `LpcDirection` enums with corresponding dominant-axis stepping.
- `packages/frontend/engine/src/systems/render_system.ts`: Manages `LpcBatchManager` entity registration, dirty structural hash tracking, and slot recycling.

## Changes Detail

### 1. Create `apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte`
Develop the modular component satisfying Svelte 5 strict architectural patterns:
- Line 1 File path comment requirement: `// apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte`.
- Consume incoming reactive props via the `$props()` rune, defaulting layout parameters to standard 64x64 LPC grid footprints.
- Retrieve the active `pixi_app` instance and global `ubo_allocator` or system-specific `batchManager` references securely from parent contexts via Svelte's context layer (`getContext`) to protect against state leakage across Server-Side Rendering (SSR) limits.
- On component mount (`onMount`), generate a unique local entity identifier (`eid`) via the `allocator.allocate()` pipeline, reserving a contiguous uniform buffer object slot.
- Embed a reactive `$effect` loop tracking changes to coordinates (`x`, `y`), direction (`facing`), state (`action`), frame metrics, and apparel layer arrays. This loop must assemble properties into a static, recycled buffer array before performing `batchManager.writeEntityUbo(eid, recipes)` changes.
- Implement explicit structural cleanups inside `onDestroy` boundaries to invoke `batchManager.deregisterEntity(eid)` and free the cached buffer location for future allocations.

### 2. Modify `packages/frontend/engine/src/index.ts`
- Ensure all underlying asset interfaces, layer structural definitions (`LpcLayerRecipe`), animation enums (`LpcAnimationState`, `LpcDirection`), and performance tracker footprints are cleanly barrel-exported from the frontend-engine package.

## Acceptance Criteria

### AC-1: Context Isolation and Lifecycle Resource Allocation
- **Given** an active rendering container running in a SvelteKit client session,
- **When** an `LpcCharacterRenderer` component is declared within a valid canvas layout context,
- **Then** it must resolve its `batchManager` from context without top-level singletons, allocate a dedicated buffer slot index via an $O(1)$ stack call, and add its visual footprint directly to the viewport layer tree.

### AC-2: Zero-Allocation Reactive UBO Update Traversal
- **Given** an initialized, active entity bound to slot index $S$,
- **When** reactive tracking properties (`x`, `y`, `facing`, or apparel array dependencies) mutate during game ticks,
- **Then** the internal compilation layer must use pre-allocated variables to repack data, update parameters at the explicit block boundary address (`Byte Offset(S) = S * 48 bytes`), and verify via runtime performance metrics that zero structural hashes are generated for unchanged visual frames.

### AC-3: Safe De-allocation Guard Rails
- **Given** a visible entity component instance tracking runtime variables,
- **When** the component instance is conditionally unmounted or destroyed by the UI runtime,
- **Then** it must execute a LIFO freed-slot recycling operation to clear its allocated GPU range, subtract from active instance counts, and invoke teardowns safely without throwing environment environment crashes.

## Test Hooks
- Register global metrics on window wrappers: expose `window.__lpc_active_instances` and `window.__lpc_structural_hashes` inside integration testing loops.
- Validate that switching equipment configurations updates UBO arrays precisely inside Playwright-driven headless CDP assertions.

## Implementation Notes
1. Declare component inputs using strict typing conventions: `recipes: LpcLayerRecipe[]`.
2. Extract context accessors safely: ensure component crashes gracefully with human-readable errors if placed outside a target canvas structure.
3. Isolate update properties within a microtask-scheduled `$effect` step, ensuring multi-property modifications pack concurrently inside single frame update envelopes.

## Edge Cases & Gotchas
- **Array Mutation Stalls**: Directly replacing array references on apparel props triggers full signal re-evaluation. The internal updater must use fingerprint validation (`recipeStructuralFingerprint`) to bypass GPU packs if texture definitions match cached blocks.
- **SSR Reference Safeguards**: PixiJS structural components must never execute top-level instantiation blocks during server pre-rendering. Enforce strict `browser` context flags or defer engine binding until `onMount` execution scopes open.
