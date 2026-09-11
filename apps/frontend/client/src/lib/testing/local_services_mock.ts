// apps/frontend/client/src/lib/testing/local_services_mock.ts
//
// Legacy `$services` barrel stub, extracted from test_preload.ts.
//
// Kept only for tests that deliberately exercise a *composition* module
// (which imports the real `$services` barrel) and therefore need a broad
// barrel substitute. Prefer feature-owned fixtures with explicit capability
// injection for everything else.

// biome-ignore-all lint/style/useNamingConvention: mirrors PascalCase barrel class exports
import { mock } from 'bun:test';

// ── $services stub helper (legacy) ────────────────────────────────────────
// `localServicesMockBase()` remains for the two legacy tests that still build
// a partial barrel mock. The global `mock.module('$services', ...)` is gone:
// the client graph no longer imports the barrel at runtime.

const _createServiceStub = () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (!Reflect.has(_target, prop)) {
        // Auto-create mock functions for any missing method
        Reflect.set(
          _target,
          prop,
          mock(() => {}),
        );
      }
      return Reflect.get(_target, prop);
    },
    // Tests mutate these stubs with Object.defineProperty(...) to override
    // getters (e.g. campaignService.campaigns). Without these traps the
    // Proxy throws "Properties can only be defined on Objects".
    set(_target, prop, value) {
      Reflect.set(_target, prop, value);
      return true;
    },
    defineProperty(_target, prop, descriptor) {
      Reflect.defineProperty(_target, prop, descriptor);
      return true;
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(_target, prop);
    },
    ownKeys(_target) {
      return Reflect.ownKeys(_target);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as Record<string, unknown>;
};

/**
 * Creates a callable Proxy stub with a mutable `.fn` property.
 *
 * Bun's mock.module() freezes module exports, preventing tests from
 * reassigning exported mock functions. This wrapper makes the export
 * callable (via `apply` trap) while also supporting property mutation
 * through a writable `.fn` on the underlying target object.
 *
 * Tests can replace the implementation by mutating `stub.fn = newMock`
 * instead of trying to reassign an export on the frozen module namespace.
 */
const _createCallableStub = () => {
  const target = { fn: mock(() => {}) as (...args: unknown[]) => unknown };
  return new Proxy(
    mock(() => {}),
    {
      apply(_t, _thisArg, args) {
        return target.fn(...args);
      },
      get(_t, prop) {
        if (prop === 'fn') {
          return target.fn;
        }
        return Reflect.get(_t, prop);
      },
      set(_t, prop, value) {
        if (prop === 'fn') {
          target.fn = value as (...args: unknown[]) => unknown;
          return true;
        }
        return Reflect.set(_t, prop, value);
      },
    },
  );
};

/**
 * Comprehensive `$services` barrel stub — every barrel export gets a stub
 * so `mock.module()` never leaves a real, partially-loaded barrel to leak
 * into other test files. Exported so a test file that needs its own
 * per-test double for one service (e.g. `imageGenerationService`) can
 * spread this as the base and override just that key, instead of
 * replacing the whole barrel and reintroducing the leak this preload
 * exists to prevent.
 */
