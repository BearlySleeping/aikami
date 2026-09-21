// apps/frontend/client/src/browser_tests/session_summary.browser.test.ts
//
// Real-runes coverage for the migrated session-summary panel ViewModel. The Bun
// suite treats the runes as plain values; this lane runs the ViewModel in
// Chromium with the real Svelte compiler so the internal `$state` transitions
// (isGenerating → summary/isReady) are observed through the real runtime.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import type { SessionSummary } from '$types';
import { createSessionSummaryPanelViewModel } from '../lib/views/gm/session_summary_panel_view_model.svelte';
import { createSessionSummaryCapabilities } from '../lib/views/gm/testing/session_summary_fixtures.ts';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const summary: SessionSummary = {
  id: 'summary-1',
  createdAt: 1_700_000_000_000,
  playtimeMinutes: 30,
  synopsis: 'The party recovered the Ward Wand.',
  keyEvents: [],
  npcInteractions: [],
  resumePoint: 'At the Emberwatch gate',
};

describe('SessionSummaryPanelViewModel — real runes', () => {
  test('generation toggles isGenerating and exposes the summary', async () => {
    let resolveSummary: ((value: SessionSummary) => void) | undefined;
    const viewModel = createSessionSummaryPanelViewModel({
      className: 'SessionSummaryPanelViewModel',
      summary: createSessionSummaryCapabilities({
        generateSummary: () =>
          new Promise((resolve) => {
            resolveSummary = resolve;
          }),
        clearSummary: () => {},
      }),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isGenerating).toBe(false);
    expect(viewModel.isReady).toBe(false);

    const pending = viewModel.endSession();
    flushSync();
    expect(viewModel.isGenerating).toBe(true);
    expect(viewModel.isReady).toBe(false);

    resolveSummary?.(summary);
    await pending;
    flushSync();

    expect(viewModel.isGenerating).toBe(false);
    expect(viewModel.isReady).toBe(true);
    expect(viewModel.summary?.id).toBe('summary-1');
  });

  test('dismissSummary resets the exposed state', async () => {
    const viewModel = createSessionSummaryPanelViewModel({
      className: 'SessionSummaryPanelViewModel',
      summary: createSessionSummaryCapabilities({
        generateSummary: async () => summary,
        clearSummary: () => {},
      }),
    });
    disposables.push(() => viewModel.dispose());

    await viewModel.endSession();
    flushSync();
    expect(viewModel.summary).not.toBeNull();

    viewModel.dismissSummary();
    flushSync();

    expect(viewModel.summary).toBeNull();
    expect(viewModel.isReady).toBe(false);
  });
});
