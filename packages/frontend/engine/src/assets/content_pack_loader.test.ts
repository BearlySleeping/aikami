// packages/frontend/engine/src/assets/content_pack_loader.test.ts
//
// Tests for content pack loader — manifest loading, URL resolution,
// dialogue lookup, quest/encounter/credits accessors, cache lifecycle,
// and error paths.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader
// Contract: C-316 Build the Authored Emberwatch Demo Adventure

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearContentPackCache, loadContentPack } from './content_pack_loader.ts';

// ---------------------------------------------------------------------------
// Test fixtures — keys are quoted to match JSON manifest property names
// ---------------------------------------------------------------------------

/** Minimal valid manifest fixture matching the TypeBox schema. */
const validManifest = {
  id: 'test-pack',
  name: 'Test Pack',
  version: '1.0.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  startingMapId: 'village',
  maps: {
    village: {
      file: 'maps/village.json',
      name: 'Village',
      defaultSpawnId: 'spawn_01',
      defaultX: 100,
      defaultY: 200,
    },
    dungeon: {
      file: 'maps/dungeon.jton',
      name: 'Dark Dungeon',
    },
  },
  npcs: {
    bartender: {
      name: 'Grizzled Bartender',
      defaultDialogueKey: 'bartender_greeting',
      isVendor: true,
    },
  },
  items: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    rusty_sword: {
      name: 'Rusty Sword',
      type: 'weapon' as const,
      attackBonus: 3,
      equipmentSlot: 'weapon',
    },
  },
  dialogues: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    bartender_greeting: 'Welcome to the tavern, stranger.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    quest_hint: 'The eastern forest hides ancient ruins.',
  },
};

/**
 * Creates a mock fetch that returns a given JSON body.
 * Tracks call count so cache tests can verify re-fetch behaviour.
 */
