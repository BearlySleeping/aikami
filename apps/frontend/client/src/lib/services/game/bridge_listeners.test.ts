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
  let mockInputActionService: Record<string, unknown>;
  let mockOnboardingHintService: Record<string, unknown>;
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
      getCollectedPickups: mock(() => []),
      // C-342 map-load persistence: ZONE_TRIGGERED passes interactable states.
      getInteractableStates: mock(() => ({})),
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
      contentPackId: 'emberwatch',
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

    mockInputActionService = {
      actionDisplayLabel: mock((_actionId: string) => 'E'),
    };

    mockOnboardingHintService = {
      onInteractionTargetChanged: mock(() => {}),
    };

    // Mock createEngineBridge to return our mock bridge
    mock.module('@aikami/frontend/engine', () => ({
      createEngineBridge: mock(() => mockBridge),
      loadContentPack: mock(async () => ({
        resolveMapUrl: mock((mapId: string) => `/content-packs/emberwatch/maps/${mapId}.json`),
      })),
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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

  // ── Zone Transitions ──

  test('ZONE_TRIGGERED should resolve map ID via content pack before loadMap', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
    });

    const handler = bridgeListeners.get('ZONE_TRIGGERED');
    expect(handler).toBeDefined();

    handler?.({
      targetMap: 'inn',
      targetX: 32,
      targetY: 192,
    });

    // The ZONE_TRIGGERED handler resolves the map ID asynchronously —
    // flush the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const loadMap = mockGameEngineService.loadMap as ReturnType<typeof mock>;
    expect(loadMap).toHaveBeenCalled();
    const opts = loadMap.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.mapUrl).toBe('/content-packs/emberwatch/maps/inn.json');
    expect(opts.targetX).toBe(32);
    expect(opts.targetY).toBe(192);
  });

  test('ZONE_TRIGGERED falls back to the raw targetMap when content pack resolution fails', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
    });

    // Re-mock the engine module so loadContentPack rejects — the handler
    // imports it lazily when the ZONE_TRIGGERED event fires.
    mock.module('@aikami/frontend/engine', () => ({
      createEngineBridge: mock(() => mockBridge),
      loadContentPack: mock(async () => {
        throw new Error('content pack unavailable');
      }),
    }));

    const handler = bridgeListeners.get('ZONE_TRIGGERED');
    expect(handler).toBeDefined();

    handler?.({
      targetMap: 'inn',
      targetX: 32,
      targetY: 192,
    });

    // The handler resolves the map ID asynchronously — flush the microtask
    // queue before asserting the fallback path.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const loadMap = mockGameEngineService.loadMap as ReturnType<typeof mock>;
    expect(loadMap).toHaveBeenCalled();
    const opts = loadMap.mock.calls[0]?.[0] as Record<string, unknown>;
    // The original targetMap is preserved (no content pack resolution).
    expect(opts.mapUrl).toBe('inn');
    expect(opts.targetX).toBe(32);
    expect(opts.targetY).toBe(192);
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
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
      'COMBAT_ENDED',
      'INTERACTION_TARGET_CHANGED',
    ];

    for (const event of expectedEvents) {
      expect(bridgeListeners.has(event)).toBe(true);
    }
  });
});
