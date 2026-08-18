// apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.test.ts
//
// Unit tests for PersonaListViewModel card import (C-419 AC-1).

// biome-ignore-all lint/style/useNamingConvention: SillyTavern card format uses snake_case fields
//
// Verifies handleFileImport parses a SillyTavern V2 card and upserts a
// persona compiled into PersonaSheetSchema fields with inferred ability
// scores, without requiring a network call.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createPlaceholderPngCard } from '$lib/services/character/png_writer.ts';

// $state/$derived/$effect and the $services barrel are polyfilled by
// test_preload.ts. Re-mock the barrel with focused stubs so the VM and
// tests share the same instances.
mock.module('$services', () => ({
  personaService: {
    updatePersona: mock(async () => {}),
    getPersonas: mock(async () => []),
    setActivePersona: mock(async () => {}),
  },
  authService: { uid: 'test-uid', currentUser: { id: 'test-uid' } },
  storageService: {
    uploadAvatar: mock(async () => 'https://example.com/avatar.png'),
  },
  campaignService: { startNewCampaign: mock(async () => {}), completeSetup: mock(() => {}) },
  equipmentService: { reset: mock(() => {}) },
  inventoryService: { reset: mock(() => {}) },
  gameModeService: { reset: mock(() => {}) },
  playerStateService: { reset: mock(() => {}) },
  worldStateService: { reset: mock(() => {}) },
  routerService: {
    goToRoute: mock(async () => {}),
    navigateToApp: mock(async () => {}),
  },
}));

import { getPersonaListViewModel } from './persona_list_view_model.svelte';

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

describe('PersonaListViewModel — card import (C-419 AC-1)', () => {
  let viewModel: ReturnType<typeof getPersonaListViewModel>;
  let updatePersonaMock: ReturnType<typeof mock>;

  beforeEach(async () => {
    const { personaService } = await import('$services');
    updatePersonaMock = personaService.updatePersona;
    updatePersonaMock.mockClear();
    viewModel = getPersonaListViewModel({ className: 'PersonaListViewModelTest' });
    await viewModel.initialize();
  });

  test('imports a V2 PNG card as a persona with inferred ability scores', async () => {
    const base64 = btoa(JSON.stringify(V2_CARD));
    const blob = createPlaceholderPngCard({ keyword: 'chara', text: base64 });
    const file = new File([blob], 'lyra.png', { type: 'image/png' });
    await viewModel.handleFileImport({ event: createFileInputEvent(file) });

    expect(updatePersonaMock).toHaveBeenCalled();
    const [personaId, data] = updatePersonaMock.mock.calls[0];
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
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await viewModel.handleFileImport({ event: createFileInputEvent(file) });
    expect(updatePersonaMock).not.toHaveBeenCalled();
    expect(viewModel.errorMessage).toBeTruthy();
    expect(viewModel.isImporting).toBe(false);
  });
});
