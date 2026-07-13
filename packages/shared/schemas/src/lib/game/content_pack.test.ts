// packages/shared/schemas/src/lib/content_pack.test.ts
//
// Tests for ContentPackManifest schema validation.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { ContentPackManifestSchema } from './content_pack.ts';

/** Minimal valid manifest fixture. */
const validManifest = {
  id: 'emberwatch',
  name: 'Emberwatch',
  version: '1.0.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  startingMapId: 'startingVillage',
  maps: {
    startingVillage: {
      file: 'maps/starting_village.jton',
      name: 'Starting Village',
      defaultSpawnId: 'spawn_village_01',
    },
  },
  npcs: {},
  items: {},
  dialogues: {},
};

describe('ContentPackManifestSchema', () => {
  // ── Valid manifest ──

  test('should validate a minimal valid manifest (1 map, 0 npcs, 0 items, 0 dialogues)', () => {
    const result = Value.Parse(ContentPackManifestSchema, validManifest);
    expect(result.id).toBe('emberwatch');
    expect(result.version).toBe('1.0.0');
    expect(result.startingMapId).toBe('startingVillage');
  });

  test('should validate a full manifest with npcs, items, and dialogues', () => {
    const full = {
      ...validManifest,
      npcs: {
        bartender: {
          name: 'Grizzled Bartender',
          defaultDialogueKey: 'bartenderGreeting',
          isVendor: true,
        },
      },
      items: {
        rustySword: {
          name: 'Rusty Sword',
          type: 'weapon' as const,
          attackBonus: 3,
          equipmentSlot: 'mainHand',
        },
      },
      dialogues: {
        bartenderGreeting: 'Welcome to the tavern, stranger.',
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, full);
    expect(result.npcs.bartender.name).toBe('Grizzled Bartender');
    expect(result.items.rustySword.type).toBe('weapon');
    expect(result.dialogues.bartenderGreeting).toBe('Welcome to the tavern, stranger.');
  });

  test('should accept version with pre-release suffix', () => {
    const manifest = { ...validManifest, version: '2.0.0-beta.1' };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.version).toBe('2.0.0-beta.1');
  });

  test('should accept version with build metadata', () => {
    const manifest = { ...validManifest, version: '1.0.0+build123' };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.version).toBe('1.0.0+build123');
  });

  // ── Rejections: missing required fields ──

  test('should reject missing id', () => {
    const { id, ...missingId } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingId)).toThrow();
  });

  test('should reject missing version', () => {
    const { version, ...missingVersion } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingVersion)).toThrow();
  });

  test('should reject missing startingMapId', () => {
    const { startingMapId, ...missingStart } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingStart)).toThrow();
  });

  test('should reject missing maps', () => {
    const { maps, ...missingMaps } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingMaps)).toThrow();
  });

  test('should reject missing name', () => {
    const { name, ...missingName } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingName)).toThrow();
  });

  test('should reject missing updatedAt', () => {
    const { updatedAt, ...missingUpdated } = validManifest;
    expect(() => Value.Parse(ContentPackManifestSchema, missingUpdated)).toThrow();
  });

  test('should accept startingMapId as a valid string even if map key does not exist in maps', () => {
    const manifest = { ...validManifest, startingMapId: 'nonExistentMap' };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.startingMapId).toBe('nonExistentMap');
  });

  // ── Rejections: map entry file is empty string ──

  test('should reject map entry with empty file string', () => {
    const manifest = {
      ...validManifest,
      maps: {
        startingVillage: {
          file: '',
          name: 'Starting Village',
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  // ── Rejections: version not matching semver pattern ──

  test('should reject invalid semver version (v1.0)', () => {
    const manifest = { ...validManifest, version: 'v1.0' };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should reject invalid semver version (not a version string)', () => {
    const manifest = { ...validManifest, version: 'latest' };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should reject invalid semver version (empty)', () => {
    const manifest = { ...validManifest, version: '' };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should reject invalid semver version (partial)', () => {
    const manifest = { ...validManifest, version: '1' };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  // ── Rejections: empty id ──

  test('should reject empty id string', () => {
    const manifest = { ...validManifest, id: '' };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  // ── Rejections: item type validation ──

  test('should reject invalid item type', () => {
    const manifest = {
      ...validManifest,
      items: {
        badItem: {
          name: 'Bad Item',
          type: 'potion',
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should accept all valid item types', () => {
    const types = ['weapon', 'armor', 'consumable', 'key', 'misc'] as const;
    for (const type of types) {
      const itemKey = `item${type.charAt(0).toUpperCase() + type.slice(1)}`;
      const manifest = {
        ...validManifest,
        items: {
          [itemKey]: {
            name: `Test ${type}`,
            type,
          },
        },
      };
      const result = Value.Parse(ContentPackManifestSchema, manifest);
      expect(result.items[itemKey].type).toBe(type);
    }
  });

  // ── Optional fields on map entries ──

  test('should accept map entry with default spawn coordinates', () => {
    const manifest = {
      ...validManifest,
      maps: {
        startingVillage: {
          file: 'maps/starting_village.jton',
          name: 'Starting Village',
          defaultSpawnId: 'spawn01',
          defaultX: 160,
          defaultY: 192,
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const map = result.maps.startingVillage;
    expect(map.defaultSpawnId).toBe('spawn01');
    expect(map.defaultX).toBe(160);
    expect(map.defaultY).toBe(192);
  });

  // ── Optional NPC fields ──

  test('should accept NPC entry with appearance layers and vendor fields', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        merchant: {
          name: 'Traveling Merchant',
          defaultDialogueKey: 'merchantGreeting',
          appearanceLayers: [1, 2, 3],
          isVendor: true,
          vendorInventory: 'generalStore',
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const npc = result.npcs.merchant;
    expect(npc.appearanceLayers).toEqual([1, 2, 3]);
    expect(npc.isVendor).toBe(true);
    expect(npc.vendorInventory).toBe('generalStore');
  });

  // ── Optional item fields ──

  test('should accept item entry with bonuses and equipment slot', () => {
    const manifest = {
      ...validManifest,
      items: {
        ironHelm: {
          name: 'Iron Helm',
          type: 'armor' as const,
          defenseBonus: 5,
          equipmentSlot: 'head',
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const item = result.items.ironHelm;
    expect(item.defenseBonus).toBe(5);
    expect(item.equipmentSlot).toBe('head');
    expect(item.attackBonus).toBeUndefined();
  });
});
