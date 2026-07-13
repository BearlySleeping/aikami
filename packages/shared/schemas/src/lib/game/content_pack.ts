// packages/shared/schemas/src/lib/content_pack.ts
//
// Content Pack Manifest schema — validates versioned content pack manifests.
// These manifests declare maps, NPCs, items, and dialogues for a game world.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Semver validation pattern (x.y.z with optional pre-release + build)
// ---------------------------------------------------------------------------

const SEMVER_PATTERN =
  '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

// ---------------------------------------------------------------------------
// ContentPackMapEntry — a single map in the content pack
// ---------------------------------------------------------------------------

export const ContentPackMapEntrySchema = Type.Object({
  /** File path relative to the pack root (e.g. "maps/starting_village.jton") */
  file: Type.String({ minLength: 1, description: 'Relative file path to the map' }),
  /** Human-readable map name */
  name: Type.String({ description: 'Display name for the map' }),
  /** Spawn point ID for the default entry location */
  defaultSpawnId: Type.Optional(Type.String({ description: 'Default spawn point ID' })),
  /** Pixel X fallback if no spawn entity matches */
  defaultX: Type.Optional(Type.Number({ description: 'Fallback spawn X pixel coordinate' })),
  /** Pixel Y fallback if no spawn entity matches */
  defaultY: Type.Optional(Type.Number({ description: 'Fallback spawn Y pixel coordinate' })),
});

export type ContentPackMapEntry = Static<typeof ContentPackMapEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackNpcEntry — NPC definition in the pack
// ---------------------------------------------------------------------------

export const ContentPackNpcEntrySchema = Type.Object({
  /** Display name shown in dialog and hover */
  name: Type.String({ description: 'NPC display name' }),
  /** Default dialogue key (references dialogues{} in the manifest) */
  defaultDialogueKey: Type.Optional(Type.String({ description: 'Default dialogue key' })),
  /** Optional: appearance layer IDs for LPC sprite composition */
  appearanceLayers: Type.Optional(
    Type.Array(Type.Number(), { description: 'LPC appearance layer IDs' }),
  ),
  /** Whether this NPC is a vendor */
  isVendor: Type.Optional(Type.Boolean({ description: 'Whether this NPC is a vendor' })),
  /** Vendor inventory reference */
  vendorInventory: Type.Optional(Type.String({ description: 'Vendor inventory reference key' })),
});

export type ContentPackNpcEntry = Static<typeof ContentPackNpcEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackItemEntry — item definition in the pack
// ---------------------------------------------------------------------------

export const ItemTypeSchema = Type.Union([
  Type.Literal('weapon'),
  Type.Literal('armor'),
  Type.Literal('consumable'),
  Type.Literal('key'),
  Type.Literal('misc'),
]);

export type ItemType = Static<typeof ItemTypeSchema>;

export const ContentPackItemEntrySchema = Type.Object({
  /** Display name */
  name: Type.String({ description: 'Item display name' }),
  /** Item type */
  type: ItemTypeSchema,
  /** Optional attack bonus */
  attackBonus: Type.Optional(Type.Number({ description: 'Attack bonus value' })),
  /** Optional defense bonus */
  defenseBonus: Type.Optional(Type.Number({ description: 'Defense bonus value' })),
  /** Optional reference to an equipment slot */
  equipmentSlot: Type.Optional(Type.String({ description: 'Equipment slot reference' })),
});

export type ContentPackItemEntry = Static<typeof ContentPackItemEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackManifest — top-level content pack manifest
// ---------------------------------------------------------------------------

export const ContentPackManifestSchema = Type.Object({
  /** Pack identifier — matches Campaign.contentPackId */
  id: Type.String({ minLength: 1, description: 'Content pack identifier' }),
  /** Human-readable name */
  name: Type.String({ description: 'Pack display name' }),
  /** Semantic version string (e.g. "1.0.0") */
  version: Type.String({
    pattern: SEMVER_PATTERN,
    description: 'Semantic version string (x.y.z)',
  }),
  /** ISO 8601 timestamp of last modification */
  updatedAt: Type.String({ description: 'ISO 8601 last modification timestamp' }),
  /** Map ID of the entry point — first map loaded on campaign start */
  startingMapId: Type.String({ minLength: 1, description: 'Starting map ID' }),
  /** All maps in this pack, keyed by map ID */
  maps: Type.Record(Type.String(), ContentPackMapEntrySchema, {
    description: 'Map definitions keyed by map ID',
  }),
  /** NPC definitions, keyed by NPC ID */
  npcs: Type.Record(Type.String(), ContentPackNpcEntrySchema, {
    description: 'NPC definitions keyed by NPC ID',
  }),
  /** Item definitions, keyed by item ID */
  items: Type.Record(Type.String(), ContentPackItemEntrySchema, {
    description: 'Item definitions keyed by item ID',
  }),
  /** Dialogue fallback strings, keyed by dialogue key */
  dialogues: Type.Record(Type.String(), Type.String(), {
    description: 'Dialogue fallback strings keyed by dialogue key',
  }),
});

export type ContentPackManifest = Static<typeof ContentPackManifestSchema>;
