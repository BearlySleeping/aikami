// apps/frontend/client/src/lib/views/gallery/style_profile_editor_view_model.svelte.ts
//
// ViewModel for the style profile editor. Allows users to select an active
// profile, edit custom profiles, clone built-in profiles, and manage
// per-image-type tags.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/style_profile_editor_fixtures.ts).
// Production wiring lives in ./style_profile_editor_composition.ts.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ImageStyleProfile } from '@aikami/types';

// ── Capability contracts ────────────────────────────────────────────────

/** The style-profile operations the editor reads and drives. */
export type StyleProfileCapabilities = {
  readonly profiles: readonly ImageStyleProfile[];
  readonly activeProfile: ImageStyleProfile | undefined;
  readonly activeProfileId: string;
  setActiveProfile(id: string): void;
  cloneProfile(id: string): ImageStyleProfile | undefined;
  saveProfile(profile: ImageStyleProfile): void;
  deleteProfile(id: string): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type StyleProfileEditorViewModelOptions = BaseViewModelOptions & {
  /** Style-profile capability. */
  styleProfile: StyleProfileCapabilities;
};

export type StyleProfileEditorViewModelInterface = BaseViewModelInterface & {
  readonly profiles: readonly ImageStyleProfile[];
  readonly activeProfile: ImageStyleProfile | undefined;
  activeProfileId: string;
  /** Currently editing profile (may be different from active). */
  editingProfile: ImageStyleProfile | undefined;
  /** Whether the editing form is visible. */
  get isEditing(): boolean;
  /** Select the active profile. */
  selectProfile(id: string): void;
  /** Start editing a profile (clones built-in profiles first). */
  startEditing(id: string): void;
  /** Cancel editing and discard changes. */
  cancelEditing(): void;
  /** Save the currently edited profile. */
  saveProfile(): void;
  /** Delete a user-created profile. */
  deleteProfile(id: string): void;
  /** Clone a profile to create a new custom variant. */
  cloneProfile(id: string): void;
  /** Update a field on the editing profile. */
  updateEditingField(field: keyof ImageStyleProfile, value: string): void;
  /** Update a per-image-type tag. */
  updatePerImageTag(imageType: string, value: string): void;
  /** Active profile per-image tag entries for view rendering. */
  get activeProfilePerImageTags(): readonly (readonly [string, string])[];
};

// ── Implementation ──────────────────────────────────────────────────────

class StyleProfileEditorViewModel
  extends BaseViewModel<StyleProfileEditorViewModelOptions>
  implements StyleProfileEditorViewModelInterface
{
  private readonly _styleProfile: StyleProfileCapabilities;

  editingProfile = $state<ImageStyleProfile | undefined>();

  constructor(options: StyleProfileEditorViewModelOptions) {
    super(options);
    this._styleProfile = options.styleProfile;
  }

  get profiles(): readonly ImageStyleProfile[] {
    return this._styleProfile.profiles;
  }

  get activeProfile(): ImageStyleProfile | undefined {
    return this._styleProfile.activeProfile;
  }

  get activeProfileId(): string {
    return this._styleProfile.activeProfileId;
  }

  set activeProfileId(value: string) {
    this._styleProfile.setActiveProfile(value);
  }

  get isEditing(): boolean {
    return this.editingProfile !== undefined;
  }

  selectProfile(id: string): void {
    this._styleProfile.setActiveProfile(id);
  }

  startEditing(id: string): void {
    const source = this.profiles.find((p) => p.id === id);
    if (!source) {
      return;
    }

    // Clone built-in profiles when editing
    if (source.isBuiltIn) {
      const cloned = this._styleProfile.cloneProfile(id);
      if (cloned) {
        this.editingProfile = { ...cloned };
        this._styleProfile.setActiveProfile(cloned.id);
      }
    } else {
      this.editingProfile = { ...source };
    }
  }

  cancelEditing(): void {
    this.editingProfile = undefined;
  }

  saveProfile(): void {
    if (!this.editingProfile) {
      return;
    }
    this._styleProfile.saveProfile(this.editingProfile);
    this.editingProfile = undefined;
  }

  deleteProfile(id: string): void {
    this._styleProfile.deleteProfile(id);
    if (this.editingProfile?.id === id) {
      this.editingProfile = undefined;
    }
  }

  cloneProfile(id: string): void {
    const cloned = this._styleProfile.cloneProfile(id);
    if (cloned) {
      this.editingProfile = { ...cloned };
      this._styleProfile.setActiveProfile(cloned.id);
    }
  }

  updateEditingField(field: keyof ImageStyleProfile, value: string): void {
    if (!this.editingProfile) {
      return;
    }
    this.editingProfile = { ...this.editingProfile, [field]: value };
  }

  updatePerImageTag(imageType: string, value: string): void {
    if (!this.editingProfile) {
      return;
    }
    this.editingProfile = {
      ...this.editingProfile,
      perImageTags: { ...this.editingProfile.perImageTags, [imageType]: value },
    };
  }

  get activeProfilePerImageTags(): readonly (readonly [string, string])[] {
    const profile = this.activeProfile;
    if (!profile) {
      return [];
    }
    return Object.entries(profile.perImageTags).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    );
  }
}

/**
 * Builds a style-profile-editor ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getStyleProfileEditorViewModel` in
 * ./style_profile_editor_composition.ts.
 */
export const createStyleProfileEditorViewModel = (
  options: StyleProfileEditorViewModelOptions,
): StyleProfileEditorViewModelInterface => StyleProfileEditorViewModel.create(options);
