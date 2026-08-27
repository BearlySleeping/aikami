// packages/frontend/engine/src/content.ts
// ---------------------------------------------------------------------------
// Content subpath — assets, entities, LPC resolution (no PixiJS, no node:*)
// ---------------------------------------------------------------------------

export type {
  LpcAppearanceResult,
  LpcSlotCatalog,
  LpcSlotFallbacks,
  LpcSlotName,
  LpcSlotResolution,
  ResolveLpcAppearanceOptions,
} from '@aikami/lpc';
// Re-exports from @aikami/lpc that were previously in the root barrel
export {
  DEFAULT_LPC_SLOT_FALLBACKS,
  getLpcFrameIndex,
  getLpcStateRow,
  getMaxKnownDepth,
  LPC_LAYER_ORDER,
  LPC_SLOT_ORDER,
  LpcAnimationState,
  type LpcCellFamily,
  LpcDirection,
  type LpcLayer,
  type LpcLayerOrderEntry,
  type LpcSheetGeometry,
  type LpcSlot,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  resetUnknownSlotWarnings,
  resolveLayerDepth,
  resolveLpcAppearance,
  resolveLpcSheetGeometry,
  sortLayersByDepth,
  velocityToDirection,
} from '@aikami/lpc';
// Entity factories
export { createNPC } from './entities/create_npc.ts';
export type { PlayerCreateOptions } from './entities/create_player.ts';
export { createPlayer } from './entities/create_player.ts';
// LPC appearance resolver (C-400) — unified worker/client resolution
export type { CreateLpcPipelineOptions } from './rendering/lpc_appearance_resolver.ts';
export { createLpcPipeline } from './rendering/lpc_appearance_resolver.ts';
