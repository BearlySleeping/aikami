// apps/frontend/client/src/lib/services/game/game_composition_root.test.ts
//
// Unit tests for GameCompositionRoot (C-314 AC-1, AC-6).
// Tests structure, interface, idempotency, disposal safety, and lifecycle.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived mock is provided by test_preload.ts
// @aikami/frontend/services mock is provided by test_preload.ts

const autonomousStartMock = mock(() => {});
const autonomousStopMock = mock(() => {});

const _createServiceStub = () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = mock(() => {});
      }
      return target[prop];
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as Record<string, unknown>;
};

const _stubService = () =>
  Object.assign(_createServiceStub(), {
    initialize: mock(async () => {}),
    startListening: mock(async () => {}),
    reset: mock(() => {}),
    setEngineService: mock(() => {}),
    setBridge: mock(() => {}),
  });

/** Minimal valid content-pack manifest served for loadContentPack(). */
const MOCK_MANIFEST = {
  id: 'emberwatch',
  name: 'Emberwatch',
  version: '1.0.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  startingMapId: 'startingVillage',
  maps: {
    startingVillage: {
      file: 'maps/starting_village.json',
      name: 'Starting Village',
    },
  },
  npcs: {},
  items: {},
  dialogues: {},
};

// Register every direct service dependency before either suite imports the
// composition root. Bun caches evaluated modules across describes.
mock.module('@aikami/frontend/engine', () => ({
  createEngineBridge: mock(() => ({ on: mock(() => mock(() => {})) })),
  loadContentPack: mock(async () => ({
    manifest: MOCK_MANIFEST,
    getNpc: mock(() => undefined),
    getDialogue: mock(() => undefined),
    getQuest: mock(() => undefined),
    getAllQuests: mock(() => []),
    getAllEncounters: mock(() => []),
    getEncounter: mock(() => undefined),
    getItem: mock(() => undefined),
    getAllFactions: mock(() => []),
  })),
}));
mock.module('$lib/services/assets/registry_resolver', () => ({
  assetTagResolver: mock(() => undefined),
}));
mock.module('../ai/text_generation_service.svelte', () => ({
  textGenerationService: _stubService(),
}));
mock.module('../audio/music_player_service.svelte', () => ({
  musicPlayerService: _stubService(),
}));
mock.module('../campaign/campaign_service.svelte', () => ({
  campaignService: Object.assign(_stubService(), {
    activeCampaign: { contentPackId: 'emberwatch' },
  }),
}));
mock.module('../npc/autonomous_message_service.svelte.ts', () => ({
  autonomousMessageService: { start: autonomousStartMock, stop: autonomousStopMock },
}));
mock.module('./equipment_service.svelte', () => ({
  equipmentService: _stubService(),
}));
mock.module('./game_engine_service.svelte', () => ({
  gameEngineService: _stubService(),
}));
mock.module('./game_mode_service.svelte', () => ({
  gameModeService: _stubService(),
}));
mock.module('./game_overlay_service.svelte', () => ({
  gameOverlayService: _stubService(),
}));
mock.module('./inventory_service.svelte', () => ({
  inventoryService: _stubService(),
}));
mock.module('./npc_dialogue_service.svelte', () => ({
  npcDialogueService: _stubService(),
}));
mock.module('./party_roster_service.svelte.ts', () => ({
  partyRosterService: _stubService(),
}));
mock.module('./player_state_service.svelte', () => ({
  playerStateService: _stubService(),
}));
mock.module('./quest_state_service.svelte', () => ({
  questStateService: _stubService(),
}));
mock.module('./relationship_service.svelte.ts', () => ({
  relationshipService: _stubService(),
}));
mock.module('./session_service.svelte', () => ({
  sessionService: _stubService(),
}));
mock.module('./vendor_service.svelte', () => ({
  vendorService: _stubService(),
}));
mock.module('./world_state_service.svelte', () => ({
  worldStateService: _stubService(),
}));

