// packages/shared/local-ai/src/lib/audio/audio_capability.ts
//
// C-521 AC-2: SFX are a *distinct capability*, and a missing SFX model is a
// typed refusal rather than a silent fall back to the music model.
//
// The rule this module enforces is one line long and worth stating plainly:
//
//   a music model may only serve `music`, and a one-shot/ambience job may only
//   be served by a profile that declares `sfx`/`ambient` in its `jobKinds`.
//
// Without it, an SFX brief resolves to whatever audio engine happens to be
// reachable and produces a two-second orchestral stab where a gate slam was
// asked for. That is the failure this contract exists to prevent.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { GENERATION_PROVIDER_PROFILES, type GenerationProviderProfile } from '@aikami/constants';
import type { AudioGenerationRefusal } from '@aikami/types';

/** The brief job kinds that carry audio modality. */
export const AUDIO_GENERATION_JOB_KINDS = ['music', 'ambient', 'sfx'] as const;

/** An audio job kind. */
export type AudioGenerationJobKind = (typeof AUDIO_GENERATION_JOB_KINDS)[number];

/**
 * C-521 decision, recorded rather than left implicit: **ambience may use the
 * music model as a declared fallback.**
 *
 * The contract text separates the two cases on purpose. For a one-shot it is
 * explicit — "SFX generation is refused with a typed reason rather than
 * silently falling back to a music model", because a two-second gate slam is
 * not something a text-to-music model can produce. For ambience it says the
 * declared SFX/ambient model must be used *when one is installed*: an ambient
 * bed is a texture, which a music model genuinely produces, and refusing it
 * would make ambience unusable on a host that ships no SFX model.
 *
 * The fallback is never silent: the resolution carries
 * `servedAsKind: 'music'` and `usedMusicModelFallback: true`, so a caller (and
 * the plan report) can see that an ambient job was served by the music model.
 * Set this to `false` to refuse ambience instead — the only other behaviour
 * the contract permits — and `AUDIO_JOB_KIND_SOURCES.ambient` narrows to
 * `['ambient']`.
 */
export const AUDIO_AMBIENT_MUSIC_FALLBACK_ALLOWED = true;

/**
 * Which profile job kinds may serve each brief job kind, in preference order.
 *
 * `sfx` has exactly one source: a one-shot is never produced by a music model,
 * and a host without a licence-eligible SFX model refuses the job with a typed
 * reason. `ambient` prefers a dedicated ambience/SFX model and, while
 * {@link AUDIO_AMBIENT_MUSIC_FALLBACK_ALLOWED} holds, may fall back to the
 * music model for an ambient bed — declared on the resolution, never silent.
 */
export const AUDIO_JOB_KIND_SOURCES: Readonly<
  Record<AudioGenerationJobKind, readonly AudioGenerationJobKind[]>
> = {
  music: ['music'],
  ambient: AUDIO_AMBIENT_MUSIC_FALLBACK_ALLOWED ? ['ambient', 'music'] : ['ambient'],
  sfx: ['sfx'],
};

/** A resolved, dispatchable audio capability. */
export type ResolvedAudioCapability = {
  available: true;
  /** The chosen provider profile id. */
  profileId: string;
  /** The pinned model id, when the profile declares one. */
  modelId?: string;
  /** The engine the profile dispatches to. */
  engineId?: string;
  /** The protocol the engine speaks. */
  protocol?: string;
  /** How the bytes reach the runner. */
  mode: 'local' | 'hosted' | 'import';
  /** The job kind the profile actually declares (may differ from the request). */
  servedAsKind: AudioGenerationJobKind;
  /** True when the profile is a music model serving a non-music request. */
  usedMusicModelFallback: boolean;
};

/** A refused audio capability, with the typed reason. */
export type RefusedAudioCapability = {
  available: false;
  refusal: AudioGenerationRefusal;
};

/** The outcome of resolving an audio job kind to a dispatchable profile. */
export type AudioCapabilityResolution = ResolvedAudioCapability | RefusedAudioCapability;

