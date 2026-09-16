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
// Selection is pure: the caller supplies the renditions installed on this
// device (tag + content hash), so every branch (bound / declared fallback /
// silence / unbound) is testable without a filesystem, a registry or an
// AudioContext. A tag alone is availability metadata, not proof of the bytes:
// when the caller provides the installed hash it must equal the declared one,
// and a mismatched primary is treated as a miss so its declared fallback runs.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { checkPackAudioBindings, PackAudioBindingsSchema } from '@aikami/schemas';
import type {
  AudioCueTarget,
  PackAudioBindingIssue,
  PackAudioBindings,
  PackAudioCueBinding,
} from '@aikami/types';
import { Value } from 'typebox/value';

/** How a cue selection resolved. */
type AudioCueSelectionKind =
  /** The declared rendition is installed (and, when known, hash-matches) — play it. */
  | 'bound'
  /** The declared rendition is missing; the declared fallback cue is installed. */
  | 'fallback-cue'
  /** The cue resolves to declared silence — play nothing. */
  | 'silence'
  /** The pack authors nothing for this (target, context) — keep tag-first behavior. */
  | 'unbound';

/** Why a declared cue could not be played. */
type AudioCueMissReason = 'missing' | 'hash-mismatch';

/** The outcome of selecting a cue for one (target, context) pair. */
type AudioCueSelection = {
  kind: AudioCueSelectionKind;
  /** The binding to play, when `kind` is `bound` or `fallback-cue`. */
  binding: PackAudioCueBinding | undefined;
  /** Whether the pack declares this cue as `required`. */
  required: boolean;
  /** Why the declared cue was not played, when it was not. */
  miss?: AudioCueMissReason;
};

/** One audio rendition installed on this device. */
type InstalledAudioRendition = {
  /** Exact registry tag. */
  tag: string;
  /** SHA-256 of the installed bytes, when the source can provide it. */
  sha256?: string;
};

/** The result of inspecting an untrusted manifest `audio` value. */
type PackAudioBindingsInspection =
  | { status: 'absent' }
  | {
      status: 'invalid';
      /** Semantic issues, when the shape was structurally valid. */
      issues: readonly PackAudioBindingIssue[];
      /** True when the value failed structural validation (no issues to report). */
      structural: boolean;
    }
  | { status: 'valid'; bindings: PackAudioBindings };

/** Normalizes a registry tag for exact comparison. */
const normalizeTag = (tag: string): string => tag.trim().toLowerCase();

/** Normalizes a hex hash for comparison. */
const normalizeHash = (hash: string): string => hash.trim().toLowerCase();

/**
 * Inspects an untrusted `audio` value from a content pack manifest.
 *
 * Returns `absent` for a missing section, `invalid` for a structurally or
 * semantically broken one, and `valid` only when both pass. This is what lets
 * a caller distinguish "the pack authors nothing here" from "the pack's
 * authored data is broken" — the two must not collapse into the same no-op.
 *
 * @param raw - The manifest's `audio` value, if any.
 * @returns The inspection, never throwing.
 */
export const inspectPackAudioBindings = (raw: unknown): PackAudioBindingsInspection => {
  if (raw === undefined || raw === null) {
    return { status: 'absent' };
  }
  if (!Value.Check(PackAudioBindingsSchema, raw)) {
    return { status: 'invalid', issues: [], structural: true };
  }
  const bindings = raw as PackAudioBindings;
  const issues = checkPackAudioBindings(bindings);
  if (issues.length > 0) {
    return { status: 'invalid', issues, structural: false };
  }
  return { status: 'valid', bindings };
};

/**
 * Parses an untrusted `audio` value from a content pack manifest.
 *
 * Returns `undefined` for a missing, malformed or semantically incoherent
 * section instead of throwing: the section is optional and inert, and a pack
 * that fails this parse is reported by `validatePack`. Callers that need to
 * distinguish an absent section from a broken one use
 * {@link inspectPackAudioBindings}.
 *
 * @param raw - The manifest's `audio` value, if any.
 * @returns The validated section, or `undefined`.
 */
export const parsePackAudioBindings = (raw: unknown): PackAudioBindings | undefined => {
  const inspection = inspectPackAudioBindings(raw);
  return inspection.status === 'valid' ? inspection.bindings : undefined;
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
 * True when the declared rendition is installed, and — when the installed
 * source reports a hash — its bytes match the declared `sha256`.
 *
 * A tag match with a different hash is a miss: availability metadata is not
 * proof of the installed bytes, so the declared fallback must run rather than
 * playing corrupt or stale content.
 */
const isRenditionInstalled = (options: {
  binding: PackAudioCueBinding;
  installedRenditions: readonly InstalledAudioRendition[];
}): { installed: boolean; miss?: AudioCueMissReason } => {
  const declared = normalizeTag(options.binding.tag);
  const candidate = options.installedRenditions.find(
    (rendition) => normalizeTag(rendition.tag) === declared,
  );
  if (!candidate) {
    return { installed: false, miss: 'missing' };
  }
  if (
    candidate.sha256 !== undefined &&
    normalizeHash(candidate.sha256) !== normalizeHash(options.binding.sha256)
  ) {
    return { installed: false, miss: 'hash-mismatch' };
  }
  return { installed: true };
};

/**
 * Selects the cue for a (target, context) pair.
 *
 * @param options.bindings - The pack's authored section, if any.
 * @param options.target - Which bus the caller wants.
 * @param options.context - Map id, `combat`, or a scripted predicate id.
 * @param options.installedRenditions - Audio renditions installed on this device.
 * @returns The selection, including the declared fallback on a miss.
 */
export const selectAudioCue = (options: {
  bindings: PackAudioBindings | undefined;
  target: AudioCueTarget;
  context: string;
  installedRenditions: readonly InstalledAudioRendition[];
}): AudioCueSelection => {
  const { bindings, target, context, installedRenditions } = options;

  const binding = findAudioCueBinding({ bindings, target, context });
  if (!binding) {
    return { kind: 'unbound', binding: undefined, required: false };
  }

  const primary = isRenditionInstalled({ binding, installedRenditions });
  if (primary.installed) {
    return { kind: 'bound', binding, required: binding.resolution === 'required' };
  }

  // Cue miss. The declared fallback is the only permitted alternative — never
  // unrelated content. The fallback is verified independently against its own
  // declared identity/hash.
  if (binding.fallback === 'declared_cue' && binding.fallbackCueId) {
    const fallbackBinding = bindings?.bindings.find(
      (candidate) => candidate.cueId === binding.fallbackCueId,
    );
    if (
      fallbackBinding &&
      isRenditionInstalled({ binding: fallbackBinding, installedRenditions }).installed
    ) {
      return {
        kind: 'fallback-cue',
        binding: fallbackBinding,
        required: binding.resolution === 'required',
      };
    }
  }

  return {
    kind: 'silence',
    binding: undefined,
    required: binding.resolution === 'required',
    miss: primary.miss,
  };
};
