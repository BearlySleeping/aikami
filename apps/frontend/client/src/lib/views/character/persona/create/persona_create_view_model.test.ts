// apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.test.ts
//
// Persona-create ViewModel tests.
//
// This suite exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no shared test inventory
// inventory. Each test constructs exactly the capabilities it needs via
// ./testing/persona_create_fixtures.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PersonaData } from '@aikami/types';
import {
  createPersonaCreateViewModel,
  type PersonaCreateViewModelInterface,
} from './persona_create_view_model.svelte.ts';
import {
  createPersonaCreateHarness,
  type PersonaCreateHarness,
} from './testing/persona_create_fixtures.ts';

const REAL_FETCH = globalThis.fetch;

let harness: PersonaCreateHarness;

const createVm = (): PersonaCreateViewModelInterface =>
  createPersonaCreateViewModel({
    className: 'PersonaCreateViewModel',
    ...harness.capabilities,
  });

const sampleExtraction = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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
  ...overrides,
});

const fullPersona = (): PersonaData => ({
  id: 'test-persona-id',
  name: 'Test Hero',
  background: '',
  abilityScores: {},
  appearance: {},
  hitPoints: 10,
  hitPointsMax: 10,
  temporaryHitPoints: 0,
  armorClass: 10,
  speed: 30,
  experiencePoints: 0,
  savingThrows: [],
  skills: [],
  proficiencies: [],
  languages: ['Common'],
  equipment: [],
  inventory: [],
  isActive: false,
});