/** True when a profile declares that it may serve `jobKind`. */
export const profileServesJobKind = (
  profile: GenerationProviderProfile,
  jobKind: AudioGenerationJobKind,
): boolean => profile.jobKinds?.includes(jobKind) === true;

/**
 * True when the profile is a *music* model — the ones an SFX or ambience job
 * must never be dispatched to.
 */
export const isMusicModelProfile = (profile: GenerationProviderProfile): boolean =>
  profile.modality === 'audio' && profile.jobKinds?.includes('music') === true;

/** Why one candidate profile was skipped. */
type CandidateSkip = {
  profileId: string;
  reason: 'unavailable' | 'license_undecided' | 'engine_unreachable' | 'import_only';
  note: string;
};

const refusal = (
  code: AudioGenerationRefusal['code'],
  message: string,
  profileId?: string,
): AudioGenerationRefusal => ({
  code,
  message,
  modality: 'audio',
  ...(profileId === undefined ? {} : { profileId }),
});

/**
 * Resolves an audio job kind to a dispatchable profile, or a typed refusal.
 *
 * @param options.jobKind - `music` | `ambient` | `sfx`.
 * @param options.engineAvailable - Whether the audio engine is configured and
 *        reachable *now*. A local profile with no engine is `engine_unreachable`,
 *        which is a degraded-mode answer, not a licence answer.
 * @param options.featureEnabled - The disable-new-generation flag. Playback is
 *        unaffected by it; only generation is refused.
 * @param options.profiles - Override the declared registry (tests).
 */
