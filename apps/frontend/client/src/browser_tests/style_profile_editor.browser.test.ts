// apps/frontend/client/src/browser_tests/style_profile_editor.browser.test.ts
//
// Real-runes coverage for the migrated style-profile-editor ViewModel. The Bun
// suite uses plain fixtures; this lane runs the ViewModel in Chromium with the
// real Svelte compiler against a reactive catalog fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createStyleProfileEditorViewModel } from '../lib/views/gallery/style_profile_editor_view_model.svelte';
import { createStyleProfile } from '../lib/views/gallery/testing/style_profile_editor_fixtures.ts';
import { createReactiveStyleProfileHarness } from '../lib/views/gallery/testing/style_profile_editor_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const USER_PROFILE = createStyleProfile({
  id: 'custom',
  name: 'Custom',
  isBuiltIn: false,
  perImageTags: { portrait: 'detailed' },
});

describe('StyleProfileEditorViewModel — reactive catalog (real runes)', () => {
  test('derived getters follow the reactive catalog and active profile', () => {
    const harness = createReactiveStyleProfileHarness();
    const viewModel = createStyleProfileEditorViewModel({
      className: 'StyleProfileEditorViewModel',
      styleProfile: harness.styleProfile,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.profiles).toEqual([]);

    harness.setProfiles([USER_PROFILE]);
    flushSync();

    expect(viewModel.profiles).toEqual([USER_PROFILE]);

    viewModel.selectProfile('custom');
    flushSync();

    expect(viewModel.activeProfileId).toBe('custom');
    expect(viewModel.activeProfile).toEqual(USER_PROFILE);
    expect(viewModel.activeProfilePerImageTags).toEqual([['portrait', 'detailed']]);
  });

  test('editing a built-in clones it through the capability', () => {
    const harness = createReactiveStyleProfileHarness();
    const viewModel = createStyleProfileEditorViewModel({
      className: 'StyleProfileEditorViewModel',
      styleProfile: harness.styleProfile,
    });
    disposables.push(() => viewModel.dispose());

    harness.setProfiles([createStyleProfile({ id: 'anime', name: 'Anime' })]);
    flushSync();

    viewModel.startEditing('anime');
    flushSync();

    expect(viewModel.isEditing).toBe(true);
    expect(viewModel.editingProfile?.id).toBe('anime_copy');
    expect(viewModel.activeProfileId).toBe('anime_copy');
  });
});
