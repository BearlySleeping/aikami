// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts
import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// LPC Asset Catalog — indexed slot + variant definitions matching the
// Universal LPC Spritesheet Generator specification.
//
// Lists are organized as explicit linear arrays so dropdown selectors
// can bind a numeric index to a stable (slot, variant, palette config)
// tuple without runtime object-literal construction.
//
// Each variant carries a `shapeType` that maps to the procedural mock
// generator in lpc_asset_path_mapper.ts — when real asset files are
// missing, the generator paints distinct geometric silhouettes per
// shape type into the 21-row LPC spritesheet grid.
// ---------------------------------------------------------------------------

/**
 * Shape type for procedural mock sheet generation.
 *
 * Maps to the drawing strategy in {@link generateMockLpcSheet}.
 */
export type LpcMockShapeType =
  | 'humanoid'
  | 'elf'
  | 'skeleton'
  | 'mohawk'
  | 'long_braid'
  | 'curly_afro'
  | 'short_crop'
  | 'chainmail'
  | 'leather_vest'
  | 'robe'
  | 'plate_armor'
  | 'plate_greaves'
  | 'cloth_skirt'
  | 'tattered_pants'
  | 'broadsword'
  | 'spear'
  | 'wood_bow'
  | 'shield'
  | 'default';

/** A single variant within an LPC equipment/body slot. */
export type LpcSlotVariant = {
  /** Numeric grayscale asset ID (string for LpcLayerRecipe compatibility). */
  assetId: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Procedural mock shape type for the offscreen canvas generator. */
  shapeType: LpcMockShapeType;
};

/** Describes an LPC character slot with its available variant options. */
export type LpcSlotDefinition = {
  /** Slot key matching {@link import('@aikami/frontend/engine').LpcLayerRecipe.slot}. */
  slot: string;
  /** Display label for the dropdown group heading. */
  label: string;
  /** Ordered list of variant options — index 0 = default. */
  variants: LpcSlotVariant[];
};

/**
 * Body base layers — species + gender variants matching the LPC base body palette.
 *
 * Contract C-049 specifies: male_light, male_dark, female_elf, skeleton.
 * Extended with additional variants for full coverage.
 *
 * Asset IDs are numeric strings mapping to grayscale body templates.
 * In production these resolve to TextureManager keys loaded from
 * Firebase Storage or a local asset bundle. In emulator/dev mode,
 * the procedural mock generator draws distinct body silhouettes per shapeType.
 */
export const LPC_BODY_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'body',
    label: 'Body',
    variants: [
      { assetId: '101', label: 'Male (Light)', shapeType: 'humanoid' },
      { assetId: '102', label: 'Male (Dark)', shapeType: 'humanoid' },
      { assetId: '103', label: 'Female (Light)', shapeType: 'humanoid' },
      { assetId: '104', label: 'Female (Dark)', shapeType: 'humanoid' },
      { assetId: '105', label: 'Elf Male', shapeType: 'elf' },
      { assetId: '106', label: 'Elf Female', shapeType: 'elf' },
      { assetId: '107', label: 'Skeleton', shapeType: 'skeleton' },
    ],
  },
  {
    slot: 'head',
    label: 'Head',
    variants: [
      { assetId: '201', label: 'Human Male Light', shapeType: 'humanoid' },
      { assetId: '202', label: 'Human Male Dark', shapeType: 'humanoid' },
      { assetId: '203', label: 'Human Female Light', shapeType: 'humanoid' },
      { assetId: '204', label: 'Human Female Dark', shapeType: 'humanoid' },
      { assetId: '205', label: 'Elf Male Light', shapeType: 'elf' },
      { assetId: '206', label: 'Elf Male Dark', shapeType: 'elf' },
      { assetId: '207', label: 'Elf Female Light', shapeType: 'elf' },
      { assetId: '208', label: 'Elf Female Dark', shapeType: 'elf' },
      { assetId: '209', label: 'Skeleton', shapeType: 'skeleton' },
    ],
  },
];

/**
 * Hair layer variants — style + colour combos.
 *
 * Contract C-049 specifies: mohawk, long_braid, curly_afro, short_crop.
 * Each shapeType maps to a distinct procedural silhouette in the mock generator.
 */
export const LPC_HAIR_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'hair',
    label: 'Hair',
    variants: [
      { assetId: '301', label: 'Mohawk', shapeType: 'mohawk' },
      { assetId: '302', label: 'Long Braid', shapeType: 'long_braid' },
      { assetId: '303', label: 'Curly Afro', shapeType: 'curly_afro' },
      { assetId: '304', label: 'Short Crop', shapeType: 'short_crop' },
      { assetId: '305', label: 'Bald', shapeType: 'default' },
      { assetId: '306', label: 'Ponytail', shapeType: 'default' },
    ],
  },
];

/**
 * Torso / chest armour and clothing layers.
 *
 * Contract C-049 specifies: chainmail, leather_vest, robe, plate_armor.
 * Each shapeType determines the mock generator's armour silhouette pattern.
 */