const createFetchMock = (body: unknown) => {
  let callCount = 0;
  const fetcher = mock(async (_url: string) => {
    callCount++;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { fetcher, getCallCount: () => callCount };
};

/** Creates a mock fetch that returns a 404. */
const createNotFoundFetch = () => {
  return mock(async (_url: string) => new Response('Not Found', { status: 404 }));
};

/** Creates a mock fetch that throws (network failure). */
const createNetworkErrorFetch = () => {
  return mock(async (_url: string) => {
    throw new Error('Network failure');
  });
};

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
// Tests
// ---------------------------------------------------------------------------

describe('ContentPackLoader', () => {
  // ── AC-2: Manifest loading and validation ──

  test('loadContentPack loads and validates a manifest', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.packId).toBe('test-pack');
    expect(loader.manifest.id).toBe('test-pack');
    expect(loader.manifest.version).toBe('1.0.0');
    expect(loader.manifest.startingMapId).toBe('village');
  });

  test('loadContentPack throws when manifest returns 404', async () => {
    const fetcher = createNotFoundFetch();

    await expect(
      loadContentPack({
        packId: 'missing-pack',
        fetchFn: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  test('loadContentPack throws on network failure', async () => {
    const fetcher = createNetworkErrorFetch();

    await expect(
      loadContentPack({
        packId: 'test-pack',
        fetchFn: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  test('loadContentPack throws when manifest fails schema validation', async () => {
    const invalid = {
      ...validManifest,
      version: 'not-semver',
    };
    const { fetcher } = createFetchMock(invalid);

    await expect(
      loadContentPack({
        packId: 'test-pack',
        fetchFn: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  test('loadContentPack throws when startingMapId references non-existent map', async () => {
    const invalid = {
      ...validManifest,
      startingMapId: 'non_existent_map',
    };
    const { fetcher } = createFetchMock(invalid);

    await expect(
      loadContentPack({
        packId: 'test-pack',
        fetchFn: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  // ── AC-2: URL resolution ──

  test('resolveMapUrl returns file path directly when file is absolute (starts with /)', async () => {
    const manifestWithAbsolutePath = {
      ...validManifest,
      maps: {
        ...validManifest.maps,
        village: {
          file: '/game-data/maps/sandbox_zone_a.json',
          name: 'Village',
        },
      },
    };
    const { fetcher } = createFetchMock(manifestWithAbsolutePath);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const url = loader.resolveMapUrl('village');
    expect(url).toBe('/game-data/maps/sandbox_zone_a.json');
  });

  test('resolveMapUrl returns the absolute URL constructed from base path', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      basePath: '/content-packs',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const url = loader.resolveMapUrl('village');
    expect(url).toBe('/content-packs/test-pack/maps/village.json');
  });

  test('resolveMapUrl works with custom basePath', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      basePath: '/assets/content',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const url = loader.resolveMapUrl('dungeon');
    expect(url).toBe('/assets/content/test-pack/maps/dungeon.jton');
  });

  test('resolveMapUrl throws for unknown map ID', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(() => loader.resolveMapUrl('unknown_map')).toThrow();
  });

  test('resolveMapUrl prevents path traversal', async () => {
    const manifestWithTraversal = {
      ...validManifest,
      maps: {
        ...validManifest.maps,
        malicious: {
          file: '../../../etc/passwd',
          name: 'Malicious',
        },
      },
    };
    const { fetcher } = createFetchMock(manifestWithTraversal);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    // The resolved URL should trigger the path traversal guard
    expect(() => loader.resolveMapUrl('malicious')).toThrow();
  });

  // ── AC-2: Dialogue lookup ──

  test('getDialogue returns fallback string for known dialogue key', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getDialogue('bartender_greeting')).toBe('Welcome to the tavern, stranger.');
  });

  test('getDialogue returns undefined for unknown dialogue key', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getDialogue('unknown_key')).toBeUndefined();
  });

  test('getDialogue does NOT throw for unknown key', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    // Must not throw — just return undefined
    const result = loader.getDialogue('completely_made_up_key');
    expect(result).toBeUndefined();
  });

  // ── AC-2: Starting map resolution ──

  test('getStartingMap returns the correct map entry with file path and default spawn', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const startingMap = loader.getStartingMap();
    expect(startingMap.file).toBe('maps/village.json');
    expect(startingMap.name).toBe('Village');
    expect(startingMap.defaultSpawnId).toBe('spawn_01');
    expect(startingMap.defaultX).toBe(100);
    expect(startingMap.defaultY).toBe(200);
  });

  // ── AC-2: Cache lifecycle ──

  test('calling loadContentPack twice with same packId returns cached instance', async () => {
    const { fetcher, getCallCount } = createFetchMock(validManifest);

    const loader1 = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });
    expect(getCallCount()).toBe(1);

    const loader2 = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });
    expect(loader2).toBe(loader1);
    expect(getCallCount()).toBe(1); // No additional fetch
  });

  test('clearContentPackCache clears the cache so subsequent load re-fetches', async () => {
    const { fetcher, getCallCount } = createFetchMock(validManifest);

    await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });
    expect(getCallCount()).toBe(1);

    clearContentPackCache();

    await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });
    expect(getCallCount()).toBe(2); // Re-fetched after cache clear
  });

  test('clearContentPackCache is idempotent — safe to call on empty cache', async () => {
    // Should not throw
    clearContentPackCache();
    clearContentPackCache();
    clearContentPackCache();

    // After clearing, should still work normally
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });
    expect(loader.packId).toBe('test-pack');
  });

  // ── AC-2: dispose() lifecycle ──

  test('dispose marks the loader as disposed; subsequent calls throw', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    loader.dispose();

    expect(() => loader.resolveMapUrl('village')).toThrow();
    expect(() => loader.getDialogue('bartender_greeting')).toThrow();
    expect(() => loader.getStartingMap()).toThrow();
  });

  test('dispose is idempotent — calling twice does not throw', async () => {
    const { fetcher } = createFetchMock(validManifest);

    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    loader.dispose();
    loader.dispose(); // Should not throw

    expect(() => loader.resolveMapUrl('village')).toThrow();
  });

  test('loadContentPack with different packIds caches independently', async () => {
    const manifest2 = { ...validManifest, id: 'other-pack' };
    const { fetcher: fetcher1, getCallCount: calls1 } = createFetchMock(validManifest);
    const { fetcher: fetcher2, getCallCount: calls2 } = createFetchMock(manifest2);

    const loader1 = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher1 as unknown as typeof fetch,
    });
    const loader2 = await loadContentPack({
      packId: 'other-pack',
      fetchFn: fetcher2 as unknown as typeof fetch,
    });

    expect(loader1).not.toBe(loader2);
    expect(loader1.packId).toBe('test-pack');
    expect(loader2.packId).toBe('other-pack');
    expect(calls1()).toBe(1);
    expect(calls2()).toBe(1);
  });

  // ── NPC and Item lookup ──

  test('getNpc returns NPC entry by ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const npc = loader.getNpc('bartender');
    expect(npc?.name).toBe('Grizzled Bartender');
  });

  test('getNpc returns undefined for unknown NPC ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getNpc('nonexistent')).toBeUndefined();
  });

  test('getItem returns item entry by ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const item = loader.getItem('rusty_sword');
    expect(item?.name).toBe('Rusty Sword');
    expect(item?.type).toBe('weapon');
  });

  test('getItem returns undefined for unknown item ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getItem('nonexistent')).toBeUndefined();
  });

  // ── C-316: quest accessors ──

  test('getQuest returns quest entry by ID', async () => {
    const manifestWithQuests = {
      ...validManifest,
      quests: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        fading_ward: {
          id: 'fading_ward',
          name: 'The Fading Ward',
          description: 'Investigate the failing ward.',
          objectives: [{ text: 'Reach the Old Road', completeOnMapEnter: 'old_road' }],
          offerDialogueKey: 'quest_offer',
          progressDialogueKey: 'quest_progress',
          rewards: [{ type: 'item', itemId: 'wardAmulet' }],
          endings: {
            good: {
              title: 'Ward Renewed',
              narration:
                'The ward pulses with renewed vigor, protecting Emberwatch for another century.',
              worldStateFlag: 'emberwatch.ending.renewed',
            },
          },
        },
      },
    };
    const { fetcher } = createFetchMock(manifestWithQuests);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const quest = loader.getQuest('fading_ward');
    expect(quest?.id).toBe('fading_ward');
    expect(quest?.name).toBe('The Fading Ward');
    expect(quest?.objectives.length).toBe(1);
  });

  test('getQuest returns undefined for unknown quest ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getQuest('nonexistent')).toBeUndefined();
  });

  test('getAllQuests returns all quest entries', async () => {
    const manifestWithQuests = {
      ...validManifest,
      quests: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        main_quest: {
          id: 'main_quest',
          name: 'Main Quest',
          description: 'Save the world.',
          objectives: [{ text: 'Find the artifact', completeOnMapEnter: 'dungeon' }],
          offerDialogueKey: 'offer',
          progressDialogueKey: 'progress',
          rewards: [],
          endings: {},
        },
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        side_quest: {
          id: 'side_quest',
          name: 'Side Quest',
          description: 'Help the merchant.',
          objectives: [{ text: 'Find the pendant', completeOnItemPickup: 'lostPendant' }],
          offerDialogueKey: 'merchant_offer',
          progressDialogueKey: 'merchant_progress',
          rewards: [{ type: 'gold', amount: 50 }],
          endings: {},
        },
      },
    };
    const { fetcher } = createFetchMock(manifestWithQuests);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const all = loader.getAllQuests();
    expect(all.length).toBe(2);
    expect(all.map((q) => q.id).sort()).toEqual(['main_quest', 'side_quest']);
  });

  test('getAllQuests returns empty array when no quests in manifest', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getAllQuests()).toEqual([]);
  });

  // ── C-316: encounter accessors ──

  test('getEncounter returns encounter entry by ID', async () => {
    const manifestWithEncounters = {
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
    const { fetcher } = createFetchMock(manifestWithEncounters);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const enc = loader.getEncounter('ruined_ward_encounter');
    expect(enc?.name).toBe('Shrine Guardian');
    expect(enc?.enemyNpcIds).toEqual(['shade_guardian']);
    expect(enc?.allowNonCombatResolution).toBe(true);
    expect(enc?.nonCombatSkillCheck?.dc).toBe(14);
  });

  test('getEncounter returns undefined for unknown encounter ID', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getEncounter('nonexistent')).toBeUndefined();
  });

  test('getAllEncounters returns all encounter entries', async () => {
    const manifestWithEncounters = {
      ...validManifest,
      encounters: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        enc_1: {
          id: 'enc_1',
          mapId: 'village',
          name: 'Encounter 1',
          enemyNpcIds: ['bandit'],
          allowNonCombatResolution: false,
          startDialogueKey: 'start1',
          victoryDialogueKey: 'victory1',
          loot: [],
        },
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        enc_2: {
          id: 'enc_2',
          mapId: 'dungeon',
          name: 'Encounter 2',
          enemyNpcIds: ['dragon'],
          allowNonCombatResolution: false,
          startDialogueKey: 'start2',
          victoryDialogueKey: 'victory2',
          loot: [],
        },
      },
    };
    const { fetcher } = createFetchMock(manifestWithEncounters);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const all = loader.getAllEncounters();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.id).sort()).toEqual(['enc_1', 'enc_2']);
  });

  test('getAllEncounters returns empty array when no encounters in manifest', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getAllEncounters()).toEqual([]);
  });

  // ── C-316: credits accessor ──

  test('getCredits returns credits when present', async () => {
    const manifestWithCredits = {
      ...validManifest,
      credits: {
        design: ['Alice'],
        writing: ['Bob'],
        art: ['Carol'],
        music: ['Dave'],
        thanks: ['The community'],
      },
    };
    const { fetcher } = createFetchMock(manifestWithCredits);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const credits = loader.getCredits();
    expect(credits?.design).toEqual(['Alice']);
    expect(credits?.writing).toEqual(['Bob']);
  });

  test('getCredits returns undefined when not present', async () => {
    const { fetcher } = createFetchMock(validManifest);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getCredits()).toBeUndefined();
  });

  // ── C-316: dispose affects new accessors ──

  test('dispose blocks getQuest, getEncounter, getAllQuests, getAllEncounters, getCredits', async () => {
    const manifestWithAll = {
      ...validManifest,
      quests: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        test_quest: {
          id: 'test_quest',
          name: 'Test',
          description: 'Test quest.',
          objectives: [{ text: 'Do something', completeOnMapEnter: 'village' }],
          offerDialogueKey: 'offer',
          progressDialogueKey: 'progress',
          rewards: [],
          endings: {},
        },
      },
      encounters: {
        // biome-ignore lint/style/useNamingConvention: JSON manifest key
        test_enc: {
          id: 'test_enc',
          mapId: 'village',
          name: 'Test Enc',
          enemyNpcIds: ['bandit'],
          allowNonCombatResolution: false,
          startDialogueKey: 'start',
          victoryDialogueKey: 'victory',
          loot: [],
        },
      },
      credits: {
        design: [],
        writing: [],
        art: [],
        music: [],
        thanks: [],
      },
    };
    const { fetcher } = createFetchMock(manifestWithAll);
    const loader = await loadContentPack({
      packId: 'test-pack',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    loader.dispose();

    expect(() => loader.getQuest('test_quest')).toThrow();
    expect(() => loader.getEncounter('test_enc')).toThrow();
    expect(() => loader.getAllQuests()).toThrow();
    expect(() => loader.getAllEncounters()).toThrow();
    expect(() => loader.getCredits()).toThrow();
  });
});
