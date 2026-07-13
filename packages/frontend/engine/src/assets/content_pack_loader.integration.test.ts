// packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts
//
// Integration test: emberwatch stub → load → verify starting map resolution.
// CI-verifiable via in-memory fetch mocking — no dev server needed.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearContentPackCache, loadContentPack } from './content_pack_loader.ts';

// ---------------------------------------------------------------------------
// Emberwatch stub manifest (matches the real manifest at
// apps/frontend/client/static/content-packs/emberwatch/manifest.json)
// ---------------------------------------------------------------------------

const emberwatchManifest = {
  id: 'emberwatch',
  name: 'Emberwatch',
  version: '1.0.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  startingMapId: 'sandbox_zone_a',
  maps: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    sandbox_zone_a: {
      file: '/game-data/maps/sandbox_zone_a.json',
      name: 'Sandbox Zone A',
      defaultX: 160,
      defaultY: 192,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    sandbox_zone_b: {
      file: '/game-data/maps/sandbox_zone_b.json',
      name: 'Sandbox Zone B',
      defaultX: 160,
      defaultY: 192,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    sandbox_combat: {
      file: '/game-data/maps/sandbox_combat.json',
      name: 'Sandbox Combat Arena',
      defaultX: 160,
      defaultY: 192,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    sandbox_textured: {
      file: '/game-data/maps/sandbox_textured.jton',
      name: 'Sandbox Textured',
      defaultX: 160,
      defaultY: 192,
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    debug_map: {
      file: '/game-data/maps/debug_map.jton',
      name: 'Debug Map',
      defaultX: 160,
      defaultY: 192,
    },
  },
  npcs: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain: {
      name: 'Guard Captain Aldric',
      defaultDialogueKey: 'guard_captain_greeting',
      isVendor: false,
    },
  },
  items: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    rusty_sword: {
      name: 'Rusty Sword',
      type: 'weapon',
      attackBonus: 3,
      equipmentSlot: 'main_hand',
    },
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    healing_potion: {
      name: 'Healing Potion',
      type: 'consumable',
    },
  },
  dialogues: {
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain_greeting:
      'Welcome to Emberwatch, traveler. The roads have been dangerous lately.',
    // biome-ignore lint/style/useNamingConvention: JSON manifest key
    guard_captain_quest:
      "If you're looking for work, the captain of the watch could use someone with your... talents.",
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
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearContentPackCache();
});

afterEach(() => {
  clearContentPackCache();
});

// ---------------------------------------------------------------------------
// Tests — AC-3 (static serving simulation) + AC-4 (engine-side starting map)
// ---------------------------------------------------------------------------

describe('ContentPackLoader — Emberwatch Integration', () => {
  test('loads emberwatch manifest via /content-packs/emberwatch/manifest.json', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.packId).toBe('emberwatch');
    expect(loader.manifest.id).toBe('emberwatch');
    expect(loader.manifest.name).toBe('Emberwatch');
    expect(loader.manifest.version).toBe('1.0.0');
  });

  test('getStartingMap resolves to sandbox_zone_a with real map path', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const startingMap = loader.getStartingMap();
    expect(startingMap.file).toBe('/game-data/maps/sandbox_zone_a.json');
    expect(startingMap.name).toBe('Sandbox Zone A');
    expect(startingMap.defaultX).toBe(160);
    expect(startingMap.defaultY).toBe(192);
  });

  test('resolveMapUrl for starting map returns the real map path', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const url = loader.resolveMapUrl('sandbox_zone_a');
    expect(url).toBe('/game-data/maps/sandbox_zone_a.json');
  });

  test('resolveMapUrl for sandbox_zone_b returns correct path', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const url = loader.resolveMapUrl('sandbox_zone_b');
    expect(url).toBe('/game-data/maps/sandbox_zone_b.json');
  });

  test('dialogue lookup returns expected fallback strings', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    expect(loader.getDialogue('guard_captain_greeting')).toContain('Welcome to Emberwatch');
    expect(loader.getDialogue('guard_captain_quest')).toContain('captain of the watch');
    expect(loader.getDialogue('nonexistent')).toBeUndefined();
  });

  test('NPC lookup returns expected entries', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const npc = loader.getNpc('guard_captain');
    expect(npc?.name).toBe('Guard Captain Aldric');
    expect(npc?.defaultDialogueKey).toBe('guard_captain_greeting');
    expect(npc?.isVendor).toBe(false);
  });

  test('item lookup returns expected entries', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const sword = loader.getItem('rusty_sword');
    expect(sword?.name).toBe('Rusty Sword');
    expect(sword?.type).toBe('weapon');
    expect(sword?.attackBonus).toBe(3);

    const potion = loader.getItem('healing_potion');
    expect(potion?.name).toBe('Healing Potion');
    expect(potion?.type).toBe('consumable');
  });

  test('map count matches expected', async () => {
    const fetcher = createEmberwatchFetch();

    const loader = await loadContentPack({
      packId: 'emberwatch',
      fetchFn: fetcher as unknown as typeof fetch,
    });

    const mapIds = Object.keys(loader.manifest.maps);
    expect(mapIds.length).toBe(5);
    expect(mapIds).toContain('sandbox_zone_a');
    expect(mapIds).toContain('sandbox_zone_b');
    expect(mapIds).toContain('sandbox_combat');
    expect(mapIds).toContain('sandbox_textured');
    expect(mapIds).toContain('debug_map');
  });
});
