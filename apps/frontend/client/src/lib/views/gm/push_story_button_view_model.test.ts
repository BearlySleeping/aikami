// apps/frontend/client/src/lib/views/gm/push_story_button_view_model.test.ts
//
// Unit tests for PushStoryButtonViewModel — loading state and double-push guard.
// Exercises the ViewModel through feature-owned fixtures — no global `$services`
// barrel mock.
//
// Contract: C-235 GM Narrative Director

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createPushStoryButtonViewModel } from './push_story_button_view_model.svelte';
import { createPushStoryCapabilities } from './testing/push_story_fixtures.ts';

const createViewModel = (narrative = createPushStoryCapabilities()) =>
  createPushStoryButtonViewModel({ className: 'PushStoryButtonViewModelTest', narrative });

describe('PushStoryButtonViewModel', () => {
  test('delegates pushStory and clears the loading flag', async () => {
    const pushStory = mock(async () => {});
    const viewModel = createViewModel(createPushStoryCapabilities({ pushStory }));

    await viewModel.pushStory();

    expect(pushStory).toHaveBeenCalledTimes(1);
    expect(viewModel.isPushing).toBe(false);
  });

  test('sets isPushing while the request is pending', async () => {
    let resolvePush: (() => void) | undefined;
    const pushStory = (): Promise<void> =>
      new Promise((resolve) => {
        resolvePush = resolve;
      });
    const viewModel = createViewModel(createPushStoryCapabilities({ pushStory }));

    const pending = viewModel.pushStory();
    expect(viewModel.isPushing).toBe(true);

    resolvePush?.();
    await pending;
    expect(viewModel.isPushing).toBe(false);
  });

  test('ignores a second push while one is in progress', async () => {
    const pushStory = mock(
      () =>
        new Promise<void>(() => {
          // Never resolves.
        }),
    );
    const viewModel = createViewModel(createPushStoryCapabilities({ pushStory }));

    void viewModel.pushStory();
    await viewModel.pushStory();

    expect(pushStory).toHaveBeenCalledTimes(1);
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
