// apps/frontend/client/src/lib/services/game/bridge_listeners.test.ts
//
// Unit tests for setupBridgeListeners (C-314 AC-5).
// Verifies that bridge listeners register on the EngineBridge,
// call the correct service methods, and accept services via parameters.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived mock is provided by test_preload.ts

describe('setupBridgeListeners (AC-5)', () => {
  let setupBridgeListeners: typeof import('./bridge_listeners').setupBridgeListeners;
  let mockGameOverlayService: Record<string, unknown>;
  let mockNpcDialogueService: Record<string, unknown>;
  let mockGameEngineService: Record<string, unknown>;
  let mockCombatService: Record<string, unknown>;
  let mockTimeService: Record<string, unknown>;
  let mockAudioService: Record<string, unknown>;
  let mockBridge: Record<string, unknown>;
  let bridgeListeners: Map<string, (...args: unknown[]) => void>;
  let setBridgeCalled: boolean;

  beforeEach(async () => {
    bridgeListeners = new Map();
    setBridgeCalled = false;

    mockBridge = {
      on: mock((event: string, handler: (...args: unknown[]) => void) => {
        bridgeListeners.set(event, handler);
      }),
    };

    mockGameOverlayService = {
      setBridge: mock((_bridge: unknown) => {
        setBridgeCalled = true;
      }),
      activeOverlay: 'NONE',
      setActive: mock(() => {}),
      clearActive: mock(() => {}),
      setCameraZoom: mock(() => {}),
      openVendor: mock(() => {}),
      setTransitioning: mock(() => {}),
      onMapLoaded: mock(() => {}),
      onInventoryCountChange: mock(() => {}),
      getDefeatedEnemies: mock(() => []),
      startCombat: mock(() => {}),
      endDialogue: mock(() => {}),
    };

    mockNpcDialogueService = {
      startDialogue: mock(() => {}),
      endDialogue: mock(() => {}),
    };

    mockGameEngineService = {
      pauseEngine: mock(() => {}),
      resumeEngine: mock(() => {}),
      loadMap: mock(async (_opts: unknown) => {}),
    };

    mockCombatService = {
      startCombat: mock(() => {}),
    };

    mockTimeService = {
      updateEnvironment: mock(() => {}),
    };

    mockAudioService = {
      stopAll: mock(() => {}),
      transitionToBgm: mock(async (_url: string) => {}),
      playSfx: mock(async (_url: string) => {}),
    };

    // Mock createEngineBridge to return our mock bridge
    mock.module('@aikami/frontend/engine', () => ({
      createEngineBridge: mock(() => mockBridge),
    }));

    const mod = await import('./bridge_listeners');
    setupBridgeListeners = mod.setupBridgeListeners;
  });

  // ── Structure ──

  test('should accept services as parameters', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    // Should not throw — verifying the params object shape
    expect(true).toBe(true);
  });

  test('should call setBridge on gameOverlayService', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    expect(setBridgeCalled).toBe(true);
  });

  // ── Dialogue Events ──

  test('NPC_INTERACTED should start dialogue when no active overlay', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    const handler = bridgeListeners.get('NPC_INTERACTED');
    expect(handler).toBeDefined();

    handler?.({
      npcId: 'npc-1',
      npcName: 'Smith',
      dialog: 'Hello!',
      personaId: 'persona-1',
    });

    const startDialogue = mockNpcDialogueService.startDialogue as ReturnType<typeof mock>;
    expect(startDialogue).toHaveBeenCalled();
  });

  test('NPC_INTERACTED should NOT start dialogue when overlay is active', async () => {
    mockGameOverlayService.activeOverlay = 'DIALOGUE';

    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    const handler = bridgeListeners.get('NPC_INTERACTED');
    handler?.({
      npcId: 'npc-1',
      npcName: 'Smith',
      dialog: 'Hello!',
    });

    const startDialogue = mockNpcDialogueService.startDialogue as ReturnType<typeof mock>;
    expect(startDialogue).not.toHaveBeenCalled();
  });

  // ── Environment Events ──

  test('ENVIRONMENT_UPDATED should call timeService.updateEnvironment', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    const handler = bridgeListeners.get('ENVIRONMENT_UPDATED');
    expect(handler).toBeDefined();

    handler?.({
      gameHour: 12,
      gameMinute: 30,
      windVelocity: 5,
      rainIntensity: 0,
    });

    const updateEnvironment = mockTimeService.updateEnvironment as ReturnType<typeof mock>;
    expect(updateEnvironment).toHaveBeenCalled();
  });

  // ── Combat Events ──

  test('COMBAT_STARTED should call combatService.startCombat', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    const handler = bridgeListeners.get('COMBAT_STARTED');
    expect(handler).toBeDefined();

    handler?.({
      enemyName: 'Goblin',
      enemyHp: 50,
      enemyMaxHp: 50,
      participantIds: [1, 2],
      firstTurnEntityId: 1,
    });

    const startCombat = mockCombatService.startCombat as ReturnType<typeof mock>;
    expect(startCombat).toHaveBeenCalled();
  });

  // ── All events registered ──

  test('should register all expected bridge events', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
    });

    const expectedEvents = [
      'NPC_INTERACTED',
      'NPC_DIALOG_END',
      'CAMERA_ZOOM_UPDATE',
      'VENDOR_INTERACTED',
      'ENVIRONMENT_UPDATED',
      'ZONE_TRIGGERED',
      'GAME_READY',
      'MAP_LOADED',
      'COMBAT_STARTED',
      'COMBAT_LOG',
      'INVENTORY_UPDATED',
      'COMBAT_ENDED',
    ];

    for (const event of expectedEvents) {
      expect(bridgeListeners.has(event)).toBe(true);
    }
  });
});