export const resolveAudioGenerationCapability = (options: {
  jobKind: AudioGenerationJobKind;
  engineAvailable: boolean;
  featureEnabled?: boolean;
  profiles?: Readonly<Record<string, GenerationProviderProfile>>;
  disabledProfileIds?: readonly string[];
}): AudioCapabilityResolution => {
  const { jobKind, engineAvailable } = options;
  const featureEnabled = options.featureEnabled ?? true;
  const profiles = options.profiles ?? GENERATION_PROVIDER_PROFILES;
  const disabled = new Set(options.disabledProfileIds ?? []);

  if (!featureEnabled) {
    return {
      available: false,
      refusal: refusal(
        'feature_disabled',
        'Audio generation is switched off by configuration. Playback and saves are unaffected; accepted assets remain playable.',
      ),
    };
  }

  const candidates: { profile: GenerationProviderProfile; servedAsKind: AudioGenerationJobKind }[] =
    [];
  for (const sourceKind of AUDIO_JOB_KIND_SOURCES[jobKind]) {
    for (const profile of Object.values(profiles)) {
      if (
        profile.modality === 'audio' &&
        profileServesJobKind(profile, sourceKind) &&
        !disabled.has(profile.id) &&
        !candidates.some((candidate) => candidate.profile.id === profile.id)
      ) {
        candidates.push({ profile, servedAsKind: sourceKind });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      available: false,
      refusal: refusal(
        'profile_unavailable',
        `No declared audio provider profile serves the "${jobKind}" job kind.`,
      ),
    };
  }

  const skips: CandidateSkip[] = [];
  for (const candidate of candidates) {
    const { profile, servedAsKind } = candidate;
    if (profile.mode === 'unavailable') {
      skips.push({
        profileId: profile.id,
        reason: profile.licenseResolved === false ? 'license_undecided' : 'unavailable',
        note: profile.note,
      });
      continue;
    }
    if (profile.licenseResolved === false) {
      skips.push({ profileId: profile.id, reason: 'license_undecided', note: profile.note });
      continue;
    }
    if (profile.mode === 'import') {
      // A valid *source* of bytes, but not something the runner can dispatch
      // to. It is reported so the caller knows the import path exists.
      skips.push({ profileId: profile.id, reason: 'import_only', note: profile.note });
      continue;
    }
    if (!engineAvailable) {
      skips.push({ profileId: profile.id, reason: 'engine_unreachable', note: profile.note });
      continue;
    }
    return {
      available: true,
      profileId: profile.id,
      mode: profile.mode,
      servedAsKind,
      usedMusicModelFallback: servedAsKind !== jobKind && isMusicModelProfile(profile),
      ...(profile.modelId === undefined ? {} : { modelId: profile.modelId }),
      ...(profile.engineId === undefined ? {} : { engineId: profile.engineId }),
      ...(profile.protocol === undefined ? {} : { protocol: profile.protocol }),
    };
  }

  // Every candidate was skipped. The refusal names the most specific blocker:
  // a licence problem is not an engine problem, and `sfx` in particular must
  // say why it did not fall back to the music model.
  const licenseSkip = skips.find((skip) => skip.reason === 'license_undecided');
  const importSkip = skips.find((skip) => skip.reason === 'import_only');

  if (licenseSkip !== undefined) {
    const isOneShot = jobKind === 'sfx' || jobKind === 'ambient';
    return {
      available: false,
      refusal: refusal(
        'model_license_undecided',
        isOneShot
          ? `No licence-eligible ${jobKind} model is installed (${licenseSkip.profileId}). ${jobKind} generation is refused rather than falling back to a music model — a text-to-music engine does not produce one-shots. Import an owned/licensed recording instead.`
          : `No licence-eligible audio model is installed for "${jobKind}" (${licenseSkip.profileId}).`,
        licenseSkip.profileId,
      ),
    };
  }
  if (importSkip !== undefined) {
    return {
      available: false,
      refusal: refusal(
        'profile_unavailable',
        `The only profile serving "${jobKind}" is an import path (${importSkip.profileId}) — bytes must arrive from an owned/licensed recording; no local or hosted engine serves this kind.`,
        importSkip.profileId,
      ),
    };
  }
  if (skips.some((skip) => skip.reason === 'engine_unreachable')) {
    return {
      available: false,
      refusal: refusal(
        'engine_unreachable',
        'The audio engine is not reachable. Accepted assets stay playable offline; generation returns this typed reason instead of guessing.',
      ),
    };
  }
  return {
    available: false,
    refusal: refusal(
      'profile_unavailable',
      `Every profile serving "${jobKind}" is declared but not shipped on this host.`,
      skips[0]?.profileId,
    ),
  };
};

/**
 * Guards a concrete dispatch: the chosen profile must declare the job kind.
 *
 * Used by the runner immediately before it hands a job to an engine, so a
 * mis-resolved profile is a hard stop rather than a wrong-sounding cue.
 *
 * @param options.declaredFallback - Set when the resolution already recorded
 *        that a music model is serving a non-music request as a *declared*
 *        fallback (see {@link ResolvedAudioCapability.usedMusicModelFallback}).
 *        Without it, a music profile serving an `ambient` job is a hard stop.
 * @returns The refusal when the profile may not serve this kind, else `undefined`.
 */
export const guardProfileForJobKind = (options: {
  profile: GenerationProviderProfile;
  jobKind: AudioGenerationJobKind;
  declaredFallback?: boolean;
}): AudioGenerationRefusal | undefined => {
  const { profile, jobKind, declaredFallback = false } = options;
  if (profile.modality !== 'audio') {
    return refusal(
      'capability_unsupported',
      `Profile "${profile.id}" is an ${profile.modality} profile and cannot serve an audio job.`,
      profile.id,
    );
  }
  if (profileServesJobKind(profile, jobKind)) {
    return undefined;
  }
  if (isMusicModelProfile(profile) && declaredFallback) {
    return undefined;
  }
  if (isMusicModelProfile(profile)) {
    return refusal(
      'capability_unsupported',
      `Profile "${profile.id}" is a music model and must not be used for a "${jobKind}" job — one-shots and ambience need the declared SFX/ambient profile.`,
      profile.id,
    );
  }
  return refusal(
    'capability_unsupported',
    `Profile "${profile.id}" does not declare the "${jobKind}" job kind.`,
    profile.id,
  );
};
