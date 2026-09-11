// apps/frontend/client/src/lib/views/gallery/style_profile_editor_view_model.test.ts
//
// Unit tests for StyleProfileEditorViewModel — selection, built-in cloning,
// edit/save/delete, field updates, and per-image tag derivation. Exercises the
// ViewModel through feature-owned fixtures — no global `$services` barrel mock.
//
// Contract: C-242 Image Generation Pipeline

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { ImageStyleProfile } from '@aikami/types';
import {
  createStyleProfileEditorViewModel,
  type StyleProfileCapabilities,
} from './style_profile_editor_view_model.svelte';
import {
  createStyleProfile,
  createStyleProfileCapabilities,
} from './testing/style_profile_editor_fixtures.ts';

const BUILT_IN = createStyleProfile({ id: 'anime', name: 'Anime' });
const USER_PROFILE = createStyleProfile({
  id: 'custom',
  name: 'Custom',
  isBuiltIn: false,
  perImageTags: { portrait: 'detailed' },
});

const createViewModel = (styleProfile: StyleProfileCapabilities) =>
  createStyleProfileEditorViewModel({
    className: 'StyleProfileEditorViewModelTest',
    styleProfile,
  });

describe('StyleProfileEditorViewModel — selection', () => {
  test('exposes the injected catalog and active profile', () => {
    const viewModel = createViewModel(
      createStyleProfileCapabilities({
        profiles: [BUILT_IN, USER_PROFILE],
        activeProfile: USER_PROFILE,
        activeProfileId: 'custom',
      }),
    );

    expect(viewModel.profiles).toEqual([BUILT_IN, USER_PROFILE]);
    expect(viewModel.activeProfile).toBe(USER_PROFILE);
    expect(viewModel.activeProfileId).toBe('custom');
  });

  test('selectProfile delegates to the capability', () => {
    const setActiveProfile = mock((_id: string) => {});
    const viewModel = createViewModel(createStyleProfileCapabilities({ setActiveProfile }));

    viewModel.selectProfile('anime');

    expect(setActiveProfile).toHaveBeenCalledWith('anime');
  });
});

describe('StyleProfileEditorViewModel — editing', () => {
  test('startEditing a built-in clones it and makes the clone active', () => {
    const cloned = createStyleProfile({ id: 'anime_copy', name: 'Anime Copy', isBuiltIn: false });
    const cloneProfile = mock((_id: string) => cloned);
    const setActiveProfile = mock((_id: string) => {});
    const viewModel = createViewModel(
      createStyleProfileCapabilities({
        profiles: [BUILT_IN],
        cloneProfile,
        setActiveProfile,
      }),
    );

    viewModel.startEditing('anime');

    expect(cloneProfile).toHaveBeenCalledWith('anime');
    expect(setActiveProfile).toHaveBeenCalledWith('anime_copy');
    expect(viewModel.isEditing).toBe(true);
    expect(viewModel.editingProfile).toEqual(cloned);
  });

  test('startEditing a user profile copies it without cloning', () => {
    const cloneProfile = mock((_id: string) => undefined);
    const viewModel = createViewModel(
      createStyleProfileCapabilities({ profiles: [USER_PROFILE], cloneProfile }),
    );

    viewModel.startEditing('custom');

    expect(cloneProfile).not.toHaveBeenCalled();
    expect(viewModel.editingProfile).toEqual(USER_PROFILE);
  });

  test('cancelEditing discards the draft', () => {
    const viewModel = createViewModel(createStyleProfileCapabilities({ profiles: [USER_PROFILE] }));
    viewModel.startEditing('custom');

    viewModel.cancelEditing();

    expect(viewModel.isEditing).toBe(false);
  });

  test('saveProfile persists the draft and closes the form', () => {
    const saveProfile = mock((_profile: ImageStyleProfile) => {});
    const viewModel = createViewModel(
      createStyleProfileCapabilities({ profiles: [USER_PROFILE], saveProfile }),
    );
    viewModel.startEditing('custom');
    viewModel.updateEditingField('name', 'Renamed');

    viewModel.saveProfile();

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(saveProfile.mock.calls[0]?.[0]?.name).toBe('Renamed');
    expect(viewModel.isEditing).toBe(false);
  });

  test('deleteProfile clears the draft when deleting the edited profile', () => {
    const deleteProfile = mock((_id: string) => {});
    const viewModel = createViewModel(
      createStyleProfileCapabilities({ profiles: [USER_PROFILE], deleteProfile }),
    );
    viewModel.startEditing('custom');

    viewModel.deleteProfile('custom');

    expect(deleteProfile).toHaveBeenCalledWith('custom');
    expect(viewModel.isEditing).toBe(false);
  });
});

describe('StyleProfileEditorViewModel — field updates', () => {
  test('updateEditingField is a no-op without a draft', () => {
    const viewModel = createViewModel(createStyleProfileCapabilities());

    viewModel.updateEditingField('name', 'Ignored');

    expect(viewModel.editingProfile).toBeUndefined();
  });

  test('updatePerImageTag merges into the draft tags', () => {
    const viewModel = createViewModel(createStyleProfileCapabilities({ profiles: [USER_PROFILE] }));
    viewModel.startEditing('custom');

    viewModel.updatePerImageTag('sprite', 'pixel art');

    expect(viewModel.editingProfile?.perImageTags).toEqual({
      portrait: 'detailed',
      sprite: 'pixel art',
    });
  });
});

describe('StyleProfileEditorViewModel — derived tags', () => {
  test('returns non-empty per-image tags for the active profile', () => {
    const viewModel = createViewModel(
      createStyleProfileCapabilities({ activeProfile: USER_PROFILE }),
    );

    expect(viewModel.activeProfilePerImageTags).toEqual([['portrait', 'detailed']]);
  });

  test('returns an empty list without an active profile', () => {
    const viewModel = createViewModel(createStyleProfileCapabilities());

    expect(viewModel.activeProfilePerImageTags).toEqual([]);
  });
});

describe('StyleProfileEditorViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel(createStyleProfileCapabilities())).toBeInstanceOf(BaseViewModel);
  });
});
