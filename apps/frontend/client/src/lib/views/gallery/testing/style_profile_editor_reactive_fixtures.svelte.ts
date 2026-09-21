// apps/frontend/client/src/lib/views/gallery/testing/style_profile_editor_reactive_fixtures.svelte.ts
//
// Reactive style-profile double for the real-Svelte (Vitest Browser Mode) lane.
// The catalog and active profile are real `$state`, so a test can switch
// profiles and observe the ViewModel's derived getters update.

import type { ImageStyleProfile } from '@aikami/types';
import type { StyleProfileCapabilities } from '../style_profile_editor_view_model.svelte';

export type ReactiveStyleProfileHarness = {
  /** The capability object to inject into the ViewModel. */
  styleProfile: StyleProfileCapabilities;
  /** Replace the reactive catalog. */
  setProfiles(profiles: ImageStyleProfile[]): void;
  /** Profiles persisted through the capability, in order. */
  readonly savedProfiles: ImageStyleProfile[];
  /** Profile ids deleted through the capability, in order. */
  readonly deletedIds: string[];
};

/**
 * Creates a style-profile double whose catalog and active profile are real
 * Svelte `$state`, plus harness methods to drive and observe it.
 */
export const createReactiveStyleProfileHarness = (): ReactiveStyleProfileHarness => {
  let profiles = $state<ImageStyleProfile[]>([]);
  let activeProfileId = $state<string>('');
  let activeProfile = $state<ImageStyleProfile | undefined>(undefined);

  const savedProfiles: ImageStyleProfile[] = [];
  const deletedIds: string[] = [];

  const styleProfile: StyleProfileCapabilities = {
    get profiles() {
      return profiles;
    },
    get activeProfile() {
      return activeProfile;
    },
    get activeProfileId() {
      return activeProfileId;
    },
    setActiveProfile: (id) => {
      activeProfileId = id;
      activeProfile = profiles.find((p) => p.id === id);
    },
    cloneProfile: (id) => {
      const source = profiles.find((p) => p.id === id);
      if (!source) {
        return undefined;
      }
      const cloned: ImageStyleProfile = {
        ...source,
        id: `${id}_copy`,
        name: `${source.name} Copy`,
        isBuiltIn: false,
      };
      profiles = [...profiles, cloned];
      return cloned;
    },
    saveProfile: (profile) => {
      savedProfiles.push(profile);
      profiles = profiles.map((p) => (p.id === profile.id ? profile : p));
    },
    deleteProfile: (id) => {
      deletedIds.push(id);
      profiles = profiles.filter((p) => p.id !== id);
    },
  };

  return {
    styleProfile,
    setProfiles: (next) => {
      profiles = next;
    },
    savedProfiles,
    deletedIds,
  };
};