export const LPC_TORSO_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'torso',
    label: 'Torso',
    variants: [
      { assetId: '401', label: 'Chainmail', shapeType: 'chainmail' },
      { assetId: '402', label: 'Leather Vest', shapeType: 'leather_vest' },
      { assetId: '403', label: 'Robe', shapeType: 'robe' },
      { assetId: '404', label: 'Plate Armor', shapeType: 'plate_armor' },
      { assetId: '405', label: 'Cloth Tunic', shapeType: 'default' },
      { assetId: '406', label: 'Bare Chest', shapeType: 'default' },
    ],
  },
];

/**
 * Legs / pants / greaves layers.
 *
 * Contract C-049 specifies: plate_greaves, cloth_skirt, tattered_pants.
 * Each shapeType maps to a distinct leg silhouette in the mock generator.
 */
export const LPC_LEGS_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'legs',
    label: 'Legs',
    variants: [
      { assetId: '501', label: 'Plate Greaves', shapeType: 'plate_greaves' },
      { assetId: '502', label: 'Cloth Skirt', shapeType: 'cloth_skirt' },
      { assetId: '503', label: 'Tattered Pants', shapeType: 'tattered_pants' },
      { assetId: '504', label: 'Leather Pants', shapeType: 'default' },
      { assetId: '505', label: 'Bare Legs', shapeType: 'default' },
    ],
  },
];

/**
 * Feet / boots / shoes layers.
 */
export const LPC_FEET_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'feet',
    label: 'Feet',
    variants: [
      { assetId: '601', label: 'Leather Boots', shapeType: 'default' },
      { assetId: '602', label: 'Plate Boots', shapeType: 'default' },
      { assetId: '603', label: 'Cloth Shoes', shapeType: 'default' },
      { assetId: '604', label: 'Sandals', shapeType: 'default' },
      { assetId: '605', label: 'Bare Feet', shapeType: 'default' },
    ],
  },
];

/**
 * Weapon / held item layers.
 *
 * Contract C-049 specifies: broadsword, spear, wood_bow.
 * Each shapeType maps to a distinct weapon silhouette in the mock generator.
 */
export const LPC_WEAPON_SLOTS: readonly LpcSlotDefinition[] = [
  {
    slot: 'weapon',
    label: 'Weapon',
    variants: [
      { assetId: '701', label: 'Broadsword', shapeType: 'broadsword' },
      { assetId: '702', label: 'Spear', shapeType: 'spear' },
      { assetId: '703', label: 'Wood Bow', shapeType: 'wood_bow' },
      { assetId: '704', label: 'Shield', shapeType: 'shield' },
      { assetId: '705', label: 'Dagger', shapeType: 'default' },
      { assetId: '706', label: 'Staff', shapeType: 'default' },
      { assetId: '707', label: 'Mace', shapeType: 'default' },
      { assetId: '708', label: 'Wand', shapeType: 'default' },
    ],
  },
];

/**
 * All slot definitions in layer-priority order.
 *
 * The dropdown assembly panel renders these in sequence.
 * Layer 0 (body) → Layer N (weapon) matches the UBO packing order.
 */
export const ALL_LPC_SLOTS: readonly LpcSlotDefinition[] = [
  ...LPC_BODY_SLOTS,
  ...LPC_HAIR_SLOTS,
  ...LPC_TORSO_SLOTS,
  ...LPC_LEGS_SLOTS,
  ...LPC_FEET_SLOTS,
  ...LPC_WEAPON_SLOTS,
];

/** Animation state options for the dropdown selector. */
export const ANIMATION_STATE_OPTIONS: readonly { value: LpcAnimationState; label: string }[] = [
  { value: LpcAnimationState.Walk, label: 'Walk' },
  { value: LpcAnimationState.Spellcast, label: 'Spellcast' },
  { value: LpcAnimationState.Thrust, label: 'Thrust' },
  { value: LpcAnimationState.Slash, label: 'Slash' },
  { value: LpcAnimationState.Shoot, label: 'Shoot' },
  { value: LpcAnimationState.Die, label: 'Die' },
];

/** Direction options for the dropdown selector. */
export const DIRECTION_OPTIONS: readonly { value: LpcDirection; label: string }[] = [
  { value: LpcDirection.Down, label: 'Down' },
  { value: LpcDirection.Up, label: 'Up' },
  { value: LpcDirection.Left, label: 'Left' },
  { value: LpcDirection.Right, label: 'Right' },
];

/**
 * LPC palette colour table — default hex colours for the 256-entry
 * palette lookup texture.
 *
 * Palette indices 0-15 represent the primary character colour ramp.
 * Indices 64-79 are commonly used for hair, 128-143 for metal/armour.
 *
 * Each entry is a 6-char hex string (no leading #) stored for fast
 * lookup when building {@link import('@aikami/frontend/engine').LpcLayerRecipe.hexPalette}
 * buffers.
 */
