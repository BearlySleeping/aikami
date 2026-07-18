// packages/shared/schemas/src/lib/game/content_pack.test.ts
//
// Tests for ContentPackManifest schema validation.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader
// Contract: C-316 Build the Authored Emberwatch Demo Adventure

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
          equipmentSlot: 'weapon',
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

  // ── C-316: vendorInventory pattern validation ──

  test('should accept vendorInventory with comma-separated item IDs', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        merchant: {
          name: 'Merchant',
          isVendor: true,
          vendorInventory: 'ironSword,healthPotion,woodenShield',
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.npcs.merchant.vendorInventory).toBe('ironSword,healthPotion,woodenShield');
  });

  test('should accept vendorInventory with spaces after commas', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        merchant: {
          name: 'Merchant',
          isVendor: true,
          vendorInventory: 'ironSword, healthPotion, woodenShield',
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.npcs.merchant.vendorInventory).toBe('ironSword, healthPotion, woodenShield');
  });

  test('should reject vendorInventory with invalid characters', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        merchant: {
          name: 'Merchant',
          isVendor: true,
          vendorInventory: 'iron sword',
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  // ── C-316: combatStats on NPC ──

  test('should accept NPC with combatStats', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        bandit: {
          name: 'Bandit',
          combatStats: {
            hitPoints: 20,
            armorClass: 12,
            attackBonus: 3,
            damage: '1d6+2',
            initiativeBonus: 1,
            xpValue: 50,
          },
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const stats = result.npcs.bandit.combatStats;
    expect(stats?.hitPoints).toBe(20);
    expect(stats?.armorClass).toBe(12);
    expect(stats?.attackBonus).toBe(3);
    expect(stats?.damage).toBe('1d6+2');
    expect(stats?.initiativeBonus).toBe(1);
    expect(stats?.xpValue).toBe(50);
  });

  test('should accept NPC with minimal combatStats (no optional fields)', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        bandit: {
          name: 'Bandit',
          combatStats: {
            hitPoints: 10,
            armorClass: 10,
            attackBonus: 0,
            damage: '1d4',
          },
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.npcs.bandit.combatStats?.hitPoints).toBe(10);
  });

  test('should reject combatStats with invalid damage pattern', () => {
    const manifest = {
      ...validManifest,
      npcs: {
        bandit: {
          name: 'Bandit',
          combatStats: {
            hitPoints: 10,
            armorClass: 10,
            attackBonus: 0,
            damage: 'invalid',
          },
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should accept damage patterns: 1d4, 2d6, 1d8+2', () => {
    const patterns = ['1d4', '2d6', '1d8+2', '3d10+5'];
    for (const damage of patterns) {
      const manifest = {
        ...validManifest,
        npcs: {
          bandit: {
            name: 'Bandit',
            combatStats: {
              hitPoints: 10,
              armorClass: 10,
              attackBonus: 0,
              damage,
            },
          },
        },
      };
      const result = Value.Parse(ContentPackManifestSchema, manifest);
      expect(result.npcs.bandit.combatStats?.damage).toBe(damage);
    }
  });

  // ── C-316: manifest with quests, encounters, credits ──

  test('should accept manifest with quests field', () => {
    const manifest = {
      ...validManifest,
      quests: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        fading_ward: {
          id: 'fading_ward',
          name: 'The Fading Ward',
          description: 'Investigate the failing ward magic.',
          objectives: [{ text: 'Reach the Old Road', completeOnMapEnter: 'old_road' }],
          offerDialogueKey: 'elder_offer',
          progressDialogueKey: 'elder_progress',
          rewards: [{ type: 'item', itemId: 'wardAmulet' }],
          endings: {
            renewed: {
              title: 'Ward Renewed',
              narration:
                'The ward pulses with renewed vigor, its blue light spreading across the shrine and into the valley beyond, protecting Emberwatch for another century.',
              worldStateFlag: 'emberwatch.ending.renewed',
            },
          },
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const quest = result.quests?.fading_ward;
    expect(quest?.id).toBe('fading_ward');
    expect(quest?.name).toBe('The Fading Ward');
    expect(quest?.objectives.length).toBe(1);
    expect(Object.keys(quest?.endings ?? {}).length).toBe(1);
  });

  test('should accept manifest without quests field (optional)', () => {
    const result = Value.Parse(ContentPackManifestSchema, validManifest);
    expect(result.quests).toBeUndefined();
  });

  test('should accept manifest with encounters field', () => {
    const manifest = {
      ...validManifest,
      encounters: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        ruined_ward_encounter: {
          id: 'ruined_ward_encounter',
          mapId: 'ruined_ward_shrine',
          name: 'Shrine Guardian',
          enemyNpcIds: ['shade_guardian'],
          allowNonCombatResolution: true,
          nonCombatSkillCheck: {
            skill: 'persuasion',
            dc: 14,
            statModifier: 'charisma',
            successDialogueKey: 'shade_persuaded',
            failureDialogueKey: 'shade_enraged',
          },
          startDialogueKey: 'encounter_start',
          victoryDialogueKey: 'encounter_victory',
          loot: [{ itemId: 'wardShard', quantity: 1, dropChance: 1.0 }],
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const enc = result.encounters?.ruined_ward_encounter;
    expect(enc?.name).toBe('Shrine Guardian');
    expect(enc?.allowNonCombatResolution).toBe(true);
    expect(enc?.enemyNpcIds).toEqual(['shade_guardian']);
    expect(enc?.nonCombatSkillCheck?.dc).toBe(14);
  });

  test('should accept manifest without encounters field (optional)', () => {
    const result = Value.Parse(ContentPackManifestSchema, validManifest);
    expect(result.encounters).toBeUndefined();
  });

  test('should accept manifest with credits field', () => {
    const manifest = {
      ...validManifest,
      credits: {
        design: ['Alice'],
        writing: ['Bob'],
        art: ['Carol'],
        music: ['Dave'],
        thanks: ['Open source community'],
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    expect(result.credits?.design).toEqual(['Alice']);
    expect(result.credits?.writing).toEqual(['Bob']);
  });

  test('should accept manifest without credits field (optional)', () => {
    const result = Value.Parse(ContentPackManifestSchema, validManifest);
    expect(result.credits).toBeUndefined();
  });

  test('should reject quest with fewer than 1 objective', () => {
    const manifest = {
      ...validManifest,
      quests: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        empty_quest: {
          id: 'empty_quest',
          name: 'Empty',
          description: 'No objectives.',
          objectives: [],
          offerDialogueKey: 'offer',
          progressDialogueKey: 'progress',
          rewards: [],
          endings: {},
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should reject encounter with no enemy NPC IDs', () => {
    const manifest = {
      ...validManifest,
      encounters: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        no_enemies: {
          id: 'no_enemies',
          mapId: 'village',
          name: 'No Enemies',
          enemyNpcIds: [],
          allowNonCombatResolution: false,
          startDialogueKey: 'start',
          victoryDialogueKey: 'victory',
          loot: [],
        },
      },
    };
    expect(() => Value.Parse(ContentPackManifestSchema, manifest)).toThrow();
  });

  test('should accept all five skill stat values', () => {
    const stats = ['strength', 'dexterity', 'intelligence', 'charisma', 'wisdom'] as const;
    for (const stat of stats) {
      const manifest = {
        ...validManifest,
        encounters: {
          // biome-ignore lint/style/useNamingConvention: JSON manifest key
          test_enc: {
            id: 'test_enc',
            mapId: 'village',
            name: 'Test',
            enemyNpcIds: ['bandit'],
            allowNonCombatResolution: true,
            nonCombatSkillCheck: {
              skill: 'test',
              dc: 10,
              statModifier: stat,
              successDialogueKey: 'success',
              failureDialogueKey: 'failure',
            },
            startDialogueKey: 'start',
            victoryDialogueKey: 'victory',
            loot: [],
          },
        },
      };
      const result = Value.Parse(ContentPackManifestSchema, manifest);
      expect(result.encounters?.test_enc.nonCombatSkillCheck?.statModifier).toBe(stat);
    }
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
          equipmentSlot: 'armor',
        },
      },
    };
    const result = Value.Parse(ContentPackManifestSchema, manifest);
    const item = result.items.ironHelm;
    expect(item.defenseBonus).toBe(5);
    expect(item.equipmentSlot).toBe('armor');
    expect(item.attackBonus).toBeUndefined();
  });
});
