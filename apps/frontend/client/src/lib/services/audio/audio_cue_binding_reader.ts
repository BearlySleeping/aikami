// apps/frontend/client/src/lib/services/audio/audio_cue_binding_reader.ts
//
// C-523 AC-3 — reads the optional `pack.audio.v1` section and selects the cue
// a map/context actually declares.
//
// Before this contract the resolver matched a scene to *any* track whose tags
// overlapped (`findEntryByTags`, first-array-match). That is fine for generic
// curated music and stays in place for it — but it cannot express "the ruined
// shrine plays this specific cue", and a miss silently played unrelated
// content. An authored binding replaces that with a declared identity:
//
//   (target, context) -> declared registry tag + expected SHA-256
//
// Selection is pure: the caller supplies the tags installed on this device,
// so every branch (bound / declared fallback / silence / unbound) is testable
// without a filesystem, a registry or an AudioContext.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { PackAudioBindingsSchema } from '@aikami/schemas';
import type { AudioCueTarget, PackAudioBindings, PackAudioCueBinding } from '@aikami/types';
import { Value } from 'typebox/value';

/** How a cue selection resolved. */
type AudioCueSelectionKind =
  /** The declared rendition is installed — play it. */
  | 'bound'
  /** The declared rendition is missing; the declared fallback cue is installed. */
  | 'fallback-cue'
  /** The cue resolves to declared silence — play nothing. */
  | 'silence'
  /** The pack authors nothing for this (target, context) — keep tag-first behavior. */
  | 'unbound';

/** The outcome of selecting a cue for one (target, context) pair. */
type AudioCueSelection = {
  kind: AudioCueSelectionKind;
  /** The binding to play, when `kind` is `bound` or `fallback-cue`. */
  binding: PackAudioCueBinding | undefined;
  /** Whether the pack declares this cue as `required`. */
  required: boolean;
};

/** Normalizes a registry tag for exact comparison. */
const normalizeTag = (tag: string): string => tag.trim().toLowerCase();

/**
 * Parses an untrusted `audio` value from a content pack manifest.
 *
 * Returns `undefined` for a missing or malformed section instead of throwing:
 * the section is optional and inert, and a pack that fails this parse is
 * reported by `validatePack`, not by a crash on the boot path.
 *
 * @param raw - The manifest's `audio` value, if any.
 * @returns The validated section, or `undefined`.
 */
export const parsePackAudioBindings = (raw: unknown): PackAudioBindings | undefined => {
  if (!Value.Check(PackAudioBindingsSchema, raw)) {
    return undefined;
  }
  return raw;
};

/**
 * Finds the authored binding for a (target, context) pair.
 *
 * At most one binding can match: `checkPackAudioBindings` rejects duplicates
 * at validation time, so this is a lookup — never a first-array-match.
 *
 * Module-private: `selectAudioCue` is the public entry point.
 */
const findAudioCueBinding = (options: {
  bindings: PackAudioBindings | undefined;
  target: AudioCueTarget;
  context: string;
}): PackAudioCueBinding | undefined => {
  const { bindings, target, context } = options;
  if (!bindings) {
    return undefined;
  }
  return bindings.bindings.find(
    (binding) => binding.target === target && binding.context === context,
  );
};

/**
 * True when the declared tag is installed on this device.
 *
 * Exact, case-insensitive equality — an authored cue names one specific
 * accepted rendition, so a same-segment sibling track is not a match.
 */
const isTagInstalled = (options: {
  declaredTag: string;
  availableTags: readonly string[];
}): boolean => {
  const declared = normalizeTag(options.declaredTag);
  return options.availableTags.some((candidate) => normalizeTag(candidate) === declared);
};

/**
 * Selects the cue for a (target, context) pair.
 *
 * @param options.bindings - The pack's authored section, if any.
 * @param options.target - Which bus the caller wants.
 * @param options.context - Map id, `combat`, or a scripted predicate id.
 * @param options.availableTags - Full registry tags installed on this device.
 * @returns The selection, including the declared fallback on a miss.
 */
export const selectAudioCue = (options: {
  bindings: PackAudioBindings | undefined;
  target: AudioCueTarget;
  context: string;
  availableTags: readonly string[];
}): AudioCueSelection => {
  const { bindings, target, context, availableTags } = options;

  const binding = findAudioCueBinding({ bindings, target, context });
  if (!binding) {
    return { kind: 'unbound', binding: undefined, required: false };
  }

  if (isTagInstalled({ declaredTag: binding.tag, availableTags })) {
    return { kind: 'bound', binding, required: binding.resolution === 'required' };
  }

  // Cue miss. The declared fallback is the only permitted alternative — never
  // unrelated content.
  if (binding.fallback === 'declared_cue' && binding.fallbackCueId) {
    const fallbackBinding = bindings?.bindings.find(
      (candidate) => candidate.cueId === binding.fallbackCueId,
    );
    if (fallbackBinding && isTagInstalled({ declaredTag: fallbackBinding.tag, availableTags })) {
      return {
        kind: 'fallback-cue',
        binding: fallbackBinding,
        required: binding.resolution === 'required',
      };
    }
  }

  return { kind: 'silence', binding: undefined, required: binding.resolution === 'required' };
};