export const LPC_DEFAULT_PALETTE: readonly string[] = (() => {
  const palette = new Array<string>(256);

  // Fill all entries with transparent black by default
  for (let i = 0; i < 256; i++) {
    palette[i] = '000000';
  }

  // Skin tone ramp (indices 0–7) — warm browns
  palette[0] = 'F5D0A9';
  palette[1] = 'E0B88A';
  palette[2] = 'C69C6D';
  palette[3] = 'A67C52';
  palette[4] = '8B5E3C';
  palette[5] = '70442A';
  palette[6] = '55301A';
  palette[7] = '3B1F0F';

  // Hair colour ramp (indices 64–71) — browns, blondes, blacks
  palette[64] = '4A3320';
  palette[65] = '6B4A30';
  palette[66] = '8C6240';
  palette[67] = 'D4A86A';
  palette[68] = 'F0D090';
  palette[69] = '222222';
  palette[70] = '8B2500';
  palette[71] = 'CC4400';

  // Eye colour (index 8) — blue
  palette[8] = '4A90D9';

  // Cloth / leather ramp (indices 16–23) — brown leathers
  palette[16] = '8B6914';
  palette[17] = 'A67C2E';
  palette[18] = 'C18E3D';
  palette[19] = 'DBA04F';
  palette[20] = '6B4A14';
  palette[21] = '4A3010';
  palette[22] = '33200A';
  palette[23] = '1A1005';

  // Metal / armour ramp (indices 128–135) — silver/steel
  palette[128] = '888888';
  palette[129] = 'AAAAAA';
  palette[130] = 'CCCCCC';
  palette[131] = 'DDDDDD';
  palette[132] = '666666';
  palette[133] = '444444';
  palette[134] = '999999';
  palette[135] = 'BBBBBB';

  return palette;
})();

/**
 * Deterministic Z-index order for LPC character layer compositing.
 *
 * Matches the Universal LPC spritesheet standard: base body layers render
 * first (lowest zIndex), equipment layers stack on top, and effects render
 * furthest in front. The PixiJS container MUST have `sortableChildren = true`
 * for zIndex to take effect.
 *
 * Slot keys match {@link ALL_LPC_SLOTS} slot names and the
 * {@link import('@aikami/frontend/engine').LpcLayerRecipe.slot} field.
 */
export const LPC_LAYER_Z_INDEX: Record<string, number> = {
  body: 10,
  head: 20,
  hair: 30,
  torso: 40,
  legs: 50,
  feet: 60,
  weapon: 70,
} as const satisfies Record<string, number>;

/**
 * Default palette index per LPC slot for sprite tinting.
 *
 * Each slot maps to the palette ramp designed for that body part:
 * - body/head: skin tone ramp (index 0)
 * - hair: hair colour ramp (index 64)
 * - torso/legs/feet: cloth/leather ramp (index 16)
 * - weapon: metal/armour ramp (index 128)
 *
 * When a layer has no user-overridden colour, the sprite is tinted
 * with the default palette entry for its slot. When the user changes
 * a palette entry, the tint updates to the new colour.
 */
export const LPC_SLOT_PALETTE_INDEX: Record<string, number> = {
  body: 0,
  head: 0,
  hair: 64,
  torso: 16,
  legs: 16,
  feet: 16,
  weapon: 128,
} as const satisfies Record<string, number>;

/**
 * Converts a 6-char hex colour string (no leading #) to a PixiJS numeric tint.
 *
 * PixiJS `Sprite.tint` expects a 24-bit RGB value as a number (e.g. 0xFFCC88).
 * This helper parses the palette hex format into the correct numeric form.
 * Defaults to 0xFFFFFF (white / no tint) when the input is invalid or
 * missing, ensuring uncoloured layers render at full brightness.
 *
 * @param hex - 6-char hex string (e.g. "F5D0A9").
 * @returns PixiJS-compatible numeric tint value.
 */
export const hexToPixiTint = (hex: string | undefined): number => {
  if (!hex || hex.length < 6) {
    return 0xffffff;
  }

  const value = Number.parseInt(hex.slice(0, 6), 16);

  if (Number.isNaN(value)) {
    return 0xffffff;
  }

  return value;
};

/**
 * Builds a 1024-byte Uint8Array from a palette record.
 *
 * Each key is a stringified palette index ("0"–"255").
 * Each value is a 6-char hex string WITHOUT leading `#`.
 *
 * @param hexColors - Record mapping palette indices to 6-char hex colours.
 * @returns A 1024-byte Uint8Array ready for LpcLayerRecipe.hexPalette.
 */
export const buildPaletteBuffer = (hexColors: readonly string[]): Uint8Array => {
  const data = new Uint8Array(1024);

  for (let i = 0; i < 256; i++) {
    const hex = hexColors[i];
    if (hex?.length !== 6) {
      continue;
    }

    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);

    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      continue;
    }

    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }

  return data;
};
