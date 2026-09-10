// apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.test.ts
//
// Unit tests for AddressModeTogggleViewModel — mode switching, labels, disabled
// party mode, and prompt assembly. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.
//
// Contract: C-235 GM Narrative Director

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createAddressModeTogggleViewModel } from './address_mode_toggle_view_model.svelte';
import { createAddressModePrompt } from './testing/address_mode_fixtures.ts';

const createViewModel = (
  options: {
    initialMode?: 'scene' | 'party' | 'gm';
    prompt?: ReturnType<typeof createAddressModePrompt>;
  } = {},
) =>
  createAddressModeTogggleViewModel({
    className: 'AddressModeTogggleViewModelTest',
    initialMode: options.initialMode,
    prompt: options.prompt ?? createAddressModePrompt({ assemblePrompt: () => 'prompt' }),
  });

describe('AddressModeTogggleViewModel — mode state', () => {
  test('defaults to scene mode', () => {
    const viewModel = createViewModel();

    expect(viewModel.currentMode).toBe('scene');
    expect(viewModel.modeLabel).toBe('Scene');
    expect(viewModel.modeColorClass).toBe('badge-success');
  });

  test('honours the initial mode', () => {
    const viewModel = createViewModel({ initialMode: 'gm' });

    expect(viewModel.currentMode).toBe('gm');
    expect(viewModel.modeLabel).toBe('GM');
    expect(viewModel.modeColorClass).toBe('badge-secondary');
  });

  test('setMode switches the mode and label', () => {
    const viewModel = createViewModel();

    viewModel.setMode('party');

    expect(viewModel.currentMode).toBe('party');
    expect(viewModel.modeLabel).toBe('Party');
    expect(viewModel.modeColorClass).toBe('badge-info');
  });

  test('setMode ignores party while party mode is disabled', () => {
    const viewModel = createViewModel();
    (viewModel as unknown as { _isPartyModeDisabled: boolean })._isPartyModeDisabled = true;

    viewModel.setMode('party');

    expect(viewModel.currentMode).toBe('scene');
  });
});

describe('AddressModeTogggleViewModel — prompt assembly', () => {
  test('assembles the prompt for the current mode', () => {
    const assemblePrompt = mock(({ mode }: { mode: string }) => `prompt:${mode}`);
    const viewModel = createViewModel({ prompt: createAddressModePrompt({ assemblePrompt }) });

    expect(viewModel.assembledPrompt).toBe('prompt:scene');

    viewModel.setMode('gm');
    expect(viewModel.assembledPrompt).toBe('prompt:gm');
    expect(assemblePrompt).toHaveBeenCalledWith({ mode: 'gm' });
  });
});

describe('AddressModeTogggleViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
