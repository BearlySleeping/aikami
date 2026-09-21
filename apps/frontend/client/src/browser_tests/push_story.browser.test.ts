// apps/frontend/client/src/browser_tests/push_story.browser.test.ts
//
// Real-runes coverage for the migrated Push Story button ViewModel. The Bun
// suite uses plain fixtures; this lane runs the ViewModel in Chromium with the
// real Svelte compiler so the transient `$state` flag is observed.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createPushStoryButtonViewModel } from '../lib/views/gm/push_story_button_view_model.svelte';
import { createPushStoryCapabilities } from '../lib/views/gm/testing/push_story_fixtures.ts';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('PushStoryButtonViewModel — real runes', () => {
  test('a pending push sets isPushing then clears it', async () => {
    let resolvePush: (() => void) | undefined;
    const viewModel = createPushStoryButtonViewModel({
      className: 'PushStoryButtonViewModel',
      narrative: createPushStoryCapabilities({
        pushStory: () =>
          new Promise<void>((resolve) => {
            resolvePush = resolve;
          }),
      }),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isPushing).toBe(false);

    const pending = viewModel.pushStory();
    flushSync();
    expect(viewModel.isPushing).toBe(true);

    resolvePush?.();
    await pending;
    flushSync();
    expect(viewModel.isPushing).toBe(false);
  });
});
