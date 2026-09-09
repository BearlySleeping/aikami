// apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.test.ts
//
// Unit tests for AddressModeTogggleViewModel party-mode enablement (C-493).
// The GM `party` toggle must be genuinely functional — not un-disabled only —
// so selecting `party` transitions state and assembles a party-scoped prompt.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AddressModeTogggleViewModelInterface } from './address_mode_toggle_view_model.svelte';

const assemblePromptMock = mock(() => '');

mock.module('$services', () => ({
  gmPromptService: {
    assemblePrompt: assemblePromptMock,
  },
}));

let getAddressModeTogggleViewModel: (
  options: Parameters<typeof import('./address_mode_toggle_view_model.svelte').getAddressModeTogggleViewModel>[0],
) => AddressModeTogggleViewModelInterface;

beforeEach(async () => {
  assemblePromptMock.mockClear();
  const mod = await import('./address_mode_toggle_view_model.svelte');
  getAddressModeTogggleViewModel = mod.getAddressModeTogggleViewModel;
});

describe('AddressModeTogggleViewModel — C-493 party-mode enablement', () => {
  test('party mode is not disabled', () => {
    const viewModel = getAddressModeTogggleViewModel({ className: 'AddressModeToggleViewModel' });
    expect(viewModel.isPartyModeDisabled).toBe(false);
  });

  test('selecting party mode transitions state and assembles a party prompt', () => {
    assemblePromptMock.mockReturnValue('party scoped prompt');
    const viewModel = getAddressModeTogggleViewModel({ className: 'AddressModeToggleViewModel' });

    viewModel.setMode('party');

    expect(viewModel.currentMode).toBe('party');
    expect(viewModel.modeLabel).toBe('Party');
    expect(viewModel.assembledPrompt).toBe('party scoped prompt');
    expect(assemblePromptMock).toHaveBeenCalledWith({ mode: 'party' });
  });

  test('initial mode defaults to scene', () => {
    const viewModel = getAddressModeTogggleViewModel({ className: 'AddressModeToggleViewModel' });
    expect(viewModel.currentMode).toBe('scene');
  });
});
