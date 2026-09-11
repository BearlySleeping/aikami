// apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.test.ts
//
// Unit tests for PersonaListViewModel card import (C-419 AC-1).

// biome-ignore-all lint/style/useNamingConvention: SillyTavern card format uses snake_case fields
//
// Verifies handleFileImport parses a SillyTavern V2 card and upserts a
// persona compiled into PersonaSheetSchema fields with inferred ability
// scores, without requiring a network call. Capabilities are injected
// directly — no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import {
  compileCardToPersona,
  hasDeclaredAbilityScores,
} from '$lib/services/character/card_compiler.ts';
import { importFromJson, importFromPng } from '$lib/services/character/character_importer.ts';
import { createPlaceholderPngCard } from '$lib/services/character/png_writer.ts';
import {
  createPersonaListViewModel,
  type PersonaListViewModelOptions,
} from './persona_list_view_model.svelte';

// ── Fixture ──────────────────────────────────────────────────────────────

const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Lyra Sunweaver',
    description: 'A wandering elven bard with a silver tongue.',
    personality: 'Witty, curious, fiercely loyal to her companions.',
    scenario: 'The party meets Lyra at a crossroads inn.',
    first_mes: 'Well met, travelers! Care to hear a tune?',
    mes_example: '<START>\n{{user}}: Hello\n{{char}}: A smile!',
    creator_notes: 'Test fixture card.',
    system_prompt: 'You are Lyra, an elven bard.',
    post_history_instructions: '',
    alternate_greetings: ['Greetings!'],
    tags: ['bard', 'elf', 'female'],
    creator: 'aikami-tests',
    character_version: '1.0',
    extensions: {},
  },
} as const;

const createFileInputEvent = (file: File): Event => {
  // Bun has no DOM — build the input-shaped object directly.
  const input = { files: [file], value: 'fake-path' } as unknown as HTMLInputElement;
  return { target: input } as unknown as Event;
};

type PersonaCapabilities = PersonaListViewModelOptions['personas'];

const createOptions = (personas: PersonaCapabilities): PersonaListViewModelOptions => ({
  className: 'PersonaListViewModelTest',
  personas,
  auth: { initialize: async () => undefined, uid: 'test-uid' },
  storage: { uploadAvatar: async () => 'https://example.com/avatar.png' },
  campaign: {
    startNewCampaign: async () => {
      throw new Error('unused in this test');
    },
    completeSetup: () => {},
  },
  router: { goToRoute: async () => {}, navigateToApp: async () => {} },
  gameState: { resetAll: () => {} },
  cards: { compileCardToPersona, hasDeclaredAbilityScores, importFromJson, importFromPng },
  lorebook: {
    addLorebook: () => 'lorebook-id',
    addEntry: () => 'entry-id',
    deleteLorebook: () => {},
  },
});

describe('PersonaListViewModel — card import (C-419 AC-1)', () => {
  test('imports a V2 PNG card as a persona with inferred ability scores', async () => {
    const updatePersona = mock(async () => {});
    const getPersonas = mock(async () => []);
    const viewModel = createPersonaListViewModel(
      createOptions({ updatePersona, getPersonas, setActivePersona: async () => {} }),
    );
    await viewModel.initialize();

    const base64 = btoa(JSON.stringify(V2_CARD));
    const blob = createPlaceholderPngCard({ keyword: 'chara', text: base64 });
    const file = new File([blob], 'lyra.png', { type: 'image/png' });
    await viewModel.handleFileImport({ event: createFileInputEvent(file) });

    expect(updatePersona).toHaveBeenCalled();
    const [personaId, data] = updatePersona.mock.calls[0];
    expect(personaId).toBeTypeOf('string');
    // name → name
    expect(data.name).toBe('Lyra Sunweaver');
    // description → background
    expect(data.background).toBe('A wandering elven bard with a silver tongue.');
    // personality → personalityTraits
    expect(data.personalityTraits).toBe('Witty, curious, fiercely loyal to her companions.');
    // scenario → notes
    expect(data.notes).toBe('The party meets Lyra at a crossroads inn.');
    // ability scores populated (inferred — card declares none)
    expect(data.abilityScores).toBeDefined();
    expect(data.abilityScores.strength).toBeGreaterThanOrEqual(8);
    // avatar uploaded via storage
    expect(data.avatarUrl).toBe('https://example.com/avatar.png');
    expect(viewModel.isImporting).toBe(false);
  });

  test('rejects an unsupported file type cleanly', async () => {
    const updatePersona = mock(async () => {});
    const viewModel = createPersonaListViewModel(
      createOptions({
        updatePersona,
        getPersonas: async () => [],
        setActivePersona: async () => {},
      }),
    );
    await viewModel.initialize();

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await viewModel.handleFileImport({ event: createFileInputEvent(file) });

    expect(updatePersona).not.toHaveBeenCalled();
    expect(viewModel.errorMessage).toBeTruthy();
    expect(viewModel.isImporting).toBe(false);
  });
});