export const localServicesMockBase = () => ({
  localTaskPoolService: _createServiceStub(),
  textGenerationService: _createServiceStub(),
  TextGenerationService: class {},
  appService: _createServiceStub(),
  AppService: class {},
  assetPrefetchService: _createServiceStub(),
  audioContextManager: _createServiceStub(),
  AudioContextManager: class {},
  audioQueuePlayer: _createServiceStub(),
  audioService: _createServiceStub(),
  // C-489 AC-5: combat ViewModel imports these audio helpers from the barrel.
  getTracksByMood: mock(async () => []),
  resolveAudioTrackUrl: mock(async () => 'http://localhost/audio.mp3'),
  playSceneBgm: mock(() => {}),
  AudioService: class {},
  AudioQueuePlayer: class {},
  ttsService: _createServiceStub(),
  TtsService: class {},
  // C-467: local_ai_wizard_view_model.svelte.ts (wired into onboarding by
  // C-466) imports these from '$services' — see the doc comment above.
  sidecarService: _createServiceStub(),
  getTauriRuntimeInfo: _createCallableStub(),
  createTauriProbeExecutor: _createCallableStub(),
  voiceModelService: _createServiceStub(),
  VoiceModelService: class {},
  runtimeConfigService: _createServiceStub(),
  RuntimeConfigService: class {},
  getOllamaRuntimeEndpoints: _createCallableStub(),
  getOpenAiCompatRuntimeModelsUrl: _createCallableStub(),
  // P02: connection_verifier.ts is re-exported from '$services' and imported
  // by ai_settings_view_model.svelte.ts. verifyConnection resolves a real
  // ConnectionTestResult shape because callers read `.ok` off the awaited
  // value — a bare _createCallableStub() would hand them `undefined`.
  verifyConnection: mock(async () => ({ ok: true, latencyMs: 0 })),
  isLocalProvider: mock(() => false),
  hasVerificationStrategy: mock(() => false),
  authService: _createServiceStub(),
  AuthService: class {},
  // C-464: account_view_model.svelte.ts needs these two from '$services'.
  // A test file that needs a real base/header shape should spread this base
  // and override just these keys (see the doc comment on
  // localServicesMockBase) rather than replacing the whole barrel.
  hubApiBase: _createCallableStub(),
  hubAuthHeaders: _createCallableStub(),
  personaCreationService: _createServiceStub(),
  PersonaCreationService: class {},
  characterService: _createServiceStub(),
  CharacterService: class {},
  personaCreationTextStreamService: _createServiceStub(),
  PersonaCreationTextStreamService: class {},
  chatService: _createServiceStub(),
  chatStorage: _createServiceStub(),
  chatLinkStorage: _createServiceStub(),
  contextBuilder: _createServiceStub(),
  configService: _createServiceStub(),
  ConfigService: class {},
  lorebookStore: _createServiceStub(),
  diceService: _createServiceStub(),
  DiceService: class {},
  draftStore: _createServiceStub(),
  DraftStore: class {},
  MessageBranchStore: class {},
  ExpressionAssetResolver: class {},
  // dialogue_overlay_view_model.svelte.ts imports `expressionService` from
  // '$services'. Without it in the base barrel mock, the view model's
  // `import { expressionService } from '$services'` binds to the real
  // services barrel and fails module evaluation with "Export named
  // 'expressionService' not found". Provide a minimal functional double.
  expressionService: {
    detectExpression: mock(async () => ({
      expressionMap: {},
      detectionTier: 'keyword' as const,
    })),
    resolveLpcOverlays: mock(() => ({})),
    catalogEntries: [],
    getEntry: mock(() => undefined),
  },
  gameSaveService: _createServiceStub(),
  GameSaveService: class {},
  setPendingGameLoad: _createCallableStub(),
  // C-314: Split services
  // C-491: committed narrative event record service — controllable double so
  // tests can assert the exact `record()` calls from the dialogue/quest seams.
  narrativeEventService: Object.assign(_createServiceStub(), {
    events: [],
    record: _createCallableStub(),
    witnessedBy: _createCallableStub(),
    serialize: _createCallableStub(),
    hydrate: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  questStateService: Object.assign(_createServiceStub(), {
    quests: [],
    worldStateFlags: {},
    acceptQuest: _createCallableStub(),
    declineQuest: _createCallableStub(),
    canAcceptQuest: () => true,
    getOfferableQuests: () => [],
    discoverEvidenceAt: () => [],
    getDiscoverableEvidence: () => [],
    presentEvidence: _createCallableStub(),
    evaluateTriggers: _createCallableStub(),
    serialize: () => ({
      activeQuests: [],
      completedQuestIds: [],
      failedQuestIds: [],
      declinedQuestIds: [],
      worldStateFlags: {},
    }),
    hydrate: _createCallableStub(),
    configure: _createCallableStub(),
    reset: _createCallableStub(),
    startListening: _createCallableStub(),
  }),
  questOverlayService: (() => {
    const svc = Object.assign(_createServiceStub(), {
      visible: true,
      setVisible: (v: boolean) => {
        svc.visible = v;
      },
      toggleVisible: () => {
        svc.visible = !svc.visible;
      },
      reset: () => {
        svc.visible = true;
      },
    });
    return svc;
  })(),
  playerStateService: Object.assign(_createServiceStub(), {
    playerLevel: 1,
    playerXp: 0,
    playerXpToNext: 100,
    playerHp: 100,
    playerMaxHp: 100,
    playerBaseAttack: 5,
    playerBaseDefense: 12,
    characterSheetSummary: '',
    reset: _createCallableStub(),
    startListening: _createCallableStub(),
  }),
  // C-487: isolated player-state factory used by the character-sheet sandbox
  // and the dev dialogue page (never the shared singleton).
  createPlayerStateService: _createCallableStub(),
  worldStateService: Object.assign(_createServiceStub(), {
    currentWorld: undefined,
    currentLocation: undefined,
    worldVariables: {},
    isConnected: false,
    activeContexts: [],
    worldGenOutput: {
      worldName: 'The Realm',
      worldDescription: 'A world of adventure awaits.',
      npcs: [],
      locations: ['Town Square'],
      partyArcs: [],
      hudWidgets: [],
    },
    quests: [],
    defeatedEnemies: [],
    collectedPickups: [],
    lootGrantedEncounters: [],
    isPickupCollected: mock(() => false),
    recordCollectedPickup: _createCallableStub(),
    isLootGranted: mock(() => false),
    recordLootGranted: _createCallableStub(),
    reset: _createCallableStub(),
    startListening: _createCallableStub(),
  }),
  inventoryService: Object.assign(_createServiceStub(), {
    inventory: [],
    gold: 100,
    isOpen: false,
    feedbackMessage: undefined,
    addItem: mock(() => true),
    removeItem: mock(() => true),
    useConsumable: mock(() => 'ok'),
    addGold: _createCallableStub(),
    removeGold: _createCallableStub(),
    configureCatalog: _createCallableStub(),
    configureWorldIntegration: _createCallableStub(),
    configureCommandSender: _createCallableStub(),
    serialize: mock(() => ({ items: [], gold: 100 })),
    hydrate: _createCallableStub(),
    open: _createCallableStub(),
    close: _createCallableStub(),
    toggle: _createCallableStub(),
    startListening: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  equipmentService: Object.assign(_createServiceStub(), {
    slots: {},
    equippedItems: [],
    totalAttack: 5,
    totalDefense: 12,
    equipItem: mock(() => true),
    unequipItem: mock(() => true),
    getEquippedItemId: mock(() => undefined),
    buildLpcRecipes: mock(() => []),
    configureAppearanceContext: _createCallableStub(),
    configureCommandSender: _createCallableStub(),
    serialize: mock(() => ({ slots: {} })),
    hydrate: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  gameModeService: Object.assign(_createServiceStub(), {
    currentMode: 'EXPLORE',
    setMode: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  // C-489: consequence authority reads/writes relationship + faction state
  // through this barrel export. A controllable double so tests can assert the
  // exact applyDelta/adjustFactionStanding calls and simulate the kernel's
  // clamped after-state.
  relationshipService: Object.assign(_createServiceStub(), {
    getRelationship: mock(() => undefined),
    applyDelta: mock(() => ({ trustAfter: 0, affinityAfter: 0 })),
    adjustFactionStanding: mock(() => ({
      factionId: '',
      standing: 0,
      tier: 'neutral',
      lastChangedAt: '',
    })),
    getStanding: mock(() => undefined),
    getFacts: mock(() => []),
    serialize: mock(() => ({
      characterRelationships: {},
      factionStandings: {},
      rememberedPromises: [],
    })),
    hydrate: _createCallableStub(),
    reset: _createCallableStub(),
    configure: _createCallableStub(),
  }),

  // C-494: party roster + companion reaction services — real singletons are
  // imported directly by the dialogue service; these controllable doubles let
  // tests seed membership/approval and assert reaction state changes.
  partyRosterService: Object.assign(_createServiceStub(), {
    members: [],
    activeCount: 0,
    maxSize: 4,
    formation: 'line',
    isFull: false,
    recruit: _createCallableStub(),
    dismiss: mock(() => false),
    hasMember: mock(() => false),
    getMember: mock(() => undefined),
    adjustApproval: _createCallableStub(),
    getApproval: mock(() => 0),
    activatePersonalQuest: _createCallableStub(),
    deactivatePersonalQuest: _createCallableStub(),
    isEmpty: mock(() => true),
    serialize: mock(() => ({ members: [], maxSize: 4, formation: 'line' })),
    hydrate: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  companionReactionService: Object.assign(_createServiceStub(), {
    evaluateEvent: _createCallableStub(),
    fireUnpromptedTurn: mock(() => false),
    hasFired: mock(() => false),
    reset: _createCallableStub(),
  }),

  buildGameStateFacts: mock(() => ['Gold: 100', 'Inventory: (empty)', 'Equipped: nothing']),
  imageGenerationService: _createServiceStub(),
  ImageGenerationService: class {},
  IMAGE_PROVIDERS: [
    { id: 'comfyui', label: 'ComfyUI (local)' },
    { id: 'openai-compat', label: 'OpenAI Compatible' },
  ] as const,
  PROVIDER_MODEL_FETCH: {},
  // C-465: ai_settings_view_model.svelte.ts needs this from '$services'.
  fetchModelsFromProvider: _createCallableStub(),
  // C-466: credential-policy wrapper for model-fetch requests.
  fetchWithCredentialPolicy: _createCallableStub(),
  // Model chat-test request resolution (provider_endpoints.ts).
  resolveChatTestRequest: _createCallableStub(),
  choiceHistoryStore: _createServiceStub(),
  getExpressionAssetResolver: _createCallableStub(),
  sceneToMusicTags: _createCallableStub(),
  styleProfileService: _createServiceStub(),
  vendorService: _createServiceStub(),
  worldGenSeedingService: _createServiceStub(),
  compileImagePrompt: _createCallableStub(),
  narrativeDirectorService: Object.assign(_createServiceStub(), {
    sceneDirections: [],
  }),
  buildVerifyHeaders: _createCallableStub(),
  buildVerifyUrl: _createCallableStub(),

  TEXT_PROVIDERS: [] as const,
  VOICE_PROVIDERS: [{ id: 'kokoro', label: 'Kokoro (local)' }] as const,
  PROVIDER_ENDPOINTS: {},
  npcService: _createServiceStub(),
  NpcService: class {},
  npcAwarenessService: Object.assign(_createServiceStub(), {
    nearbyNpcIds: [],
    getNearbyNpcContext: mock(async () => []),
    getNpcPersonality: mock(async () => 'Unknown'),
    getNpcName: mock(async () => 'Unknown'),
  }),
  onboardingService: _createServiceStub(),
  onboardingHintService: _createServiceStub(),
  personaService: _createServiceStub(),

  storageService: _createServiceStub(),
  StorageService: class {},
  routerService: _createServiceStub(),
  pixiTextureInjector: _createServiceStub(),
  idleDetectionService: Object.assign(_createServiceStub(), {
    isDnd: false,
    isIdle: mock(() => true),
  }),
  gameOverlayService: {
    openEndSession: mock(() => {}),
    closeEndSession: mock(() => {}),
    endSession: mock(async () => {}),
    startNewSession: mock(async () => {}),
  },
  GameOverlayService: class {},
  combatService: Object.assign(_createServiceStub(), {
    lastCombatOptions: undefined,
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  }),
  gameEngineService: _createServiceStub(),
  GameEngineService: class {},
  gameBootService: _createServiceStub(),
  sessionService: Object.assign(_createServiceStub(), {
    activeSession: null,
    chatLocked: false,
    sessions: [],
    latestSummary: null,
    showAutoSummaryToast: false,
    isEndingSession: false,
    isStartingSession: false,
    reset: mock(async () => {}),
  }),
  SessionService: class {},
  packRegistryService: Object.assign(_createServiceStub(), {
    availablePacks: [],
    refresh: mock(async () => {}),
    getPack: mock(() => undefined),
  }),
  PackRegistryService: class {},
  campaignService: Object.assign(_createServiceStub(), {
    activeCampaign: { id: 'default-emberwatch' },
  }),
  aiGatewayService: Object.assign(_createServiceStub(), {
    detect: mock(async (capability: string) => {
      let provider: string;
      if (capability === 'image') {
        provider = 'comfyui';
      } else if (capability === 'voice') {
        provider = 'kokoro';
      } else {
        provider = 'ollama';
      }
      return {
        capability,
        available: true,
        mode: 'offline',
        provider,
        detail: `${provider} reachable`,
        checkedAt: new Date().toISOString(),
      };
    }),
    resolveMode: mock((capability: string) => {
      if (capability === 'text') {
        return {
          capability: 'text',
          mode: 'offline',
          provider: 'ollama',
          model: 'llama3.2',
          endpoint: 'http://localhost:11434/v1',
        };
      }
      if (capability === 'image') {
        return {
          capability: 'image',
          mode: 'offline',
          provider: 'comfyui',
          model: undefined,
          endpoint: undefined,
        };
      }
      if (capability === 'voice') {
        return {
          capability: 'voice',
          mode: 'offline',
          provider: 'kokoro',
          model: undefined,
          endpoint: undefined,
        };
      }
      return {
        capability,
        mode: 'offline',
        provider: 'ollama',
        model: undefined,
        endpoint: undefined,
      };
    }),
  }),
  capabilityService: Object.assign(_createServiceStub(), {
    detect: mock(async () => ({
      isComplete: true,
      textStatus: 'detected',
      imageStatus: 'detected',
      voiceStatus: 'detected',
      summary: 'Mock detection',
    })),
    detectText: mock(async () => 'detected'),
    detectImage: mock(async () => 'detected'),
  }),
  gmPromptService: _createServiceStub(),
  memoryRetrievalService: Object.assign(_createServiceStub(), {
    query: mock(async () => []),
  }),
  messageBranchStore: _createServiceStub(),
  trackRegistryService: _createServiceStub(),
  timeService: { gameHour: 12, gameMinute: 0, windVelocity: 0, rainIntensity: 0 },
  SentenceBoundaryChunker: class {},
  // C-501: slash_command_parser re-exports from the services barrel. The
  // dialogue ViewModel imports these via a relative path, but the barrel
  // export must be mocked here so no test that imports them from '$services'
  // crashes (see guard-service-mock-coverage).
  parseSlashCommand: _createCallableStub(),
  getDialogueSlashCompletions: _createCallableStub(),
  SLASH_COMMAND_HELP:
    'Commands: /generate <prompt> — generate an image · /tree — show previous choices · /action <instruction> or /look — speak to the Game Master · /help — this help',
  __esModule: true,
});
