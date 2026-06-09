// apps/frontend/pwa/src/lib/views/dev/character/character_view_model.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let personaCalls: Array<{ history: string }> = [];
let personaResult: object | undefined;
let imageCalls: Array<{ prompt: string }> = [];
let imageResult = { url: 'https://example.com/avatar.png', isDemo: true };
let streamOut = '';
let streaming = false;
let cancels = 0;
let mockPersona: object | undefined;
let mockAvatarUrl = '';

// ---------------------------------------------------------------------------
// Mock the FULL services barrel
// ---------------------------------------------------------------------------

const MOCK_SVC =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/pwa/src/lib/client/services/index.ts';

const defaultBarrelMock = () => ({
  characterCreationService: {
    get persona() {
      return mockPersona;
    },
    set persona(v: object | undefined) {
      mockPersona = v;
    },
    get avatarUrl() {
      return mockAvatarUrl;
    },
    set avatarUrl(v: string) {
      mockAvatarUrl = v;
    },
    get isStreaming() {
      return streaming;
    },
    sendMessage: mock(
      async (options: { text: string; messages: Array<{ role: string; content: string }> }) => {
        streaming = true;
        streamOut = '';
        await new Promise((resolve) => setTimeout(resolve, 5));
        streamOut = 'Greetings, brave adventurer! What kind of hero do you wish to become?';
        streaming = false;
        const updated = [
          ...options.messages,
          { role: 'user', content: options.text },
          { role: 'assistant', content: streamOut },
        ];
        return updated;
      },
    ),
    generatePersona: mock(async (options: { history: string }) => {
      personaCalls.push({ history: options.history });
      mockPersona = personaResult as object | undefined;
      return personaResult;
    }),
    startAvatarGeneration: mock((options: { prompt: string }) => {
      imageCalls.push({ prompt: options.prompt });
      // Simulate async avatar URL update
      setTimeout(() => {
        mockAvatarUrl = imageResult.url;
      }, 5);
    }),
    cancel: mock(() => {
      cancels++;
      streaming = false;
    }),
  },
  // Stub exports for all other services re-exported by the barrel
  authService: { currentUser: null },
  personaService: {},
  notificationService: {},
  chatService: {},
  characterService: {},
  preferenceService: {},
  appService: {},
  ttsService: {},
  streamOrchestratorService: {},
  onboardingService: {},
  diceService: {},
  gameStateService: {},
  npcService: {},
  userService: {},
  pixiTextureInjector: {},
  audioContextManager: {},
  audioQueuePlayer: {},
  storageService: {},
  analyticService: {},
  aiSettingsService: {
    textProvider: { endpoint: '', apiKey: '', model: '' },
    setTextProvider: mock(() => {}),
  },
  characterTextStreamService: {},
  __esModule: true,
});

mock.module(MOCK_SVC, defaultBarrelMock);

// ---------------------------------------------------------------------------
// ViewModel loader
// ---------------------------------------------------------------------------

type CharacterViewModelInterface =
  import('./character_view_model.svelte.ts').CharacterViewModelInterface;

async function loadVm(): Promise<CharacterViewModelInterface> {
  const mod = await import('./character_view_model.svelte.ts');
  return mod.getCharacterViewModel({ className: 'CharacterViewModel' });
}

// ---------------------------------------------------------------------------
// Tests: C-078 — Dev Character Creation Sandbox
// ---------------------------------------------------------------------------

