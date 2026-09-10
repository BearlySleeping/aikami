// apps/frontend/client/src/lib/views/gm/session_summary_panel_view_model.test.ts
//
// Unit tests for SessionSummaryPanelViewModel — generation progress, error
// surfacing, and dismissal. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.
//
// Contract: C-235 GM Narrative Director

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { SessionSummary } from '$types';
import {
  createSessionSummaryPanelViewModel,
  type SessionSummaryCapabilities,
} from './session_summary_panel_view_model.svelte';
import { createSessionSummaryCapabilities } from './testing/session_summary_fixtures.ts';

const makeSummary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'summary-1',
  createdAt: 1_700_000_000_000,
  playtimeMinutes: 30,
  synopsis: 'The party recovered the Ward Wand.',
  keyEvents: ['Recovered the Ward Wand'],
  npcInteractions: [{ npcName: 'Elder Thalia', context: 'Gave the quest' }],
  resumePoint: 'At the Emberwatch gate',
  ...overrides,
});

const createViewModel = (
  options: { summary?: SessionSummaryCapabilities; playtimeMinutes?: number } = {},
) =>
  createSessionSummaryPanelViewModel({
    className: 'SessionSummaryPanelViewModelTest',
    playtimeMinutes: options.playtimeMinutes,
    summary: options.summary ?? createSessionSummaryCapabilities(),
  });

describe('SessionSummaryPanelViewModel — endSession', () => {
  test('generates a summary and exposes it as ready', async () => {
    const summary = makeSummary();
    const generateSummary = mock(async () => summary);
    const viewModel = createViewModel({
      summary: createSessionSummaryCapabilities({ generateSummary }),
      playtimeMinutes: 45,
    });

    await viewModel.endSession();

    expect(generateSummary).toHaveBeenCalledWith(45);
    expect(viewModel.summary).toEqual(summary);
    expect(viewModel.isReady).toBe(true);
    expect(viewModel.isGenerating).toBe(false);
    expect(viewModel.summaryError).toBeNull();
  });

  test('sets isGenerating while the summary is pending', async () => {
    let resolveSummary: ((summary: SessionSummary) => void) | undefined;
    const generateSummary = (): Promise<SessionSummary> =>
      new Promise((resolve) => {
        resolveSummary = resolve;
      });
    const viewModel = createViewModel({
      summary: createSessionSummaryCapabilities({ generateSummary }),
    });

    const pending = viewModel.endSession();
    expect(viewModel.isGenerating).toBe(true);
    expect(viewModel.isReady).toBe(false);

    resolveSummary?.(makeSummary());
    await pending;
    expect(viewModel.isGenerating).toBe(false);
    expect(viewModel.isReady).toBe(true);
  });

  test('ignores a second endSession while one is in progress', async () => {
    const generateSummary = mock(
      () =>
        new Promise<SessionSummary>(() => {
          // Never resolves — keep the first call pending.
        }),
    );
    const viewModel = createViewModel({
      summary: createSessionSummaryCapabilities({ generateSummary }),
    });

    void viewModel.endSession();
    await viewModel.endSession();

    expect(generateSummary).toHaveBeenCalledTimes(1);
  });

  test('surfaces a generation failure and clears the flag', async () => {
    const viewModel = createViewModel({
      summary: createSessionSummaryCapabilities({
        generateSummary: async () => {
          throw new Error('LLM unavailable');
        },
      }),
    });

    await viewModel.endSession();

    expect(viewModel.summaryError).toBe('LLM unavailable');
    expect(viewModel.summary).toBeNull();
    expect(viewModel.isGenerating).toBe(false);
  });
});

describe('SessionSummaryPanelViewModel — dismissSummary', () => {
  test('clears the summary and delegates to the capability', async () => {
    const clearSummary = mock(() => {});
    const viewModel = createViewModel({
      summary: createSessionSummaryCapabilities({
        generateSummary: async () => makeSummary(),
        clearSummary,
      }),
    });
    await viewModel.endSession();

    viewModel.dismissSummary();

    expect(viewModel.summary).toBeNull();
    expect(viewModel.summaryError).toBeNull();
    expect(clearSummary).toHaveBeenCalledTimes(1);
  });
});

describe('SessionSummaryPanelViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
