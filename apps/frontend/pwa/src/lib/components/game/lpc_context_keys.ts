// apps/frontend/pwa/src/lib/components/game/lpc_context_keys.ts

/**
 * Svelte context key for injecting the {@link import('@aikami/frontend/engine').LpcBatchManager}
 * into the LPC rendering component tree.
 *
 * Parents call `setContext(LPC_BATCH_MANAGER_KEY, batchManager)` and
 * `LpcCharacterRenderer` calls `getContext(LPC_BATCH_MANAGER_KEY)`.
 */
export const LPC_BATCH_MANAGER_KEY = Symbol('lpc-batch-manager');

/**
 * Svelte context key for injecting a PixiJS {@link import('pixi.js').Container}
 * that serves as the parent display object for LPC character sprites.
 *
 * Parents call `setContext(LPC_STAGE_CONTAINER_KEY, container)` with a
 * PixiJS Container. The renderer component adds/removes its sprite
 * display objects from this container during its lifecycle.
 */
export const LPC_STAGE_CONTAINER_KEY = Symbol('lpc-stage-container');