describe('CharacterViewModel — C-078', () => {
  beforeEach(() => {
    personaCalls = [];
    personaResult = undefined;
    imageCalls = [];
    imageResult = { url: 'https://example.com/avatar.png', isDemo: true };
    streamOut = '';
    streaming = false;
    cancels = 0;
    mockPersona = undefined;
    mockAvatarUrl = '';
    mock.module(MOCK_SVC, defaultBarrelMock);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-1: Phase Initialization & sendChatMessage
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-1: Initialization', () => {
    test('initial phase should be CHAT', async () => {
      const vm = await loadVm();
      expect(vm.phase).toBe('CHAT');
    });

    test('initial messages should have system + greeting after init', async () => {
      const vm = await loadVm();
      await vm.initialize();
      expect(vm.messages.length).toBe(2);
      expect(vm.messages[0].role).toBe('system');
      expect(vm.messages[1].role).toBe('assistant');
    });

    test('persona should be undefined initially', async () => {
      const vm = await loadVm();
      expect(vm.persona).toBeUndefined();
    });

    test('avatarUrl should be empty initially', async () => {
      const vm = await loadVm();
      expect(vm.avatarUrl).toBe('');
    });

    test('isStreaming should default to false', async () => {
      const vm = await loadVm();
      expect(vm.isStreaming).toBe(false);
    });
  });

  describe('AC-1: sendChatMessage', () => {
    test('should append user message to history', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('I am a goblin rogue');

      const userMsgs = vm.messages.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBe(1);
      expect(userMsgs[0].content).toBe('I am a goblin rogue');
    });

    test('should receive assistant response', async () => {
      const vm = await loadVm();
      await vm.initialize();
      await vm.sendChatMessage('Hello');

      const assistant = vm.messages.filter((m) => m.role === 'assistant');
      expect(assistant.length).toBe(2); // greeting + response
    });

    test('should not send empty message', async () => {
      const vm = await loadVm();
      await vm.initialize();
      await vm.sendChatMessage('   ');

      expect(vm.messages.length).toBe(2); // just system + greeting
    });

    test('should remain in CHAT after message exchange', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Hi');

      expect(vm.phase).toBe('CHAT');
    });

    test('should accumulate multiple messages', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('First');
      await vm.sendChatMessage('Second');

      const userMsgs = vm.messages.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-2: generateCharacter
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-2: generateCharacter', () => {
    test('should transition CHAT → GENERATING → TWEAK', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('I am a goblin rogue');

      personaResult = { id: 'p-1', name: 'Grik', level: 1 };

      const promise = vm.generateCharacter();
      expect(vm.phase).toBe('GENERATING');

      await promise;
      expect(vm.phase).toBe('TWEAK');
    });

    test('should call generatePersona with compiled history', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('I am a goblin rogue');

      personaResult = {
        id: 'p-1',
        name: 'Grik',
        abilityScores: { strength: 8, dexterity: 16 },
        level: 1,
      };

      await vm.generateCharacter();

      expect(personaCalls.length).toBe(1);
      expect(personaCalls[0].history).toInclude('goblin');
    });

    test('should store returned persona', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Elf wizard');

      personaResult = {
        id: 'p-2',
        name: 'Elandra',
        abilityScores: { strength: 8, intelligence: 18 },
        level: 1,
      };

      await vm.generateCharacter();

      expect(vm.persona?.name).toBe('Elandra');
      expect(vm.persona?.abilityScores?.intelligence).toBe(18);
    });

    test('should handle generatePersona returning undefined', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Test');

      personaResult = undefined;

      await vm.generateCharacter();

      expect(vm.persona).toBeUndefined();
      expect(vm.phase).toBe('CHAT');
    });

    test('should handle generatePersona throwing', async () => {
      personaResult = undefined;

      mock.module(MOCK_SVC, () => ({
        ...defaultBarrelMock(),
        characterCreationService: {
          get persona() {
            return undefined;
          },
          get avatarUrl() {
            return '';
          },
          get isStreaming() {
            return false;
          },
          sendMessage: mock(async () => []),
          generatePersona: mock(() => Promise.reject(new Error('AI unavailable'))),
          startAvatarGeneration: mock(() => {}),
          cancel: mock(() => {}),
        },
      }));

      const mod = await import('./character_view_model.svelte.ts');
      const vm = mod.getCharacterViewModel({ className: 'CharacterViewModel' });

      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-3: Avatar Generation
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-3: Avatar Generation', () => {
    test('should call startAvatarGeneration with appearance description', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Dwarf with a big red beard');

      personaResult = {
        id: 'p-4',
        name: 'Thorin',
        appearance: { physicalDescription: 'stout dwarf with red beard' },
        level: 1,
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toInclude('red beard');
    });

    test('should store generated avatarUrl', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Elf archer');

      personaResult = {
        id: 'p-5',
        name: 'Legolas',
        appearance: { physicalDescription: 'tall elf with golden hair' },
        level: 1,
      };
      imageResult = { url: 'https://example.com/legolas.png', isDemo: true };

      await vm.generateCharacter();
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.avatarUrl).toBe('https://example.com/legolas.png');
    });

    test('should fallback to name for image prompt', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('mysterious figure');

      personaResult = { id: 'p-6', name: 'Shadow', level: 1 };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toBe('Shadow');
    });

    test('should fallback to generic for image prompt', async () => {
      const vm = await loadVm();

      personaResult = { id: 'p-7', level: 1 };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toBe('fantasy character');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: Tweak & Cancel
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-4: Tweak & Cancel', () => {
    test('should have populated persona in TWEAK', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Halfling bard');

      personaResult = {
        id: 'p-9',
        name: 'Pippin',
        abilityScores: { charisma: 18 },
        level: 1,
      };

      await vm.generateCharacter();

      expect(vm.phase).toBe('TWEAK');
      expect(vm.persona?.name).toBe('Pippin');
    });

    test('persona should be mutable via $state proxy', async () => {
      const vm = await loadVm();

      personaResult = {
        id: 'p-10',
        name: 'Original',
        abilityScores: { strength: 10 },
        level: 1,
      };

      await vm.generateCharacter();

      if (vm.persona) {
        vm.persona.name = 'Renamed';
        if (vm.persona.abilityScores) {
          vm.persona.abilityScores.strength = 12;
        }
      }

      expect(vm.persona?.name).toBe('Renamed');
      expect(vm.persona?.abilityScores?.strength).toBe(12);
    });

    test('cancel should reset to CHAT', async () => {
      const vm = await loadVm();
      (vm as Record<string, unknown>).phase = 'GENERATING';

      vm.cancel();

      expect(vm.phase).toBe('CHAT');
    });

    test('cancel should call characterCreationService.cancel', async () => {
      const vm = await loadVm();

      vm.cancel();

      expect(cancels).toBe(1);
    });
  });
});
