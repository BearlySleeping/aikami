// apps/frontend/client/src/lib/services/game/bridge_listeners.test.ts
//
// Unit tests for setupBridgeListeners (C-314 AC-5).
// Verifies that bridge listeners register on the EngineBridge,
// call the correct service methods, and accept services via parameters.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived mock is provided by test_setup.ts
const prefetchForNpcs = mock((_npcIds: readonly string[]) => {});

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
  let mockPartyFollowService: Record<string, unknown>;
  let mockContextualTriggerService: { fireTrigger: ReturnType<typeof mock> };
  let mockBridge: Record<string, unknown>;
  let bridgeListeners: Map<string, (...args: unknown[]) => void>;
  let setBridgeCalled: boolean;

  beforeEach(async () => {
    bridgeListeners = new Map();
    setBridgeCalled = false;
    prefetchForNpcs.mockClear();

    mockBridge = {
      on: mock((event: string, handler: (...args: unknown[]) => void) => {
        bridgeListeners.set(event, handler);
      }),
      emit: mock((_event: unknown) => {}),
    };

    mockGameOverlayService = {
      setBridge: mock((_bridge: unknown) => {
        setBridgeCalled = true;
      }),
      activeOverlay: 'NONE',
      setActive: mock((type: string) => {
        // Mirror the production overlay stack: the pushed overlay becomes the
        // active one, which is what makes a duplicate terminal event a no-op.
        mockGameOverlayService.activeOverlay = type;
      }),
      clearActive: mock(() => {}),
      closeCombat: mock(() => {}),
      setCameraZoom: mock(() => {}),
      setInteractionPromptPosition: mock(() => {}),
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
      currentMapNpcIds: ['npc_on_loaded_map'],
    };

    mockCombatService = {
      startCombat: mock(() => {}),
      encounterId: 'emberwatch/proof_encounter',
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
      onEventPerformed: mock(() => {}),
    };

    mockPartyFollowService = {
      start: mock(() => {}),
      onMapLoaded: mock(() => {}),
    };

    // C-512 AC-2: the production caller for contextual generation.
    mockContextualTriggerService = { fireTrigger: mock(async () => undefined) };

    const engineMock = () => ({
      createEngineBridge: mock(() => mockBridge),
      loadContentPack: mock(async () => ({
        resolveMapUrl: mock((mapId: string) => `/content-packs/emberwatch/maps/${mapId}.json`),
        manifest: { maps: { inn: { defaultSpawnId: 'village_gate' } } },
      })),
      djb2Hash: mock(() => 12345),
    });
    mock.module('@aikami/frontend/engine', engineMock);
    mock.module('../npc/npc_memory_service.svelte.ts', () => ({
      npcMemoryService: { prefetchForNpcs, prefetchByName: mock(() => {}) },
    }));
    // Also mock by resolved path (Bun workspace symlinks)
    mock.module(
      '/home/sonny/Development/Projects/passion/aikami/packages/frontend/engine/src/index.ts',
      engineMock,
    );
    // Mock the registry resolver imported lazily inside ZONE_TRIGGERED handler
    mock.module('$lib/services/assets/registry_resolver', () => ({
      assetTagResolver: mock(() => 'resolved-tag'),
      createAssetTagResolver: mock(() => mock(() => 'resolved-tag')),
    }));

    const mod = await import('./bridge_listeners');
    setupBridgeListeners = mod.setupBridgeListeners;
  });

  // ── Structure ──

  test('MAP_LOADED prefetches NPCs reported by the loaded engine map', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
      partyFollowService: mockPartyFollowService as never,
    });

    bridgeListeners.get('MAP_LOADED')?.();

    expect(prefetchForNpcs).toHaveBeenCalledWith(['npc_on_loaded_map']);
  });

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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
    // C-342: persisted interactable states are forwarded (mock returns {}).
    expect(opts.interactableStates).toEqual({});
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
      partyFollowService: mockPartyFollowService as never,
    });

    const engineFailMock = () => ({
      createEngineBridge: mock(() => mockBridge),
      loadContentPack: mock(async () => {
        throw new Error('content pack unavailable');
      }),
      djb2Hash: mock(() => 12345),
    });
    mock.module('@aikami/frontend/engine', engineFailMock);
    mock.module(
      '/home/sonny/Development/Projects/passion/aikami/packages/frontend/engine/src/index.ts',
      engineFailMock,
    );

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
    // C-342: persisted interactable states are still forwarded on fallback.
    expect(opts.interactableStates).toEqual({});
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
      partyFollowService: mockPartyFollowService as never,
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
      partyFollowService: mockPartyFollowService as never,
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
      'INTERACTION_TARGET_POSITION_UPDATED',
    ];

    for (const event of expectedEvents) {
      expect(bridgeListeners.has(event)).toBe(true);
    }
  });

  test('position updates refresh only the retained interaction prompt coordinates', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
      partyFollowService: mockPartyFollowService as never,
    });

    bridgeListeners.get('INTERACTION_TARGET_POSITION_UPDATED')?.({
      targetScreenX: 120,
      targetScreenY: 80,
    });

    expect(mockGameOverlayService.setInteractionPromptPosition).toHaveBeenCalledWith({
      targetScreenX: 120,
      targetScreenY: 80,
    });
    expect(mockOnboardingHintService.onInteractionTargetChanged).not.toHaveBeenCalled();
  });

  // ── C-512: contextual generation caller ──

  test('NPC_INTERACTED fires the contextual trigger for the NPC (C-512 AC-2)', async () => {
    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
      partyFollowService: mockPartyFollowService as never,
      contextualTriggerService: mockContextualTriggerService as never,
    });

    const handler = bridgeListeners.get('NPC_INTERACTED');
    handler?.({
      npcId: 'merchant',
      npcName: 'Mara',
      dialog: 'Hello!',
      personaId: 'merchant',
    });

    expect(mockContextualTriggerService.fireTrigger).toHaveBeenCalledWith({
      event: 'npc_introduced',
      context: expect.stringContaining('Mara'),
      characterName: 'Mara',
      npcId: 'merchant',
    });
  });

  test('a contextual trigger failure never breaks the interaction (C-512 AC-2)', async () => {
    mockContextualTriggerService.fireTrigger = mock(async () => {
      throw new Error('engine died');
    });

    await setupBridgeListeners({
      gameOverlayService: mockGameOverlayService as never,
      npcDialogueService: mockNpcDialogueService as never,
      gameEngineService: mockGameEngineService as never,
      combatService: mockCombatService as never,
      timeService: mockTimeService as never,
      audioService: mockAudioService as never,
      inputActionService: mockInputActionService as never,
      onboardingHintService: mockOnboardingHintService as never,
      partyFollowService: mockPartyFollowService as never,
      contextualTriggerService: mockContextualTriggerService as never,
    });

    const handler = bridgeListeners.get('NPC_INTERACTED');
    expect(() =>
      handler?.({
        npcId: 'merchant',
        npcName: 'Mara',
        dialog: 'Hello!',
      }),
    ).not.toThrow();

    const startDialogue = mockNpcDialogueService.startDialogue as ReturnType<typeof mock>;
    expect(startDialogue).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Review F7/F9: exactly-once settlement consequences and run-scoped close
  // ---------------------------------------------------------------------------

  describe('review F7/F9: settlement consequences are exactly once', () => {
    /** Captures the delayed close callback so the test can fire it on demand. */
    const captureDelayedCallbacks = () => {
      const captured: Array<() => void> = [];
      const original = globalThis.setTimeout;

      globalThis.setTimeout = ((handler: () => void, _ms?: number) => {
        captured.push(handler);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;
      return {
        captured,
        restore: () => {
          globalThis.setTimeout = original;
        },
      };
    };

    const setup = async () => {
      const mod = await import('./combat_settlement_ledger.svelte');
      mod.combatSettlementLedger.reset();
      await setupBridgeListeners({
        gameOverlayService: mockGameOverlayService as never,
        npcDialogueService: mockNpcDialogueService as never,
        gameEngineService: mockGameEngineService as never,
        combatService: mockCombatService as never,
        timeService: mockTimeService as never,
        audioService: mockAudioService as never,
        inputActionService: mockInputActionService as never,
        onboardingHintService: mockOnboardingHintService as never,
        partyFollowService: mockPartyFollowService as never,
      });
    };

    const settlement = {
      settlementId: 'settlement:emberwatch/proof_encounter:run:proof:1:7:hostile_group_routed',
      result: 'victory' as const,
      reasonCode: 'hostile_group_routed' as const,
      objectiveResults: [],
    };

    test('a duplicate terminal delivery does not double-apply consequences', async () => {
      await setup();
      const emitMock = mockBridge.emit as ReturnType<typeof mock>;
      emitMock.mockClear();
      mockGameOverlayService.activeOverlay = 'COMBAT';

      const handler = bridgeListeners.get('COMBAT_ENDED');
      const terminal = {
        victory: true,
        settlement,
        encounterRunId: 'run:proof:1',
      };

      handler?.(terminal);
      handler?.(terminal);
      handler?.(terminal);

      // ENCOUNTER_COMPLETED (the quest-progression consequence) is emitted once.
      const completions = (emitMock.mock.calls as Array<[Record<string, unknown>]>).filter(
        ([event]) => event?.type === 'ENCOUNTER_COMPLETED',
      );
      expect(completions).toHaveLength(1);
    });

    test('a same-encounter RETRY re-earns its consequences', async () => {
      await setup();
      const emitMock = mockBridge.emit as ReturnType<typeof mock>;
      emitMock.mockClear();
      mockGameOverlayService.activeOverlay = 'COMBAT';

      const handler = bridgeListeners.get('COMBAT_ENDED');
      handler?.({ victory: true, settlement, encounterRunId: 'run:proof:1' });
      // Same authored encounter id and revision, NEW execution run.
      handler?.({
        victory: true,
        settlement: {
          ...settlement,
          settlementId: 'settlement:emberwatch/proof_encounter:run:proof:2:7:hostile_group_routed',
        },
        encounterRunId: 'run:proof:2',
      });

      const completions = (emitMock.mock.calls as Array<[Record<string, unknown>]>).filter(
        ([event]) => event?.type === 'ENCOUNTER_COMPLETED',
      );
      expect(completions).toHaveLength(2);
    });

    test("encounter A's delayed close does NOT close a replacement encounter", async () => {
      await setup();
      const clock = captureDelayedCallbacks();
      try {
        mockGameOverlayService.activeOverlay = 'COMBAT';
        const handler = bridgeListeners.get('COMBAT_ENDED');
        const started = bridgeListeners.get('COMBAT_STARTED');

        // Encounter A starts and settles.
        started?.({ encounterId: 'emberwatch/proof_encounter', encounterRunId: 'run:proof:1' });
        handler?.({ victory: true, settlement, encounterRunId: 'run:proof:1' });
        expect(clock.captured).toHaveLength(1);

        // Encounter B starts BEFORE A's delayed close fires.
        started?.({ encounterId: 'emberwatch/proof_encounter', encounterRunId: 'run:proof:2' });
        mockGameOverlayService.activeOverlay = 'COMBAT';
        (mockGameOverlayService.closeCombat as ReturnType<typeof mock>).mockClear();

        // A's callback fires.
        clock.captured[0]?.();

        // Encounter B's overlay is untouched.
        expect(mockGameOverlayService.closeCombat).not.toHaveBeenCalled();
      } finally {
        clock.restore();
      }
    });

    test('the delayed close DOES fire while its own encounter is still presented', async () => {
      await setup();
      const clock = captureDelayedCallbacks();
      try {
        mockGameOverlayService.activeOverlay = 'COMBAT';
        const handler = bridgeListeners.get('COMBAT_ENDED');
        const started = bridgeListeners.get('COMBAT_STARTED');

        started?.({ encounterId: 'emberwatch/proof_encounter', encounterRunId: 'run:proof:1' });
        handler?.({ victory: true, settlement, encounterRunId: 'run:proof:1' });
        expect(clock.captured).toHaveLength(1);

        clock.captured[0]?.();

        expect(mockGameOverlayService.closeCombat).toHaveBeenCalledTimes(1);
      } finally {
        clock.restore();
      }
    });
    test('a duplicate DEFEAT delivery presents game-over exactly once', async () => {
      await setup();
      const setActiveMock = mockGameOverlayService.setActive as ReturnType<typeof mock>;
      mockGameOverlayService.activeOverlay = 'COMBAT';

      const handler = bridgeListeners.get('COMBAT_ENDED');
      const defeat = { victory: false, encounterRunId: 'run:proof:1' };

      handler?.(defeat);
      handler?.(defeat);

      // The game-over surface is raised once. The second delivery finds the
      // overlay already owned by GAME_OVER, so the COMBAT guard refuses it — a
      // duplicate terminal event cannot stack a second defeat presentation (nor
      // the retry prompt that surface owns).
      const gameOver = (setActiveMock.mock.calls as Array<[string]>).filter(
        ([overlay]) => overlay === 'GAME_OVER',
      );
      expect(gameOver).toHaveLength(1);
    });

    test('a repeated presentation event for the same run does not re-apply consequences', async () => {
      await setup();
      const emitMock = mockBridge.emit as ReturnType<typeof mock>;
      emitMock.mockClear();
      mockGameOverlayService.activeOverlay = 'COMBAT';

      const started = bridgeListeners.get('COMBAT_STARTED');
      const ended = bridgeListeners.get('COMBAT_ENDED');

      // The engine re-presents the SAME execution run: a ViewModel that mounted
      // late answers COMBAT_SYNC_REQUEST, which re-emits COMBAT_STARTED.
      started?.({ encounterId: 'emberwatch/proof_encounter', encounterRunId: 'run:proof:1' });
      ended?.({ victory: true, settlement, encounterRunId: 'run:proof:1' });
      started?.({ encounterId: 'emberwatch/proof_encounter', encounterRunId: 'run:proof:1' });
      ended?.({ victory: true, settlement, encounterRunId: 'run:proof:1' });

      const completions = (emitMock.mock.calls as Array<[Record<string, unknown>]>).filter(
        ([event]) => event?.type === 'ENCOUNTER_COMPLETED',
      );
      expect(completions).toHaveLength(1);
    });

    test('the durable claim is recorded BEFORE the consequence is emitted', async () => {
      await setup();
      const mod = await import('./combat_settlement_ledger.svelte');
      const ledger = mod.combatSettlementLedger;
      mockGameOverlayService.activeOverlay = 'COMBAT';

      // Observe the ledger at the exact moment the quest consequence is emitted.
      const ledgerAtEmit: string[][] = [];
      (mockBridge.emit as ReturnType<typeof mock>).mockImplementation(
        (event: { type?: string }) => {
          if (event?.type === 'ENCOUNTER_COMPLETED') {
            ledgerAtEmit.push([...ledger.appliedSettlementIds]);
          }
        },
      );

      bridgeListeners.get('COMBAT_ENDED')?.({
        victory: true,
        settlement,
        encounterRunId: 'run:proof:1',
      });

      // The claim is already in the persisted ledger when the consequence runs,
      // and both live in the same synchronous turn. A save therefore captures
      // the consequence and its claim together, so the window between them is
      // not observable to persistence: no lost reward, no double reward.
      expect(ledgerAtEmit).toHaveLength(1);
      expect(ledgerAtEmit[0]).toContain(settlement.settlementId);
    });

    test('a terminal event re-presented after a reload applies nothing', async () => {
      await setup();
      const mod = await import('./combat_settlement_ledger.svelte');
      // The previous session applied the settlement and the save carried the
      // ledger with it (hydrateAllServices).
      mod.combatSettlementLedger.hydrate({ appliedSettlementIds: [settlement.settlementId] });

      const emitMock = mockBridge.emit as ReturnType<typeof mock>;
      emitMock.mockClear();
      mockGameOverlayService.activeOverlay = 'COMBAT';

      bridgeListeners.get('COMBAT_ENDED')?.({
        victory: true,
        settlement,
        encounterRunId: 'run:proof:1',
      });

      const completions = (emitMock.mock.calls as Array<[Record<string, unknown>]>).filter(
        ([event]) => event?.type === 'ENCOUNTER_COMPLETED',
      );
      expect(completions).toHaveLength(0);
    });
  });
});
