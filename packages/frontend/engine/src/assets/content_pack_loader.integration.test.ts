// packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts
//
// Integration test: Emberwatch v2.0.0 manifest → load → verify all accessors.
// CI-verifiable via in-memory fetch mocking — no dev server needed.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader
// Contract: C-316 Build the Authored Emberwatch Demo Adventure

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearContentPackCache, loadContentPack } from './content_pack_loader.ts';

// ---------------------------------------------------------------------------
// Emberwatch v2.0.0 authored manifest (matches
// apps/frontend/client/static/content-packs/emberwatch/manifest.json)
// ---------------------------------------------------------------------------

const emberwatchManifest = {
  id: 'emberwatch',
  name: 'Emberwatch: The Fading Ward',
  version: '2.0.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  startingMapId: 'emberwatch_village',
  maps: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    emberwatch_village: {
      file: 'maps/emberwatch_village.json',
      name: 'Emberwatch Village',
      defaultSpawnId: 'village_gate',
      defaultX: 320,
      defaultY: 576,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    old_road: {
      file: 'maps/old_road.json',
      name: 'The Old Road',
      defaultX: 64,
      defaultY: 240,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    ruined_ward_shrine: {
      file: 'maps/ruined_ward_shrine.json',
      name: 'Ruined Ward Shrine',
      defaultX: 96,
      defaultY: 332,
    },
  },
  npcs: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    village_elder: {
      name: 'Elder Thalia',
      defaultDialogueKey: 'elder_thalia_greeting',
      appearanceLayers: [1, 5, 8, 12],
      isVendor: false,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain: {
      name: 'Guard Captain Aldric',
      defaultDialogueKey: 'guard_captain_greeting',
      appearanceLayers: [3, 7, 10, 15],
      isVendor: false,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    traveling_merchant: {
      name: 'Keth the Merchant',
      defaultDialogueKey: 'merchant_keth_greeting',
      appearanceLayers: [1, 4, 9, 11],
      isVendor: true,
      vendorInventory: 'ironSword, healthPotion, manaPotion, ironArmor, woodenShield',
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elara_wayfinder: {
      name: 'Elara Wayfinder',
      defaultDialogueKey: 'elara_wayfinder_greeting',
      appearanceLayers: [2, 6, 13, 14],
      isVendor: false,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    kade_blackthorn: {
      name: 'Kade Blackthorn',
      defaultDialogueKey: 'kade_blackthorn_taunt',
      appearanceLayers: [3, 5, 11, 15],
      isVendor: false,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit: {
      name: 'Vesperine Spirit',
      defaultDialogueKey: 'shrine_spirit_greeting',
      appearanceLayers: [4, 8, 12, 16],
      isVendor: false,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shade_guardian: {
      name: 'Shade Guardian',
      defaultDialogueKey: 'shade_guardian_manifest',
      isVendor: false,
      combatStats: {
        hitPoints: 30,
        armorClass: 13,
        attackBonus: 4,
        damage: '1d8+2',
        initiativeBonus: 0,
        xpValue: 75,
      },
    },
  },
  items: {
    ironSword: {
      name: 'Iron Sword',
      type: 'weapon',
      attackBonus: 5,
      equipmentSlot: 'weapon',
    },
    healthPotion: {
      name: 'Health Potion',
      type: 'consumable',
    },
    manaPotion: {
      name: 'Mana Potion',
      type: 'consumable',
    },
    ironArmor: {
      name: 'Iron Armor',
      type: 'armor',
      defenseBonus: 5,
      equipmentSlot: 'armor',
    },
    woodenShield: {
      name: 'Wooden Shield',
      type: 'armor',
      defenseBonus: 2,
      equipmentSlot: 'armor',
    },
    wardPendant: {
      name: 'Ward Pendant',
      type: 'key',
      equipmentSlot: 'neck',
    },
    wardAmulet: {
      name: 'Ward Amulet',
      type: 'misc',
      defenseBonus: 3,
      equipmentSlot: 'neck',
    },
    wardShard: {
      name: 'Ward Shard',
      type: 'misc',
    },
  },
  dialogues: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_greeting:
      "Ah, a traveler! Welcome to Emberwatch. I am Elder Thalia, keeper of this village's lore.",
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_offer: 'The Ward of Emberwatch was placed centuries ago by the Vesperine Order.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_progress: 'Any news from the Old Road?',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_complete: "You've returned!",
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_ending_renewed: 'The Ward renewed!',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_ending_sacrificed: 'A sacrifice was made...',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elder_thalia_ending_shattered: 'The ward... it is gone.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain_greeting: 'Welcome to Emberwatch, traveler.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain_quest: 'Elder Thalia could use someone like you.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    merchant_keth_greeting: 'Well met, traveler!',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    merchant_keth_lost_pendant: 'Say, you look like someone who gets around.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elara_wayfinder_greeting: 'You must be the one Elder Thalia sent.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elara_wayfinder_join: "You'll need help.",
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    elara_wayfinder_context: "The ward's been failing for weeks now.",
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    kade_blackthorn_taunt: 'Well, well. Another fool chasing fairy tales.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    kade_blackthorn_persuasion_success: 'Hmph. You speak with conviction.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    kade_blackthorn_persuasion_failure: "Nice words. But words don't change anything.",
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit_greeting: 'At last... someone has come.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit_explanation: 'The ward was created through sacrifice.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit_ending_renewed: 'You chose renewal through sacrifice.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit_ending_sacrificed: 'You gave something precious.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shrine_spirit_ending_shattered: 'The crystal shatters...',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shade_guardian_manifest: 'The corruption stirs...',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    encounter_start: 'A twisted shade emerges from the shadows!',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    encounter_victory: 'The shade dissolves into mist.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shade_persuaded: 'You speak words of peace and understanding.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    shade_enraged: 'Your words mean nothing to the shade.',
  },
  quests: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    fading_ward: {
      id: 'fading_ward',
      name: 'The Fading Ward',
      description: 'The ancient ward protecting Emberwatch is failing.',
      objectives: [
        { text: 'Investigate the Old Road', completeOnMapEnter: 'old_road' },
        { text: 'Reach the Ruined Ward Shrine', completeOnMapEnter: 'ruined_ward_shrine' },
        { text: "Decide the ward's fate", completeOnEncounterComplete: 'ruined_ward_encounter' },
      ],
      offerDialogueKey: 'elder_thalia_offer',
      progressDialogueKey: 'elder_thalia_progress',
      rewards: [
        { type: 'item', itemId: 'wardAmulet' },
        { type: 'gold', amount: 200 },
        { type: 'xp', amount: 500 },
      ],
      endings: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        ward_renewed: {
          title: 'The Ward Renewed',
          narration:
            'You place your hands upon the fading crystal and channel your own life force into the ward. A searing light erupts from the shrine, flooding the valley with warmth.',
          worldStateFlag: 'emberwatch.ending.renewed',
        },
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        ward_sacrificed: {
          title: 'The Ward Sacrificed',
          narration:
            'You offer the Ward Pendant to the crystal. The pendant dissolves into motes of blue light that weave themselves into the failing ward, mending its fractures.',
          worldStateFlag: 'emberwatch.ending.sacrificed',
        },
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        ward_shattered: {
          title: 'The Ward Shattered',
          narration:
            'With a decisive strike, you shatter the ward crystal. A shockwave of raw arcane energy ripples outward, scouring the valley clean of corruption.',
          worldStateFlag: 'emberwatch.ending.shattered',
        },
      },
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    lost_pendant: {
      id: 'lost_pendant',
      name: "The Merchant's Lost Pendant",
      description: 'Keth the Merchant dropped a silver pendant on the Old Road.',
      objectives: [
        { text: "Find Keth's lost pendant on the Old Road", completeOnItemPickup: 'wardPendant' },
        { text: 'Return the pendant to Keth', completeOnNpcInteract: 'traveling_merchant' },
      ],
      offerDialogueKey: 'merchant_keth_lost_pendant',
      progressDialogueKey: 'merchant_keth_greeting',
      rewards: [
        { type: 'item', itemId: 'steelSword' },
        { type: 'gold', amount: 100 },
      ],
      endings: {
        returned: {
          title: 'Pendant Returned',
          narration:
            "Keth's eyes light up as you hand him the pendant. He presses a gleaming steel sword into your hands.",
          worldStateFlag: 'emberwatch.pendant.returned',
        },
      },
    },
  },
  encounters: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    ruined_ward_encounter: {
      id: 'ruined_ward_encounter',
      mapId: 'ruined_ward_shrine',
      name: 'Shade of the Ruined Shrine',
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
      nonCombatSuccessDialogueKey: 'shade_persuaded',
      loot: [
        { itemId: 'wardShard', quantity: 1, dropChance: 1.0 },
        { itemId: 'healthPotion', quantity: 1, dropChance: 0.5 },
      ],
    },
  },
  credits: {
    design: ['Aikami Studio'],
    writing: ['Aikami Studio'],
    art: ['Liberated Pixel Cup (LPC) asset contributors'],
    music: ['Chainsmoker — Exploration Theme'],
    thanks: ['The open-source game development community', 'The LPC asset artists'],
  },
};

// ---------------------------------------------------------------------------
// Fetch mock: only responds to /content-packs/emberwatch/manifest.json
// ---------------------------------------------------------------------------

const createEmberwatchFetch = () => {
  return mock(async (url: string) => {
    if (url === '/content-packs/emberwatch/manifest.json') {
      return new Response(JSON.stringify(emberwatchManifest), { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  });
};

// ---------------------------------------------------------------------------
// ITEM_CATALOG subset used for reconciliation testing
// ---------------------------------------------------------------------------

const ITEM_CATALOG_KEYS = new Set([
  'rustySword',
  'ironSword',
  'steelSword',
  'woodenShield',
  'leatherArmor',
  'ironArmor',
  'healthPotion',
  'manaPotion',
  'goldCoin',
  'wardPendant',
  'wardAmulet',
  'wardShard',
]);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearContentPackCache();
});

afterEach(() => {
  clearContentPackCache();
});

// ---------------------------------------------------------------------------
// Tests — AC-1, AC-2, AC-3, AC-4, AC-5
// ---------------------------------------------------------------------------

describe('ContentPackLoader — Emberwatch v2.0.0 Integration', () => {
  // ── AC-1: Manifest loads and validates ──

  test('loads emberwatch manifest with version 2.0.0', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.packId).toBe('emberwatch');
    expect(loader.manifest.version).toBe('2.0.0');
    expect(loader.manifest.startingMapId).toBe('emberwatch_village');
  });

  test('map count is exactly 3', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const mapIds = Object.keys(loader.manifest.maps);
    expect(mapIds.length).toBe(3);
    expect(mapIds).toContain('emberwatch_village');
    expect(mapIds).toContain('old_road');
    expect(mapIds).toContain('ruined_ward_shrine');
  });

  test('npc count is at least 6', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const npcIds = Object.keys(loader.manifest.npcs);
    expect(npcIds.length).toBeGreaterThanOrEqual(6);
  });

  test('dialogue count is at least 20', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const dialogueKeys = Object.keys(loader.manifest.dialogues);
    expect(dialogueKeys.length).toBeGreaterThanOrEqual(20);
  });

  test('item count is at least 8', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const itemIds = Object.keys(loader.manifest.items);
    expect(itemIds.length).toBeGreaterThanOrEqual(8);
  });

  // ── AC-1: credits present ──

  test('credits section is present', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const credits = loader.getCredits();
    expect(credits).toBeDefined();
    expect(credits?.design).toBeDefined();
    expect(credits?.writing).toBeDefined();
    expect(credits?.art).toBeDefined();
    expect(credits?.music).toBeDefined();
    expect(credits?.thanks).toBeDefined();
  });

  // ── AC-2: Starting map resolution ──

  test('getStartingMap resolves to emberwatch_village', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const startingMap = loader.getStartingMap();
    expect(startingMap.file).toBe('maps/emberwatch_village.json');
    expect(startingMap.name).toBe('Emberwatch Village');
  });

  // ── AC-3: NPC cast with dialogue ──

  test('quest giver NPC (village_elder) has all interaction dialogue', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const elder = loader.getNpc('village_elder');
    expect(elder?.name).toBe('Elder Thalia');
    expect(elder?.appearanceLayers?.length).toBeGreaterThanOrEqual(4);

    // All dialogue keys resolve
    const keys = [
      'elder_thalia_greeting',
      'elder_thalia_offer',
      'elder_thalia_progress',
      'elder_thalia_complete',
      'elder_thalia_ending_renewed',
      'elder_thalia_ending_sacrificed',
      'elder_thalia_ending_shattered',
    ];
    for (const key of keys) {
      expect(loader.getDialogue(key)).toBeDefined();
    }
  });

  test('vendor NPC (traveling_merchant) has valid vendorInventory', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const merchant = loader.getNpc('traveling_merchant');
    expect(merchant?.isVendor).toBe(true);
    expect(merchant?.vendorInventory).toBeDefined();

    const items = merchant?.vendorInventory?.split(/,\s*/) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(4);

    // All vendor items exist in manifest.items
    for (const itemId of items) {
      expect(loader.getItem(itemId)).toBeDefined();
    }
  });

  test('rival NPC (kade_blackthorn) has taunt and skill-check resolution dialogue', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getNpc('kade_blackthorn')?.name).toBe('Kade Blackthorn');
    expect(loader.getDialogue('kade_blackthorn_taunt')).toBeDefined();
    expect(loader.getDialogue('kade_blackthorn_persuasion_success')).toBeDefined();
    expect(loader.getDialogue('kade_blackthorn_persuasion_failure')).toBeDefined();
  });

  test('shrine spirit NPC has ending-specific reaction dialogues', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getNpc('shrine_spirit')?.name).toBe('Vesperine Spirit');
    expect(loader.getDialogue('shrine_spirit_greeting')).toBeDefined();
    expect(loader.getDialogue('shrine_spirit_explanation')).toBeDefined();
    expect(loader.getDialogue('shrine_spirit_ending_renewed')).toBeDefined();
    expect(loader.getDialogue('shrine_spirit_ending_sacrificed')).toBeDefined();
    expect(loader.getDialogue('shrine_spirit_ending_shattered')).toBeDefined();
  });

  // ── AC-4: Quest data ──

  test('fading_ward quest has 3 objectives and 3 endings', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const quest = loader.getQuest('fading_ward');
    expect(quest?.name).toBe('The Fading Ward');
    expect(quest?.objectives.length).toBe(3);

    const endingIds = Object.keys(quest?.endings ?? {});
    expect(endingIds.length).toBe(3);
    expect(endingIds).toContain('ward_renewed');
    expect(endingIds).toContain('ward_sacrificed');
    expect(endingIds).toContain('ward_shattered');
  });

  test('each fading_ward ending has title, narration (50+ chars), and worldStateFlag', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const quest = loader.getQuest('fading_ward');
    const endings = quest?.endings ?? {};

    for (const [_key, ending] of Object.entries(endings)) {
      expect(ending.title.length).toBeGreaterThan(0);
      expect(ending.narration.length).toBeGreaterThanOrEqual(50);
      expect(ending.worldStateFlag).toMatch(/^emberwatch\.ending\./);
    }
  });

  test('fading_ward rewards include at least one item and gold or xp', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const quest = loader.getQuest('fading_ward');
    expect(quest?.rewards.length).toBeGreaterThan(0);

    const rewardTypes = quest?.rewards.map((r) => r.type) ?? [];
    const hasItem = rewardTypes.includes('item');
    const hasGoldOrXp = rewardTypes.includes('gold') || rewardTypes.includes('xp');
    expect(hasItem).toBe(true);
    expect(hasGoldOrXp).toBe(true);
  });

  test('lost_pendant optional quest exists', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const quest = loader.getQuest('lost_pendant');
    expect(quest?.name).toBe("The Merchant's Lost Pendant");
    expect(quest?.objectives.length).toBe(2);
  });

  // ── AC-5: Encounter data ──

  test('ruined_ward_encounter has complete resolution data', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    expect(enc?.name).toBe('Shade of the Ruined Shrine');
    expect(enc?.mapId).toBe('ruined_ward_shrine');
    expect(enc?.enemyNpcIds.length).toBeGreaterThanOrEqual(1);
    expect(enc?.allowNonCombatResolution).toBe(true);
  });

  test('ruined_ward_encounter skill check is persuasion DC 14 charisma', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    const check = enc?.nonCombatSkillCheck;
    expect(check?.skill).toBe('persuasion');
    expect(check?.dc).toBe(14);
    expect(check?.statModifier).toBe('charisma');
  });

  test('ruined_ward_encounter dialogue keys resolve', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    expect(loader.getDialogue(enc?.startDialogueKey ?? '')).toBeDefined();
    expect(loader.getDialogue(enc?.victoryDialogueKey ?? '')).toBeDefined();
    expect(loader.getDialogue(enc?.nonCombatSkillCheck?.successDialogueKey ?? '')).toBeDefined();
    expect(loader.getDialogue(enc?.nonCombatSkillCheck?.failureDialogueKey ?? '')).toBeDefined();
  });

  test('ruined_ward_encounter has at least one guaranteed loot drop', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    expect(enc?.loot.length).toBeGreaterThanOrEqual(1);
    const guaranteedLoot = enc?.loot.find((l) => l.dropChance === 1.0);
    expect(guaranteedLoot).toBeDefined();
  });

  test('enemy NPCs in encounter have combatStats', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    for (const npcId of enc?.enemyNpcIds ?? []) {
      const npc = loader.getNpc(npcId);
      expect(npc?.combatStats).toBeDefined();
      expect(npc?.combatStats?.hitPoints).toBeGreaterThan(0);
    }
  });

  // ── AC-5: Item ID reconciliation ──

  test('all item IDs in manifest resolve in ITEM_CATALOG', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    // All manifest item keys
    for (const itemId of Object.keys(loader.manifest.items)) {
      expect(ITEM_CATALOG_KEYS.has(itemId)).toBe(true);
    }

    // All vendorInventory items
    for (const [_npcId, npc] of Object.entries(loader.manifest.npcs)) {
      if (npc.vendorInventory) {
        const vendorItems = npc.vendorInventory.split(/,\s*/);
        for (const itemId of vendorItems) {
          expect(ITEM_CATALOG_KEYS.has(itemId)).toBe(true);
        }
      }
    }

    // All loot items
    for (const [_encId, enc] of Object.entries(loader.manifest.encounters ?? {})) {
      for (const loot of enc.loot) {
        expect(ITEM_CATALOG_KEYS.has(loot.itemId)).toBe(true);
      }
    }
  });

  // ── Loader accessor integration ──

  test('getAllQuests returns 2 quests', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const allQuests = loader.getAllQuests();
    expect(allQuests.length).toBe(2);
  });

  test('getAllEncounters returns 1 encounter', async () => {
    const fetcher = createEmberwatchFetch();
    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const allEncounters = loader.getAllEncounters();
    expect(allEncounters.length).toBe(1);
  });
});
