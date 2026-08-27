// packages/shared/lpc/src/lib/slot_model.ts

/** Which side of the body a sheet draws on. */
export type LpcLayerRole = 'behind' | 'front';

/** One selectable variant within a slot. */
export type LpcSlotVariant = {
  /** Path-form id, e.g. "hair/bangslong2/bg_adult". */
  readonly assetId: string;
  /** Human label derived from the last path segment. */
  readonly label: string;
  readonly layerRole: LpcLayerRole;
  /** Complementary variant when this sheet is half of a bg/fg pair. */
  readonly pairedAssetId?: string;
  /** Animation states this variant actually has sheets for. */
  readonly states: readonly string[];
};

/** One slot and its ordered variants. Order is the save-compat contract. */
export type LpcSlotDefinition = {
  readonly slot: string;
  readonly label: string;
  readonly variants: readonly LpcSlotVariant[];
};

/** The whole derived catalog. */
export type LpcCatalog = {
  readonly slots: readonly LpcSlotDefinition[];
  readonly assetIdsBySlot: Readonly<Record<string, readonly string[]>>;
  /** Every assetId, flat — used by prompt building and validation. */
  readonly allAssetIds: readonly string[];
};