describe('PersonaCreateViewModel', () => {
  beforeEach(() => {
    harness = createPersonaCreateHarness();
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  describe('AC-1: Initialization', () => {
    test('initial phase should be CHAT', () => {
      const vm = createVm();
      expect(vm.phase).toBe('CHAT');
    });

    test('initial messages should have system + greeting after init', async () => {
      const vm = createVm();
      await vm.initialize();
      expect(vm.messages.length).toBe(2);
      expect(vm.messages[0].role).toBe('system');
      expect(vm.messages[1].role).toBe('assistant');
    });

    test('persona should be undefined initially', () => {
      const vm = createVm();
      expect(vm.persona).toBeUndefined();
    });

    test('avatarUrl should be empty initially', () => {
      const vm = createVm();
      expect(vm.avatarUrl).toBe('');
    });

    test('isStreaming should default to false', () => {
      const vm = createVm();
      expect(vm.isStreaming).toBe(false);
    });

    test('isUploading should default to false', () => {
      const vm = createVm();
      expect(vm.isUploading).toBe(false);
    });
  });

  describe('AC-1: sendChatMessage', () => {
    test('should append user message to history', async () => {
      const vm = createVm();
      await vm.sendChatMessage('I am a goblin rogue');

      const userMsgs = vm.messages.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBe(1);
      expect(userMsgs[0].content).toBe('I am a goblin rogue');
    });

    test('should receive assistant response', async () => {
      const vm = createVm();
      await vm.initialize();
      await vm.sendChatMessage('Hello');

      const assistant = vm.messages.filter((m) => m.role === 'assistant');
      expect(assistant.length).toBe(2);
    });

    test('should not send empty message', async () => {
      const vm = createVm();
      await vm.initialize();
      await vm.sendChatMessage('   ');

      expect(vm.messages.length).toBe(2);
    });

    test('should remain in CHAT after message exchange', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Hi');

      expect(vm.phase).toBe('CHAT');
    });

    test('should accumulate multiple messages', async () => {
      const vm = createVm();
      await vm.sendChatMessage('First');
      await vm.sendChatMessage('Second');

      const userMsgs = vm.messages.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBe(2);
    });
  });

  describe('AC-2: generateCharacter', () => {
    test('should transition CHAT → GENERATING → TWEAK', async () => {
      const vm = createVm();
      await vm.sendChatMessage('I am a goblin rogue');
      harness.state.extractionResult = sampleExtraction();

      const promise = vm.generateCharacter();
      expect(vm.phase).toBe('GENERATING');

      await promise;
      expect(vm.phase).toBe('TWEAK');
    });

    test('should call extractStructure with compiled history', async () => {
      const vm = createVm();
      await vm.sendChatMessage('I am a goblin rogue');
      harness.state.extractionResult = sampleExtraction();

      await vm.generateCharacter();

      expect(harness.ops.extractionCalls.length).toBe(1);
      expect(harness.ops.extractionCalls[0].prompt).toInclude('goblin');
    });

    test('should store returned persona', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Elf wizard');
      harness.state.extractionResult = sampleExtraction({
        name: 'Elandra',
        abilityScores: { intelligence: 18 },
      });

      await vm.generateCharacter();

      expect(vm.persona?.name).toBe('Elandra');
      expect(vm.persona?.abilityScores?.intelligence).toBe(18);
    });

    test('should handle extraction returning undefined', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Test');
      harness.state.extractionResult = undefined;

      await vm.generateCharacter();

      expect(vm.persona).toBeUndefined();
      expect(vm.phase).toBe('CHAT');
    });

    test('should handle extractStructure throwing', async () => {
      harness.state.extractionError = new Error('AI unavailable');
      const vm = createVm();

      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });
  });

  describe('AC-3: Avatar Generation', () => {
    test('should call startAvatarGeneration with appearance description', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Dwarf with a big red beard');
      harness.state.extractionResult = sampleExtraction({
        name: 'Thorin',
        appearance: { physicalDescription: 'stout dwarf with red beard' },
      });

      await vm.generateCharacter();

      expect(harness.ops.startAvatarCalls.length).toBe(1);
      expect(harness.ops.startAvatarCalls[0].prompt).toInclude('red beard');
    });

    test('should expose the generated avatarUrl', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Elf archer');
      harness.state.extractionResult = sampleExtraction({ name: 'Legolas' });
      harness.state.avatarUrlResult = 'https://example.com/legolas.png';

      await vm.generateCharacter();
      await new Promise((r) => setTimeout(r, 0));

      expect(vm.avatarUrl).toBe('https://example.com/legolas.png');
    });

    test('should fallback to name for image prompt', async () => {
      const vm = createVm();
      await vm.sendChatMessage('mysterious figure');
      harness.state.extractionResult = sampleExtraction({
        name: 'Shadow',
        appearance: { physicalDescription: '' },
      });

      await vm.generateCharacter();

      expect(harness.ops.startAvatarCalls.length).toBe(1);
      expect(harness.ops.startAvatarCalls[0].prompt).toBe('Shadow');
    });

    test('should fallback to generic for image prompt', async () => {
      const vm = createVm();
      harness.state.extractionResult = sampleExtraction({
        name: '',
        appearance: { physicalDescription: '' },
      });

      await vm.generateCharacter();

      expect(harness.ops.startAvatarCalls.length).toBe(1);
      expect(harness.ops.startAvatarCalls[0].prompt).toBe('Unnamed Adventurer');
    });
  });

  describe('AC-4: Tweak & Cancel', () => {
    test('C-388: edit-mode regenerateAvatar delegates via initImage + denoise', async () => {
      harness.state.avatarUrl = 'https://example.com/current-avatar.png';
      const vm = createVm();
      vm.regenerationMode = 'edit';
      vm.editInstruction = 'add a scar';

      globalThis.fetch = async () =>
        new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 });

      await vm.regenerateAvatar();

      expect(harness.ops.imageGenCalls.length).toBe(1);
      const call = harness.ops.imageGenCalls[0];
      expect(call.prompt).toInclude('add a scar');
      expect(call.initImage).toBeDefined();
      expect(call.initImage).toStartWith('data:image/png');
      expect(call.denoise).toBe(0.5);
      expect(call.negativePrompt).toBe('deformed, different person, blurry, low quality');
    });

    test('C-388: edit-mode regenerateAvatar swallows a failed avatar fetch', async () => {
      harness.state.avatarUrl = 'https://example.com/current-avatar.png';
      const vm = createVm();
      vm.regenerationMode = 'edit';
      vm.editInstruction = 'add a scar';
      vm.isRegenerating = true;
      vm.showRegenerationPanel = true;

      globalThis.fetch = async () => new Response(null, { status: 404 });

      await vm.regenerateAvatar();

      expect(harness.ops.imageGenCalls.length).toBe(0);
      expect(vm.isRegenerating).toBe(false);
      expect(vm.showRegenerationPanel).toBe(false);
    });

    test('C-388: appearance-mode regenerateAvatar delegates without initImage', async () => {
      const vm = createVm();
      harness.state.persona = {
        ...fullPersona(),
        name: 'Thorin',
        appearance: { physicalDescription: 'stout dwarf with red beard' },
      };
      vm.regenerationMode = 'appearance';

      await vm.regenerateAvatar();

      expect(harness.ops.imageGenCalls.length).toBe(1);
      expect(harness.ops.imageGenCalls[0].initImage).toBeUndefined();
      expect(harness.ops.imageGenCalls[0].prompt).toInclude('red beard');
    });

    test('should have populated persona in TWEAK', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Halfling bard');
      harness.state.extractionResult = sampleExtraction({ name: 'Pippin' });

      await vm.generateCharacter();

      expect(vm.phase).toBe('TWEAK');
      expect(vm.persona?.name).toBe('Pippin');
    });

    test('persona should be mutable', async () => {
      const vm = createVm();
      harness.state.extractionResult = sampleExtraction({ name: 'Original' });

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
      const vm = createVm();
      vm.cancel();

      expect(vm.phase).toBe('CHAT');
    });

    test('cancel should call personaCreation.cancel', async () => {
      const vm = createVm();

      vm.cancel();

      expect(harness.ops.cancelCount).toBe(1);
    });
  });

  describe('C-081: Schema Compilation', () => {
    test('CharacterExtractionSchema should compile to valid JSON schema', async () => {
      const mod = await import('$lib/data/ai_prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;

      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);

      const properties = schema.properties as Record<string, unknown>;
      expect(properties).toBeDefined();
      expect(properties.name).toBeDefined();
      expect(properties.background).toBeDefined();
      expect(properties.appearance).toBeDefined();
      expect(properties.abilityScores).toBeDefined();
    });

    test('appearance sub-schema should enforce additionalProperties: false', async () => {
      const mod = await import('$lib/data/ai_prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      const appearance = properties.appearance as Record<string, unknown>;

      expect(appearance.additionalProperties).toBe(false);
      expect(appearance.type).toBe('object');

      const appearanceProps = appearance.properties as Record<string, unknown>;
      expect(appearanceProps.physicalDescription).toBeDefined();
      expect(appearanceProps.age).toBeDefined();
      expect(appearanceProps.skinColor).toBeDefined();
    });

    test('abilityScores sub-schema should expose the six abilities', async () => {
      const mod = await import('$lib/data/ai_prompts/character_extraction_schema.ts');
      const schema = mod.CharacterExtractionSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      const scores = properties.abilityScores as Record<string, unknown>;

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
      }
    });
  });

  describe('C-081: extractStructure Integration', () => {
    test('generateCharacter should transition CHAT → GENERATING → TWEAK via extractStructure', async () => {
      const vm = createVm();
      await vm.sendChatMessage('I am a goblin rogue');
      harness.state.extractionResult = sampleExtraction();

      const promise = vm.generateCharacter();
      expect(vm.phase).toBe('GENERATING');

      await promise;
      expect(vm.phase).toBe('TWEAK');
    });

    test('should call extractStructure with correct schema and compiled history', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Elf wizard with a love of fire magic');
      harness.state.extractionResult = sampleExtraction({ name: 'Elandra' });

      await vm.generateCharacter();

      expect(harness.ops.extractionCalls.length).toBe(1);
      expect(harness.ops.extractionCalls[0].schemaName).toBe('CharacterExtraction');
      expect(harness.ops.extractionCalls[0].schema).toBeDefined();
      expect(harness.ops.extractionCalls[0].prompt).toInclude('wizard');
      expect(harness.ops.extractionCalls[0].systemPrompt).toBeDefined();
    });

    test('should store extracted persona fields', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Dwarf warrior');
      harness.state.extractionResult = sampleExtraction({
        name: 'Thorin',
        background: 'Mountain dwarf warrior',
        appearance: { physicalDescription: 'stout dwarf with red beard' },
        abilityScores: { strength: 16, charisma: 8 },
      });

      await vm.generateCharacter();

      expect(vm.persona?.name).toBe('Thorin');
      expect(vm.persona?.background).toBe('Mountain dwarf warrior');
      expect(vm.persona?.appearance?.physicalDescription).toBe('stout dwarf with red beard');
      expect(vm.persona?.abilityScores?.strength).toBe(16);
      expect(vm.persona?.abilityScores?.charisma).toBe(8);
    });

    test('should start avatar generation with physicalDescription', async () => {
      const vm = createVm();
      await vm.sendChatMessage('Halfling bard');
      harness.state.extractionResult = sampleExtraction({
        name: 'Pippin',
        appearance: { physicalDescription: 'small halfling with curly hair and a lute' },
      });

      await vm.generateCharacter();

      expect(harness.ops.startAvatarCalls.length).toBe(1);
      expect(harness.ops.startAvatarCalls[0].prompt).toInclude('curly hair');
    });
  });

  describe('C-081: Error Handling & Fallback', () => {
    test('should fallback to CHAT when extractStructure throws', async () => {
      harness.state.extractionError = new Error('LLM failed to return valid JSON');

      const vm = createVm();
      await vm.sendChatMessage('Test character');
      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });

    test('should fallback to CHAT when extractStructure returns falsy', async () => {
      harness.state.extractionResult = undefined;

      const vm = createVm();
      await vm.sendChatMessage('Test character');
      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Failed to generate character. Please try again.');
    });

    test('should fallback to CHAT on abort error', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      harness.state.extractionError = abortError;

      const vm = createVm();
      await vm.sendChatMessage('Test character');
      await vm.generateCharacter();

      expect(vm.phase).toBe('CHAT');
      expect(vm.errorMessage).toBe('Persona generation was cancelled.');
    });
  });

  describe('uploadAvatar', () => {
    test('should call storage.uploadAvatar with file and uid', async () => {
      const vm = createVm();
      harness.state.uid = 'test-user-123';
      harness.state.uploadAvatarResult = 'https://storage.example.com/avatars/test.png';
      const file = new File(['test'], 'avatar.png', { type: 'image/png' });

      await vm.uploadAvatar(file);

      expect(harness.ops.uploadAvatarCalls.length).toBe(1);
      expect(harness.ops.uploadAvatarCalls[0].uid).toBe('test-user-123');
      expect(vm.avatarUrl).toBe('https://storage.example.com/avatars/test.png');
    });

    test('should not upload when isUploading is true', async () => {
      const vm = createVm();
      vm.isUploading = true;

      const file = new File(['test'], 'avatar.png', { type: 'image/png' });
      await vm.uploadAvatar(file);

      expect(harness.ops.uploadAvatarCalls.length).toBe(0);
    });
  });

  describe('C-152: enterWorld', () => {
    test('resets each domain capability before routing to /game', async () => {
      const vm = createVm();
      harness.state.persona = fullPersona();
      harness.state.avatarUrl = 'data:image/png;base64,test';
      harness.state.uid = 'user-1';

      const localStorageItems: Record<string, string> = {};
      const origGetItem = globalThis.localStorage?.getItem;
      const origSetItem = globalThis.localStorage?.setItem;
      globalThis.localStorage.getItem = (key: string) => localStorageItems[key] ?? null;
      globalThis.localStorage.setItem = (key: string, value: string) => {
        localStorageItems[key] = value;
      };

      try {
        await vm.enterWorld();

        expect(harness.ops.resets.player).toBe(1);
        expect(harness.ops.resets.inventory).toBe(1);
        expect(harness.ops.resets.equipment).toBe(1);
        expect(harness.ops.resets.world).toBe(1);
        expect(harness.ops.inventoryAddCalls.length).toBeGreaterThan(0);
        expect(harness.ops.equipmentCalls.length).toBeGreaterThan(0);
        expect(harness.ops.setActivePersonaCalls).toContain('test-persona-id');
        expect(harness.ops.routeCalls.some((c) => c.route === 'game')).toBe(true);
      } finally {
        if (origGetItem) {
          globalThis.localStorage.getItem = origGetItem;
        }
        if (origSetItem) {
          globalThis.localStorage.setItem = origSetItem;
        }
      }
    });
  });
});