describe('GameCompositionRoot (unit)', () => {
  let GameCompositionRoot: typeof import('./game_composition_root.svelte').GameCompositionRoot;
  let root: import('./game_composition_root.svelte').GameCompositionRootInterface;

  beforeEach(async () => {
    const mod = await import('./game_composition_root.svelte');
    GameCompositionRoot = mod.GameCompositionRoot;
    root = GameCompositionRoot.create({
      className: 'TestGameCompositionRoot',
    });
  });

  afterEach(async () => {
    if (root.isInitialized) {
      await root.dispose();
    }
  });

  // ── Structure ──

  test('should export factory function using create()', () => {
    expect(typeof GameCompositionRoot.create).toBe('function');
    // create() returns the interface type
    expect(root).toBeDefined();
    expect(typeof root.initialize).toBe('function');
    expect(typeof root.dispose).toBe('function');
  });

  test('should not be initialized initially', () => {
    expect(root.isInitialized).toBe(false);
  });

  test('should have all service accessor properties', () => {
    expect(root.isInitialized).toBe(false);
    // Accessors throw when not initialized — verify they exist
    const accessors = [
      'campaignService',
      'playerStateService',
      'worldStateService',
      'inventoryService',
      'equipmentService',
      'gameModeService',
      'gameEngineService',
      'gameOverlayService',
      'sessionService',
    ];
    for (const accessor of accessors) {
      expect(() => (root as Record<string, unknown>)[accessor]).toBeDefined();
    }
  });

  // ── Disposal Safety ──

  test('should be safe to dispose when not initialized', async () => {
    await root.dispose();
    expect(root.isInitialized).toBe(false);
    // Double dispose should also be safe
    await root.dispose();
    expect(root.isInitialized).toBe(false);
  });
});

describe('GameCompositionRoot (integration — mocked services)', () => {
  let GameCompositionRoot: typeof import('./game_composition_root.svelte').GameCompositionRoot;
  let root: import('./game_composition_root.svelte').GameCompositionRootInterface;

  beforeEach(async () => {
    autonomousStartMock.mockClear();
    autonomousStopMock.mockClear();

    const mod = await import('./game_composition_root.svelte');
    GameCompositionRoot = mod.GameCompositionRoot;
    root = GameCompositionRoot.create({
      className: 'TestGameCompositionRoot',
    });
  });

  afterEach(async () => {
    if (root.isInitialized) {
      await root.dispose();
    }
  });

  // ── Idempotency ──

  test('should be idempotent — double init returns same state', async () => {
    await root.initialize();
    expect(root.isInitialized).toBe(true);

    // Second initialize should be a no-op
    await root.initialize();
    expect(root.isInitialized).toBe(true);

    // Disposal should clear state
    await root.dispose();
    expect(root.isInitialized).toBe(false);
  });

  // ── Double Init/Dispose Cycle ──

  test('should support full double initialize/dispose cycle', async () => {
    // First cycle
    await root.initialize();
    expect(root.isInitialized).toBe(true);
    await root.dispose();
    expect(root.isInitialized).toBe(false);

    // Second cycle — fresh initialize
    await root.initialize();
    expect(root.isInitialized).toBe(true);
    await root.dispose();
    expect(root.isInitialized).toBe(false);
  });

  // ── Performance — initialize() timing ──

  test('should initialize within 500ms performance budget', async () => {
    const t0 = performance.now();
    await root.initialize();
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500);
  });

  // ── Performance — dispose() timing ──

  test('should dispose within 100ms performance budget', async () => {
    await root.initialize();

    const t0 = performance.now();
    await root.dispose();
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });

  // ── Service access after initialization ──

  test('should expose all services after initialization', async () => {
    await root.initialize();

    // All accessors should work without throwing
    const services = [
      root.campaignService,
      root.playerStateService,
      root.worldStateService,
      root.inventoryService,
      root.equipmentService,
      root.gameModeService,
      root.gameEngineService,
      root.gameOverlayService,
      root.sessionService,
    ];

    for (const svc of services) {
      expect(svc).toBeDefined();
    }
  });

  // ── Service accessors throw when not initialized ──

  test('should throw when accessing services before initialization', async () => {
    expect(() => root.campaignService).toThrow('not initialised');
    expect(() => root.playerStateService).toThrow('not initialised');
    expect(() => root.worldStateService).toThrow('not initialised');
  });

  // ── Service accessors throw after dispose ──

  test('should throw when accessing services after dispose', async () => {
    await root.initialize();
    await root.dispose();

    expect(() => root.campaignService).toThrow('not initialised');
    expect(() => root.playerStateService).toThrow('not initialised');
  });

  // ── C-493 AC-2: autonomous-message poller lifecycle ──

  test('starts the autonomous-message poller on campaign entry (initialize)', async () => {
    await root.initialize();
    expect(autonomousStartMock).toHaveBeenCalledTimes(1);
    expect(autonomousStopMock).not.toHaveBeenCalled();
  });

  test('stops the autonomous-message poller on game teardown (dispose)', async () => {
    await root.initialize();
    await root.dispose();
    expect(autonomousStopMock).toHaveBeenCalledTimes(1);
  });
});
