// apps/frontend/client/src/lib/views/gm/gm_system_sandbox_view_model.test.ts
//
// Unit tests for GmSystemSandboxViewModel — child ViewModel wiring, prompt
// delegation, narrative-director controls, and simulation logging. All
// collaborators are injected capabilities.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { SceneDirection } from '$services/gm/gm_types';
import type { AddressMode, SessionSummary } from '$types';
import {
  type AddressModeTogggleViewModelOptions,
  createAddressModeTogggleViewModel,
} from './address_mode_toggle_view_model.svelte';
import {
  createGmSystemSandboxViewModel,
  type GmSystemSandboxDirectorCapabilities,
  type GmSystemSandboxPromptCapabilities,
  type GmSystemSandboxViewModelOptions,
} from './gm_system_sandbox_view_model.svelte';
import {
  createPushStoryButtonViewModel,
  type PushStoryButtonViewModelOptions,
} from './push_story_button_view_model.svelte';
import {
  createSessionSummaryPanelViewModel,
  type SessionSummaryPanelViewModelOptions,
} from './session_summary_panel_view_model.svelte';

const summary: SessionSummary = {
  id: 'summary-1',
  createdAt: Date.now(),
  playtimeMinutes: 45,
  synopsis: 'A test session.',
  keyEvents: [],
  npcInteractions: [],
  resumePoint: 'The campfire.',
};

const direction: SceneDirection = {
  id: 'dir-1',
  description: 'A storm rolls in.',
  playerGuidance: 'Seek shelter.',
  createdAt: Date.now(),
  acknowledged: false,
};

const createPrompt = (): GmSystemSandboxPromptCapabilities => ({
  assemblePrompt: mock(({ mode }: { mode: AddressMode }) => `prompt:${mode}`),
});

const createNarrative = (): GmSystemSandboxDirectorCapabilities => ({
  isRunning: false,
  sceneDirectionCount: 1,
  sceneDirections: [direction],
  start: mock(() => {}),
  stop: mock(() => {}),
});

const createAddressMode = (options: Omit<AddressModeTogggleViewModelOptions, 'prompt'>) =>
  createAddressModeTogggleViewModel({ ...options, prompt: { assemblePrompt: () => 'prompt' } });

const createPushStory = (options: Omit<PushStoryButtonViewModelOptions, 'narrative'>) =>
  createPushStoryButtonViewModel({ ...options, narrative: { pushStory: async () => {} } });

const createSessionSummary = (options: Omit<SessionSummaryPanelViewModelOptions, 'summary'>) =>
  createSessionSummaryPanelViewModel({
    ...options,
    summary: { generateSummary: async () => summary, clearSummary: () => {} },
  });

const createViewModel = (overrides: Partial<GmSystemSandboxViewModelOptions> = {}) =>
  createGmSystemSandboxViewModel({
    className: 'GmSystemSandboxViewModelTest',
    prompt: createPrompt(),
    narrative: createNarrative(),
    createAddressModeViewModel: createAddressMode,
    createPushStoryViewModel: createPushStory,
    createSessionSummaryViewModel: createSessionSummary,
    ...overrides,
  });

describe('GmSystemSandboxViewModel — wiring', () => {
  test('builds its child ViewModels through the injected factories', () => {
    const viewModel = createViewModel();

    expect(viewModel.addressModeViewModel.currentMode).toBe('scene');
    expect(viewModel.sessionSummaryViewModel.summary).toBeNull();
  });

  test('debugPrompt delegates to the prompt capability', () => {
    const viewModel = createViewModel();

    expect(viewModel.debugPrompt).toBe('prompt:scene');
  });

  test('recentDirections maps narrative directions with a Date', () => {
    const viewModel = createViewModel();

    expect(viewModel.sceneDirectionCount).toBe(1);
    expect(viewModel.recentDirections[0].id).toBe('dir-1');
    expect(viewModel.recentDirections[0].createdAt).toBeInstanceOf(Date);
  });
});

describe('GmSystemSandboxViewModel — controls', () => {
  test('startNarrativeDirector uses the 30s sandbox interval and logs', () => {
    const start = mock(() => {});
    const viewModel = createViewModel({
      narrative: { ...createNarrative(), start },
    });

    viewModel.startNarrativeDirector();

    expect(start).toHaveBeenCalledWith(30_000);
    expect(viewModel.logs.at(-1)).toContain('Narrative Director started');
  });

  test('stopNarrativeDirector delegates and logs', () => {
    const stop = mock(() => {});
    const viewModel = createViewModel({ narrative: { ...createNarrative(), stop } });

    viewModel.stopNarrativeDirector();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('generateSessionSummary drives the child panel and logs', async () => {
    const viewModel = createViewModel();

    await viewModel.generateSessionSummary();

    expect(viewModel.sessionSummaryViewModel.summary).toBe(summary);
    expect(viewModel.logs.at(-1)).toContain('Session summary generated');
  });

  test('clearLogs empties the simulation log', () => {
    const viewModel = createViewModel();
    viewModel.startNarrativeDirector();

    viewModel.clearLogs();

    expect(viewModel.logs).toEqual([]);
  });
});

describe('GmSystemSandboxViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
