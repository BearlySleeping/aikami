// packages/shared/constants/src/lib/asset_batch.test.ts
//
// C-522: the provider-profile registry is the authority for which ids exist, so
// a surface that needs "the local profile for this recipe" resolves one instead
// of naming one. The client studio shipped `local-sdcpp` — an id in no registry
// — and every dispatch became a `provider_unavailable` blocker, so this is the
// guard that a fictional id cannot be produced by the resolver either.

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES, localProviderProfileForEngine } from './asset_batch.ts';

describe('C-522: a local provider profile is resolved from the registry', () => {
  test('the studio portrait recipe resolves to the registered sdcpp profile', () => {
    const profile = localProviderProfileForEngine({ engineId: 'sdcpp', modality: 'image' });
    expect(profile?.id).toBe('existing_sdcpp_profile_if_required_capabilities_pass');
    // The runner looks the dispatch's id up in this record, so the returned id
    // must be a *key* of it — a profile-shaped object with an unregistered id
    // would resolve to nothing, which is the whole defect.
    expect(GENERATION_PROVIDER_PROFILES[profile?.id ?? '']).toBe(profile);
  });

  test('the comfyui image profile is reachable by its engine', () => {
    expect(localProviderProfileForEngine({ engineId: 'comfyui', modality: 'image' })?.id).toBe(
      'flux2_klein_base4b_comfy_profile',
    );
  });

  test('the documented audio default is the v1.5 turbo profile', () => {
    // Two ACE-Step profiles serve `ace-step`; the tie-break must pick the one
    // the registry documents as the default for music and ambience.
    expect(localProviderProfileForEngine({ engineId: 'ace-step', modality: 'audio' })?.id).toBe(
      'ace_step_15_2b_turbo_profile',
    );
  });

  test('every resolvable pair is local, registered, and of the asked-for modality', () => {
    for (const engineId of ['sdcpp', 'comfyui', 'ace-step'] as const) {
      for (const modality of ['image', 'audio'] as const) {
        const profile = localProviderProfileForEngine({ engineId, modality });
        if (profile === undefined) {
          continue;
        }
        expect(profile.mode).toBe('local');
        expect(profile.engineId).toBe(engineId);
        expect(profile.modality).toBe(modality);
        expect(GENERATION_PROVIDER_PROFILES[profile.id]).toBe(profile);
      }
    }
  });

  test('an unserved pair is undefined rather than a fabricated capability', () => {
    // Nothing local serves sdcpp for audio, or ace-step for images. A resolver
    // that answered anyway would be inventing a transport to dial.
    expect(localProviderProfileForEngine({ engineId: 'sdcpp', modality: 'audio' })).toBeUndefined();
    expect(
      localProviderProfileForEngine({ engineId: 'ace-step', modality: 'image' }),
    ).toBeUndefined();
  });

  test('the id the studio once shipped is not registered', () => {
    // The regression, stated where it can never drift: `local-sdcpp` reached
    // production and stranded every client dispatch. It must not come back.
    expect(GENERATION_PROVIDER_PROFILES['local-sdcpp']).toBeUndefined();
    expect(GENERATION_PROVIDER_PROFILES['image-default']).toBeUndefined();
  });
});
