// packages/shared/local-ai/src/lib/preparation/preparation_profile_registry.ts
//
// C-520: the versioned preparation-profile registry.
//
// Profiles are DATA (`preparation_profiles.json`), validated at load time.
// The registry enforces the two rules that make a profile meaningful:
//
//   * A `pixel-art` profile must resample with nearest-neighbour. Blending is
//     refused here rather than detected later, because a blended pixel-art
//     sheet cannot be un-blended.
//   * An operation that needs another stage (frame packing, container encode)
//     is only allowed where that stage exists — the single-image kernel
//     refuses to run it, so a profile cannot pretend it happened.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { PREPARATION_PROFILE_IDS } from '@aikami/constants';
import { PreparationProfileListSchema } from '@aikami/schemas';
import type { PreparationProfile } from '@aikami/types';
import { Value } from 'typebox/value';
import profileData from './preparation_profiles.json' with { type: 'json' };

const _profiles = new Map<string, PreparationProfile>();

const _deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    _deepFreeze(nested);
  }
  return Object.freeze(value);
};

/**
 * Validates and registers a preparation profile.
 *
 * @throws Error on a schema violation, a duplicate id, a pixel-art profile that
 *         resamples with a blending method, or a profile with no encode step.
 */
export const registerPreparationProfile = (raw: unknown): PreparationProfile => {
  if (!Value.Check(PreparationProfileListSchema.items, raw)) {
    const first = [...Value.Errors(PreparationProfileListSchema.items, raw)][0];
    throw new Error(
      `Invalid preparation profile: ${first ? `${first.instancePath || '/'}: ${first.message}` : 'unknown schema error'}`,
    );
  }
  const profile = raw as PreparationProfile;

  if (profile.pixelGrid === 'pixel-art') {
    for (const operation of profile.operations) {
      if (operation.op === 'resample' && operation.method !== 'nearest-neighbor') {
        throw new Error(
          `Preparation profile "${profile.id}" declares the pixel-art grid but resamples with "${operation.method}" — a true pixel cluster must use nearest-neighbor, and blending cannot be undone`,
        );
      }
    }
  }

  if (!profile.operations.some((operation) => operation.op === 'encode')) {
    throw new Error(
      `Preparation profile "${profile.id}" has no encode step — the prepared artifact would have no declared container format`,
    );
  }

  if (_profiles.has(profile.id)) {
    throw new Error(`Duplicate preparation profile id "${profile.id}"`);
  }
  const snapshot = _deepFreeze(structuredClone(profile));
  _profiles.set(snapshot.id, snapshot);
  return snapshot;
};

/** Every registered preparation profile, in registration order. */
export const listPreparationProfiles = (): readonly PreparationProfile[] => [..._profiles.values()];

/** Looks up a preparation profile by id. */
export const getPreparationProfile = (id: string): PreparationProfile | undefined =>
  _profiles.get(id);

/**
 * Looks up a preparation profile, failing loudly when unknown.
 *
 * @throws Error listing the known profile ids.
 */
export const requirePreparationProfile = (id: string): PreparationProfile => {
  const profile = _profiles.get(id);
  if (!profile) {
    throw new Error(
      `Unknown preparation profile "${id}" — known profiles: ${[..._profiles.keys()].join(', ') || '(none)'}`,
    );
  }
  return profile;
};

/** The container extension a profile's encode step produces. */
export const encodeExtensionForProfile = (profile: PreparationProfile): string => {
  const encode = profile.operations.find((operation) => operation.op === 'encode');
  if (encode?.op !== 'encode') {
    throw new Error(
      `Preparation profile "${profile.id}" declares no encode step, so it has no output extension`,
    );
  }
  return encode.format === 'png' ? '.png' : '.webp';
};

/** The profile used when a caller names none — an already-transparent prop. */
export const DEFAULT_PREPARATION_PROFILE_ID: string = PREPARATION_PROFILE_IDS.propNativeAlpha;

// Seed the registry from the data file. A malformed entry throws at import
// time — a broken profile must never reach a call site.
for (const entry of profileData as readonly unknown[]) {
  registerPreparationProfile(entry);
}
