// apps/frontend/client/src/browser_tests/app_dialogs.browser.test.ts
//
// Real-runes coverage for the migrated app-dialogs ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler so the `$effect` that converts a snackbar into a toast actually runs.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createAppDialogsViewModel } from '../lib/views/app/dialogs/app_dialogs_view_model.svelte';
import { createAppDialogsProgress } from '../lib/views/app/dialogs/testing/app_dialogs_fixtures.ts';
import { createReactiveAppDialogsHarness } from '../lib/views/app/dialogs/testing/app_dialogs_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('AppDialogsViewModel — real runes', () => {
  test('converts a reactive snackbar into a toast and hides it', async () => {
    const harness = createReactiveAppDialogsHarness();
    const viewModel = createAppDialogsViewModel({
      className: 'AppDialogsViewModel',
      dialog: harness.dialog,
      progress: createAppDialogsProgress(),
    });
    disposables.push(() => viewModel.dispose());

    await viewModel.initialize();
    flushSync();
    expect(viewModel.toasts).toHaveLength(0);

    harness.setSnackbar({ text: 'Saved!', type: 'success' });
    flushSync();

    expect(viewModel.toasts).toHaveLength(1);
    expect(viewModel.toasts[0].text).toBe('Saved!');
    expect(viewModel.toasts[0].type).toBe('success');
    // The effect consumes the snackbar so it is not shown twice.
    expect(harness.dialog.snackbar).toBeUndefined();
  });

  test('current dialog reacts to the capability', () => {
    const harness = createReactiveAppDialogsHarness();
    const viewModel = createAppDialogsViewModel({
      className: 'AppDialogsViewModel',
      dialog: harness.dialog,
      progress: createAppDialogsProgress(),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.currentDialog).toBeUndefined();

    harness.setDialog({ type: 'confirm', props: { message: 'Are you sure?' } });
    flushSync();

    expect(viewModel.currentDialog?.type).toBe('confirm');
  });
});
