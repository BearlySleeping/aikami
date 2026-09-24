// apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_view_model.test.ts
//
// Unit tests for AppDialogsViewModel — dialog/loading reads, progress, and
// close delegation. Exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createAppDialogsViewModel } from './app_dialogs_view_model.svelte';
import {
  createAppDialogCapabilities,
  createAppDialogsProgress,
} from './testing/app_dialogs_fixtures.ts';

const createViewModel = (
  dialog = createAppDialogCapabilities(),
  progress = createAppDialogsProgress(),
) => createAppDialogsViewModel({ className: 'AppDialogsViewModelTest', dialog, progress });

describe('AppDialogsViewModel — state', () => {
  test('reads dialog and loading state from the dialog capability', () => {
    const viewModel = createViewModel(
      createAppDialogCapabilities({
        currentDialog: { type: 'confirm', props: { message: 'Are you sure?' } },
        appLoading: { label: 'Loading…' },
      }),
    );

    expect(viewModel.currentDialog?.type).toBe('confirm');
    expect(viewModel.appLoading?.label).toBe('Loading…');
    expect(viewModel.toasts).toEqual([]);
  });

  test('aggregates background progress from the progress capability', () => {
    const viewModel = createViewModel(createAppDialogCapabilities(), createAppDialogsProgress(42));

    expect(viewModel.bottomProgress).toBe(42);
  });
});

describe('AppDialogsViewModel — actions', () => {
  test('closeDialog delegates to the dialog capability with the result', () => {
    const close = mock((_result?: unknown) => {});
    const viewModel = createViewModel(createAppDialogCapabilities({ close }));

    viewModel.closeDialog('confirmed');

    expect(close).toHaveBeenCalledWith('confirmed');
  });

  test('dismissLoading hides the global loading overlay', () => {
    const setAppLoading = mock((_loading: boolean, _label?: string) => {});
    const viewModel = createViewModel(createAppDialogCapabilities({ setAppLoading }));

    viewModel.dismissLoading();

    expect(setAppLoading).toHaveBeenCalledWith(false);
  });
});

describe('AppDialogsViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
