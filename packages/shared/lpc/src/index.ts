// packages/shared/lpc/src/index.ts — public surface

export { buildLpcCatalog } from './lib/build_catalog.ts';
export { LpcAnimationState, LpcDirection, getLpcStateRow, getLpcFrameIndex, velocityToDirection } from './lib/animation.ts';
export { lpcTag, lpcStateSuffix, type LpcTag } from './lib/tags.ts';
export { resolveLpcSheetGeometry, type LpcSheetGeometry, type LpcCellFamily } from './lib/sheet_geometry.ts';
export { LPC_LAYER_ORDER, resolveLayerDepth, resetUnknownSlotWarnings, sortLayersByDepth, getMaxKnownDepth, type LpcLayer, type LpcLayerOrderEntry, type LpcSlot } from './lib/layer_order.ts';
// LpcLayerRole is defined in slot_model.ts; layer_order.ts imports it from there.
export { resolveLpcAppearance, resetLpcFallbackWarnings, projectLpcCatalog, LPC_SLOT_ORDER, DEFAULT_LPC_SLOT_FALLBACKS, type LpcAppearanceResult, type LpcLayerRecipe, type LpcSlotName, type LpcSlotCatalog, type LpcSlotFallbacks, type LpcSlotResolution, type ResolveLpcAppearanceOptions } from './lib/appearance.ts';
export type { LpcCatalog, LpcSlotDefinition, LpcSlotVariant, LpcLayerRole } from './lib/slot_model.ts';
