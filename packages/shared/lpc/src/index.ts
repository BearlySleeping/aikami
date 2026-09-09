// packages/shared/lpc/src/index.ts — public surface

export {
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from './lib/animation.ts';
// LpcLayerRole is defined in slot_model.ts; layer_order.ts imports it from there.
export {
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  type LpcAppearanceResult,
  type LpcLayerRecipe,
  type LpcSlotCatalog,
  type LpcSlotFallbacks,
  type LpcSlotName,
  type LpcSlotResolution,
  projectLpcCatalog,
  type ResolveLpcAppearanceOptions,
  resetLpcFallbackWarnings,
  resolveLpcAppearance,
} from './lib/appearance.ts';
export { buildLpcCatalog } from './lib/build_catalog.ts';
export {
  getMaxKnownDepth,
  LPC_LAYER_ORDER,
  type LpcLayer,
  type LpcLayerOrderEntry,
  type LpcSlot,
  resetUnknownSlotWarnings,
  resolveLayerDepth,
  sortLayersByDepth,
} from './lib/layer_order.ts';
export {
  LEGACY_CATALOG_SNAPSHOT,
  LEGACY_CATALOG_SNAPSHOT_ID,
} from './lib/legacy_catalog_snapshot.ts';
export { LEGACY_INDEX_REMAP } from './lib/legacy_remap.ts';
export {
  type AppearanceCatalog,
  type AppearanceCatalogSlot,
  type AppearanceDiagnostic,
  type AppearanceNormalizationStatus,
  isNamedAppearance,
  legacyToNamed,
  type NamedAppearance,
  type NamedAppearanceComponent,
  type NamedAppearanceProvenance,
  namedToLayerIds,
  normalizeLayerRole,
  normalizeNamed,
  normalizePersonaRecipe,
  type ResolveNpcAppearanceOptions,
  type ResolveNpcAppearanceResult,
  resolveNpcAppearance,
} from './lib/named_appearance.ts';
export {
  type LpcCellFamily,
  type LpcSheetGeometry,
  resolveLpcSheetGeometry,
} from './lib/sheet_geometry.ts';
export type {
  LpcCatalog,
  LpcLayerRole,
  LpcSlotDefinition,
  LpcSlotVariant,
} from './lib/slot_model.ts';
export { type LpcTag, lpcStateSuffix, lpcTag } from './lib/tags.ts';
