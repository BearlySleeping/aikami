// packages/frontend/engine/src/rendering/lpc_layer_order.ts
//
// Re-export from @aikami/lpc — the canonical source for LPC layer order.
// This file is kept as a backward-compat re-export hub for engine-internal
// imports. New code should import from @aikami/lpc directly.

export type { LpcLayer, LpcLayerOrderEntry, LpcLayerRole, LpcSlot } from '@aikami/lpc';
export {
  getMaxKnownDepth,
  LPC_LAYER_ORDER,
  resetUnknownSlotWarnings,
  resolveLayerDepth,
  sortLayersByDepth,
} from '@aikami/lpc';
