// packages/shared/local-ai/src/lib/audio/audio_capability.test.ts
//
// C-521 AC-2: SFX/ambience resolve to the declared SFX profile or are refused
// with a typed reason — never silently served by the music model.
//
// biome-ignore-all lint/style/useNamingConvention: fixtures declare the project's
// snake_case provider-profile ids, not TypeScript identifiers
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import {
  guardProfileForJobKind,
  isMusicModelProfile,
  profileServesJobKind,
  resolveAudioGenerationCapability,
} from './audio_capability.ts';

const profiles = GENERATION_PROVIDER_PROFILES;

describe('resolveAudioGenerationCapability', () => {
  test('music resolves to the v1.5 profile and names its protocol', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'music',
      engineAvailable: true,
    });
    expect(resolution.available).toBe(true);
    if (!resolution.available) {
      throw new Error('expected an available resolution');
    }
    expect(resolution.profileId).toBe('ace_step_15_2b_turbo_profile');
    expect(resolution.protocol).toBe('ace-step-v1.5');
    expect(resolution.modelId).toBe('audio-ace-step-v15-2b-turbo');
    expect(resolution.usedMusicModelFallback).toBe(false);
  });

  test('the v1 profile is retained for rollback and serves music', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'music',
      engineAvailable: true,
      disabledProfileIds: ['ace_step_15_2b_turbo_profile'],
    });
    expect(resolution.available).toBe(true);
    if (!resolution.available) {
      throw new Error('expected an available resolution');
    }
    expect(resolution.profileId).toBe('ace_step_v1_3_5b_profile');
    expect(resolution.protocol).toBe('ace-step-v1');
  });

  test('sfx with no licence-eligible model installed is refused with a typed reason', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'sfx',
      engineAvailable: true,
    });
    expect(resolution.available).toBe(false);
    if (resolution.available) {
      throw new Error('expected a refusal');
    }
    expect(resolution.refusal.code).toBe('model_license_undecided');
    expect(resolution.refusal.modality).toBe('audio');
    // The refusal must say that falling back to the music model is refused.
    expect(resolution.refusal.message).toContain('music model');
    expect(resolution.refusal.profileId).toBe('stable_audio_open_1_0_profile');
  });

  test('ambience prefers a dedicated ambience profile when one is installed', () => {
    const withSfxModel = {
      sfx_model: {
        id: 'sfx_model',
        label: 'SFX model',
        mode: 'local' as const,
        modality: 'audio' as const,
        jobKinds: ['sfx', 'ambient'] as const,
        licenseResolved: true,
        estimatedSpendUsdPerCandidate: 0,
        requiresRightsDecision: false,
        note: 'declared SFX/ambient model',
      },
      ace_step_15_2b_turbo_profile: profiles.ace_step_15_2b_turbo_profile as never,
    };
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'ambient',
      engineAvailable: true,
      profiles: withSfxModel,
    });
    expect(resolution.available).toBe(true);
    if (!resolution.available) {
      throw new Error('expected an available resolution');
    }
    expect(resolution.profileId).toBe('sfx_model');
    expect(resolution.servedAsKind).toBe('ambient');
    expect(resolution.usedMusicModelFallback).toBe(false);
  });

  test('ambience falls back to the music model only as a DECLARED fallback', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'ambient',
      engineAvailable: true,
    });
    expect(resolution.available).toBe(true);
    if (!resolution.available) {
      throw new Error('expected an available resolution');
    }
    expect(resolution.profileId).toBe('ace_step_15_2b_turbo_profile');
    expect(resolution.servedAsKind).toBe('music');
    expect(resolution.usedMusicModelFallback).toBe(true);
  });

  test('SFX is never resolved to the music model, even when it is the only reachable engine', () => {
    const onlyMusic = {
      music_only: {
        id: 'music_only',
        label: 'Music only',
        mode: 'local' as const,
        modality: 'audio' as const,
        engineId: 'ace-step' as const,
        jobKinds: ['music'] as const,
        estimatedSpendUsdPerCandidate: 0,
        requiresRightsDecision: false,
        note: 'only a music model is available',
      },
    };
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'sfx',
      engineAvailable: true,
      profiles: onlyMusic,
    });
    expect(resolution.available).toBe(false);
    if (resolution.available) {
      throw new Error('expected a refusal');
    }
    expect(resolution.refusal.code).toBe('profile_unavailable');
  });

  test('an import-only kind reports the import path rather than a bare failure', () => {
    const importOnly = {
      recordings: {
        id: 'recordings',
        label: 'Owned recordings',
        mode: 'import' as const,
        modality: 'audio' as const,
        jobKinds: ['sfx'] as const,
        estimatedSpendUsdPerCandidate: 0,
        requiresRightsDecision: true,
        note: 'import only',
      },
    };
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'sfx',
      engineAvailable: true,
      profiles: importOnly,
    });
    expect(resolution.available).toBe(false);
    if (resolution.available) {
      throw new Error('expected a refusal');
    }
    expect(resolution.refusal.code).toBe('profile_unavailable');
    expect(resolution.refusal.message).toContain('owned/licensed');
  });

  test('an unreachable engine is engine_unreachable, not a licence problem', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'music',
      engineAvailable: false,
    });
    expect(resolution.available).toBe(false);
    if (resolution.available) {
      throw new Error('expected a refusal');
    }
    expect(resolution.refusal.code).toBe('engine_unreachable');
  });

  test('the disable-new-generation flag refuses generation independently of playback', () => {
    const resolution = resolveAudioGenerationCapability({
      jobKind: 'music',
      engineAvailable: true,
      featureEnabled: false,
    });
    expect(resolution.available).toBe(false);
    if (resolution.available) {
      throw new Error('expected a refusal');
    }
    expect(resolution.refusal.code).toBe('feature_disabled');
    expect(resolution.refusal.message).toContain('Playback');
  });
});

describe('guardProfileForJobKind', () => {
  test('lets the v1.5 music profile serve music', () => {
    expect(
      guardProfileForJobKind({
        profile: profiles.ace_step_15_2b_turbo_profile as never,
        jobKind: 'music',
      }),
    ).toBeUndefined();
  });

  test('refuses to let the music model serve a one-shot', () => {
    const refusal = guardProfileForJobKind({
      profile: profiles.ace_step_15_2b_turbo_profile as never,
      jobKind: 'sfx',
    });
    expect(refusal?.code).toBe('capability_unsupported');
    expect(refusal?.message).toContain('music model');
  });

  test('refuses an image profile for an audio job', () => {
    const refusal = guardProfileForJobKind({
      profile: profiles.existing_sdcpp_profile_if_required_capabilities_pass as never,
      jobKind: 'music',
    });
    expect(refusal?.code).toBe('capability_unsupported');
  });
});

describe('profile kind predicates', () => {
  test('classifies the declared profiles', () => {
    expect(profileServesJobKind(profiles.ace_step_15_2b_turbo_profile as never, 'music')).toBe(
      true,
    );
    expect(profileServesJobKind(profiles.ace_step_15_2b_turbo_profile as never, 'sfx')).toBe(false);
    expect(isMusicModelProfile(profiles.ace_step_15_2b_turbo_profile as never)).toBe(true);
    expect(isMusicModelProfile(profiles.stable_audio_open_1_0_profile as never)).toBe(false);
  });
});
