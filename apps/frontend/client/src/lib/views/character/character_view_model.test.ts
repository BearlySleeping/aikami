// apps/frontend/client/src/lib/views/character/character_view_model.test.ts
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

// C-081 extraction state
let extractionCalls: Array<{
  schema: Record<string, unknown>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
}> = [];
let extractionResult: object | undefined;
let extractionError: Error | undefined;

// ---------------------------------------------------------------------------
// Mock the FULL services barrel
// ---------------------------------------------------------------------------

const MOCK_SVC =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/index.ts';

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
  aiTextIntelligenceService: {
    extractStructure: mock(
      async (options: {
        schema: Record<string, unknown>;
        schemaName: string;
        prompt: string;
        systemPrompt?: string;
        signal?: AbortSignal;
        model?: string;
      }) => {
        extractionCalls.push({
          schema: options.schema,
          schemaName: options.schemaName,
          prompt: options.prompt,
          systemPrompt: options.systemPrompt,
        });
        if (extractionError) {
          throw extractionError;
        }
        return extractionResult;
      },
    ),
    cancelAll: mock(() => {}),
  },
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
    extractionCalls = [];
    extractionResult = undefined;
    extractionError = undefined;
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

      extractionResult = {
        name: 'Grik',
        background: 'A goblin rogue',
        appearance: { physicalDescription: 'green goblin', clothing: 'leather' },
        abilityScores: {
          strength: 8,
          dexterity: 16,
          constitution: 12,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
      };

      const promise = vm.generateCharacter();
      expect(vm.phase).toBe('GENERATING');

      await promise;
      expect(vm.phase).toBe('TWEAK');
    });

    test('should call extractStructure with compiled history', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('I am a goblin rogue');

      extractionResult = {
        name: 'Grik',
        background: 'goblin rogue',
        appearance: { physicalDescription: 'green', clothing: 'leather' },
        abilityScores: {
          strength: 8,
          dexterity: 16,
          constitution: 12,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
      };

      await vm.generateCharacter();

      expect(extractionCalls.length).toBe(1);
      expect(extractionCalls[0].prompt).toInclude('goblin');
    });

    test('should store returned persona', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Elf wizard');

      extractionResult = {
        name: 'Elandra',
        background: 'elven wizard',
        appearance: { physicalDescription: 'tall elf', clothing: 'robes' },
        abilityScores: {
          strength: 8,
          dexterity: 12,
          constitution: 10,
          intelligence: 18,
          wisdom: 14,
          charisma: 10,
        },
      };

      await vm.generateCharacter();

      expect(vm.persona?.name).toBe('Elandra');
      expect(vm.persona?.abilityScores?.intelligence).toBe(18);
    });

    test('should handle extraction returning undefined', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Test');

      extractionResult = undefined;

      await vm.generateCharacter();

      expect(vm.persona).toBeUndefined();
      expect(vm.phase).toBe('CHAT');
    });

    test('should handle extractStructure throwing', async () => {
      extractionError = new Error('AI unavailable');

      const vm = await loadVm();

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

      extractionResult = {
        name: 'Thorin',
        background: 'dwarf warrior',
        appearance: { physicalDescription: 'stout dwarf with red beard', clothing: 'plate armor' },
        abilityScores: {
          strength: 16,
          dexterity: 10,
          constitution: 16,
          intelligence: 10,
          wisdom: 12,
          charisma: 8,
        },
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toInclude('red beard');
    });

    test('should store generated avatarUrl', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Elf archer');

      extractionResult = {
        name: 'Legolas',
        background: 'elf archer',
        appearance: { physicalDescription: 'tall elf with golden hair', clothing: 'green cloak' },
        abilityScores: {
          strength: 10,
          dexterity: 18,
          constitution: 12,
          intelligence: 10,
          wisdom: 14,
          charisma: 10,
        },
      };
      imageResult = { url: 'https://example.com/legolas.png', isDemo: true };

      await vm.generateCharacter();
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.avatarUrl).toBe('https://example.com/legolas.png');
    });

    test('should fallback to name for image prompt', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('mysterious figure');

      extractionResult = {
        name: 'Shadow',
        background: 'mysterious figure',
        appearance: { physicalDescription: '', clothing: 'cloak' },
        abilityScores: {
          strength: 10,
          dexterity: 14,
          constitution: 10,
          intelligence: 13,
          wisdom: 15,
          charisma: 12,
        },
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toBe('Shadow');
    });

    test('should fallback to generic for image prompt', async () => {
      const vm = await loadVm();

      extractionResult = {
        name: '',
        background: '',
        appearance: { physicalDescription: '', clothing: '' },
        abilityScores: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
      };

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

      extractionResult = {
        name: 'Pippin',
        background: 'halfling bard',
        appearance: { physicalDescription: 'small halfling', clothing: 'colorful tunic' },
        abilityScores: {
          strength: 8,
          dexterity: 14,
          constitution: 12,
          intelligence: 10,
          wisdom: 10,
          charisma: 18,
        },
      };

      await vm.generateCharacter();

      expect(vm.phase).toBe('TWEAK');
      expect(vm.persona?.name).toBe('Pippin');
    });

    test('persona should be mutable via $state proxy', async () => {
      const vm = await loadVm();

      extractionResult = {
        name: 'Original',
        background: 'test',
        appearance: { physicalDescription: 'test', clothing: 'test' },
        abilityScores: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
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

  // ═══════════════════════════════════════════════════════════════════════
  // C-081: Character Creation Structural Extraction Pipeline
  // ═══════════════════════════════════════════════════════════════════════

  describe('C-081: Schema Compilation', () => {
    test('CharacterExtractionSchema should compile to valid JSON schema', async () => {
      const mod = await import('$lib/game/core/ai/prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;

      // TypeBox schemas are plain objects with a type property
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);

      // Properties should include name, background, appearance, abilityScores
      const properties = schema.properties as Record<string, unknown>;
      expect(properties).toBeDefined();
      expect(properties.name).toBeDefined();
      expect(properties.background).toBeDefined();
      expect(properties.appearance).toBeDefined();
      expect(properties.abilityScores).toBeDefined();
    });

    test('appearance sub-schema should enforce additionalProperties: false', async () => {
      const mod = await import('$lib/game/core/ai/prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      const appearance = properties.appearance as Record<string, unknown>;

      expect(appearance.additionalProperties).toBe(false);
      expect(appearance.type).toBe('object');

      const appearanceProps = appearance.properties as Record<string, unknown>;
      expect(appearanceProps.physicalDescription).toBeDefined();
      expect(appearanceProps.clothing).toBeDefined();
    });

    test('abilityScores sub-schema should enforce additionalProperties: false', async () => {
      const mod = await import('$lib/game/core/ai/prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      const scores = properties.abilityScores as Record<string, unknown>;

      expect(scores.additionalProperties).toBe(false);
      expect(scores.type).toBe('object');

      const scoreProps = scores.properties as Record<string, unknown>;
      const expectedStats = [
        'strength',
        'dexterity',
        'constitution',
        'intelligence',
        'wisdom',
        'charisma',
      ];
      for (const stat of expectedStats) {
        const statSchema = scoreProps[stat] as Record<string, unknown>;
        expect(statSchema).toBeDefined();
        expect(statSchema.type).toBe('integer');
        expect(statSchema.minimum).toBe(8);
        expect(statSchema.maximum).toBe(18);
      }
    });
  });

  describe('C-081: extractStructure Integration', () => {
    test('generateCharacter should transition CHAT → GENERATING → TWEAK via extractStructure', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('I am a goblin rogue');

      extractionResult = {
        name: 'Grik',
        background: 'A cunning goblin from the shadows',
        appearance: {
          physicalDescription: 'small green goblin with sharp teeth',
          clothing: 'dark leather armor',
        },
        abilityScores: {
          strength: 8,
          dexterity: 16,
          constitution: 12,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
      };

      const promise = vm.generateCharacter();
      expect(vm.phase).toBe('GENERATING');

      await promise;
      expect(vm.phase).toBe('TWEAK');
    });

    test('should call extractStructure with correct schema and compiled history', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Elf wizard with a love of fire magic');

      extractionResult = {
        name: 'Elandra',
        background: 'Elf wizard',
        appearance: { physicalDescription: 'tall elf', clothing: 'robes' },
        abilityScores: {
          strength: 8,
          dexterity: 12,
          constitution: 10,
          intelligence: 18,
          wisdom: 14,
          charisma: 10,
        },
      };

      await vm.generateCharacter();

      expect(extractionCalls.length).toBe(1);
      expect(extractionCalls[0].schemaName).toBe('CharacterExtraction');
      expect(extractionCalls[0].schema).toBeDefined();
      expect(extractionCalls[0].prompt).toInclude('wizard');
      expect(extractionCalls[0].systemPrompt).toBeDefined();
    });

    test('should store extracted persona in characterCreationService', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Dwarf warrior');

      extractionResult = {
        name: 'Thorin',
        background: 'Mountain dwarf warrior',
        appearance: { physicalDescription: 'stout dwarf with red beard', clothing: 'plate armor' },
        abilityScores: {
          strength: 16,
          dexterity: 10,
          constitution: 16,
          intelligence: 10,
          wisdom: 12,
          charisma: 8,
        },
      };

      await vm.generateCharacter();

      expect(vm.persona?.name).toBe('Thorin');
      expect(vm.persona?.background).toBe('Mountain dwarf warrior');
      expect(vm.persona?.appearance?.physicalDescription).toBe('stout dwarf with red beard');
      expect(vm.persona?.abilityScores?.strength).toBe(16);
      expect(vm.persona?.abilityScores?.charisma).toBe(8);
    });

    test('should start avatar generation with physicalDescription', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Halfling bard');

      extractionResult = {
        name: 'Pippin',
        background: 'Cheerful halfling bard',
        appearance: {
          physicalDescription: 'small halfling with curly hair and a lute',
          clothing: 'colorful tunic',
        },
        abilityScores: {
          strength: 8,
          dexterity: 14,
          constitution: 12,
          intelligence: 10,
          wisdom: 10,
          charisma: 18,
        },
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toInclude('curly hair');
    });

    test('should fallback to name for avatar prompt when no physicalDescription', async () => {
      const vm = await loadVm();
      await vm.sendChatMessage('Mysterious figure');

      extractionResult = {
        name: 'Shadow',
        background: 'A mysterious figure',
        appearance: { physicalDescription: '', clothing: 'cloak' },
        abilityScores: {
          strength: 10,
          dexterity: 14,
          constitution: 10,
          intelligence: 13,
          wisdom: 15,
          charisma: 12,
        },
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toBe('Shadow');
    });

    test('should fallback to generic prompt when no name and no description', async () => {
      const vm = await loadVm();

      extractionResult = {
        name: '',
        background: '',
        appearance: { physicalDescription: '', clothing: '' },
        abilityScores: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
      };

      await vm.generateCharacter();

      expect(imageCalls.length).toBe(1);
      expect(imageCalls[0].prompt).toBe('fantasy character');
    });
  });

  describe('C-081: Error Handling & Fallback', () => {
    test('should fallback to CHAT when extractStructure throws', async () => {
      extractionError = new Error('LLM failed to return valid JSON');

      const vm = await loadVm();
      await vm.sendChatMessage('Test character');

      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });

    test('should fallback to CHAT when extractStructure returns falsy', async () => {
      extractionResult = undefined;

      const vm = await loadVm();
      await vm.sendChatMessage('Test character');

      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });

    test('should fallback to CHAT on abort error', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      extractionError = abortError;

      const vm = await loadVm();
      await vm.sendChatMessage('Test character');

      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Character generation was cancelled.');
    });
  });
});
