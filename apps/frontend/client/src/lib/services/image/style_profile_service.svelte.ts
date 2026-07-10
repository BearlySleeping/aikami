// apps/frontend/client/src/lib/services/image/style_profile_service.svelte.ts
//
// Manages image style profiles: built-in profile loading, user-created profiles,
// cloning, CRUD operations, and active profile selection. Built-in profiles are
// immutable — they can be cloned but never deleted or edited.
//
// Contract: C-242 Image Generation Pipeline

import { BUILT_IN_STYLE_PROFILES, DEFAULT_STYLE_PROFILE_ID } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ImageStyleProfile } from '@aikami/types';

export type StyleProfileServiceInterface = BaseFrontendClassInterface & {
  /** All available profiles (built-in + user-created). */
  readonly profiles: readonly ImageStyleProfile[];
  /** The currently active profile ID. */
  activeProfileId: string;
  /** The currently active profile (resolved from activeProfileId). */
  get activeProfile(): ImageStyleProfile | undefined;
  /**
   * Sets the active profile by ID. Falls back to default if not found.
   * @param id - The profile ID to activate.
   */
  setActiveProfile(id: string): void;
  /**
   * Clones a profile (built-in or custom) to create an editable custom variant.
   * @param id - The ID of the profile to clone.
   * @returns The cloned profile, or undefined if the source wasn't found.
   */
  cloneProfile(id: string): ImageStyleProfile | undefined;
  /**
   * Saves (creates or updates) a user-created profile. Built-in profiles cannot be updated.
   * @param profile - The profile to save.
   */
  saveProfile(profile: ImageStyleProfile): void;
  /**
   * Deletes a user-created profile. Built-in profiles cannot be deleted.
   * If the active profile is deleted, resets to the default.
   * @param id - The profile ID to delete.
   */
  deleteProfile(id: string): void;
  /** Resets all user profiles and reverts to defaults. */
  resetToDefaults(): void;
};

export type StyleProfileServiceOptions = BaseFrontendClassOptions & {};

// ── Implementation ──────────────────────────────────────────────────────

export class StyleProfileService
  extends BaseFrontendClass<StyleProfileServiceOptions>
  implements StyleProfileServiceInterface
{
  /** All profiles (built-in + user-created). */
  private _profiles: ImageStyleProfile[] = $state([...BUILT_IN_STYLE_PROFILES]);

  /** The currently active profile ID. */
  activeProfileId = $state(DEFAULT_STYLE_PROFILE_ID);

  get profiles(): readonly ImageStyleProfile[] {
    return this._profiles;
  }

  get activeProfile(): ImageStyleProfile | undefined {
    return this._profiles.find((p) => p.id === this.activeProfileId);
  }

  setActiveProfile(id: string): void {
    const found = this._profiles.find((p) => p.id === id);
    if (found) {
      this.activeProfileId = id;
    } else {
      this.activeProfileId = DEFAULT_STYLE_PROFILE_ID;
      this.warn('setActiveProfile: profile not found, reset to default', { id });
    }
  }

  cloneProfile(id: string): ImageStyleProfile | undefined {
    const source = this._profiles.find((p) => p.id === id);
    if (!source) {
      this.warn('cloneProfile: source not found', { id });
      return undefined;
    }

    const cloned: ImageStyleProfile = {
      ...source,
      id: `${source.id}-clone-${Date.now()}`,
      name: `${source.name} (Clone)`,
      isBuiltIn: false,
      positiveTags: source.positiveTags,
      negativeTags: source.negativeTags,
      perImageTags: { ...source.perImageTags },
    };

    this._profiles = [...this._profiles, cloned];
    this.debug('cloneProfile', { sourceId: id, clonedId: cloned.id });
    return cloned;
  }

  saveProfile(profile: ImageStyleProfile): void {
    const existing = this._profiles.find((p) => p.id === profile.id);

    if (existing?.isBuiltIn) {
      this.warn('saveProfile: cannot modify built-in profile', { id: profile.id });
      return;
    }

    if (existing) {
      this._profiles = this._profiles.map((p) => (p.id === profile.id ? { ...profile } : p));
    } else {
      this._profiles = [...this._profiles, { ...profile, isBuiltIn: false }];
    }
  }

  deleteProfile(id: string): void {
    const existing = this._profiles.find((p) => p.id === id);

    if (!existing) {
      this.warn('deleteProfile: profile not found', { id });
      return;
    }

    if (existing.isBuiltIn) {
      this.warn('deleteProfile: cannot delete built-in profile', { id });
      return;
    }

    this._profiles = this._profiles.filter((p) => p.id !== id);

    if (this.activeProfileId === id) {
      this.activeProfileId = DEFAULT_STYLE_PROFILE_ID;
    }
  }

  resetToDefaults(): void {
    this._profiles = [...BUILT_IN_STYLE_PROFILES];
    this.activeProfileId = DEFAULT_STYLE_PROFILE_ID;
  }
}

export const styleProfileService: StyleProfileServiceInterface = StyleProfileService.create({
  className: 'StyleProfileService',
});
