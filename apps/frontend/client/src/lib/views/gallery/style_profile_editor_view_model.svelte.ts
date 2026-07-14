// apps/frontend/client/src/lib/views/gallery/style_profile_editor_view_model.svelte.ts
//
// ViewModel for the style profile editor. Allows users to select an active profile,
// edit custom profiles, clone built-in profiles, and manage per-image-type tags.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ImageStyleProfile } from '@aikami/types';
import { styleProfileService } from '$services';

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

export type StyleProfileEditorViewModelOptions = BaseViewModelOptions & {};

export class StyleProfileEditorViewModel
  extends BaseViewModel<StyleProfileEditorViewModelOptions>
  implements StyleProfileEditorViewModelInterface
{
  editingProfile = $state<ImageStyleProfile | undefined>();

  get profiles(): readonly ImageStyleProfile[] {
    return styleProfileService.profiles;
  }

  get activeProfile(): ImageStyleProfile | undefined {
    return styleProfileService.activeProfile;
  }

  get activeProfileId(): string {
    return styleProfileService.activeProfileId;
  }

  set activeProfileId(value: string) {
    styleProfileService.setActiveProfile(value);
  }

  get isEditing(): boolean {
    return this.editingProfile !== undefined;
  }

  selectProfile(id: string): void {
    styleProfileService.setActiveProfile(id);
  }

  startEditing(id: string): void {
    const source = this.profiles.find((p) => p.id === id);
    if (!source) {
      return;
    }

    // Clone built-in profiles when editing
    if (source.isBuiltIn) {
      const cloned = styleProfileService.cloneProfile(id);
      if (cloned) {
        this.editingProfile = { ...cloned };
        styleProfileService.setActiveProfile(cloned.id);
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
    styleProfileService.saveProfile(this.editingProfile);
    this.editingProfile = undefined;
  }

  deleteProfile(id: string): void {
    styleProfileService.deleteProfile(id);
    if (this.editingProfile?.id === id) {
      this.editingProfile = undefined;
    }
  }

  cloneProfile(id: string): void {
    const cloned = styleProfileService.cloneProfile(id);
    if (cloned) {
      this.editingProfile = { ...cloned };
      styleProfileService.setActiveProfile(cloned.id);
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

export const getStyleProfileEditorViewModel = (
  options: StyleProfileEditorViewModelOptions,
): StyleProfileEditorViewModelInterface => StyleProfileEditorViewModel.create(options);
