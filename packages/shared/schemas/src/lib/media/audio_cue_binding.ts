// packages/shared/schemas/src/lib/media/audio_cue_binding.ts
//
// C-523: versioned pack audio cue bindings.
//
// A content pack may author *which* accepted audio rendition plays for a
// specific map/context, instead of relying on the resolver's generic
// "first manifest entry whose tags overlap" heuristic. Each binding names a
// stable `cueId`, a `target` bus, a `context` (a map id, `combat`, or a
// scripted predicate id), and a `source` — either the registry `tag` plus the
// SHA-256 of the accepted rendition's bytes, or an explicit declaration that
// the cue plays nothing.
//
// The `source` distinction is deliberate. A SHA-256 asserts something about
// immutable bytes, so a binding may only carry one when those bytes exist. A
// cue the pack leaves silent has no bytes and therefore no asset identity; it
// must not name a tag or pin a hash for content that was never produced.
//
// The section is optional and versioned (`pack.audio.v1`): a manifest without
// an `audio` key keeps loading unchanged, and the absence of the section is
// itself the kill switch — no redeploy is needed to fall back to the current
// tag-first resolver.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { type Static, Type } from 'typebox';
import { GenerationSha256Schema } from '../generation/hash.ts';

/** Which bus an authored cue plays on. */
export const AUDIO_CUE_TARGETS = ['music', 'ambient', 'sfx'] as const;

/** An authored cue target bus. */
export type AudioCueTarget = (typeof AUDIO_CUE_TARGETS)[number];

/**
 * Whether a cue must resolve for the pack to validate.
 *
 * `required` cues that cannot resolve fail pack validation loudly; `optional`
 * cues degrade through their declared `fallback` instead.
 */
export const AUDIO_CUE_RESOLUTIONS = ['required', 'optional'] as const;

/** An authored cue resolution requirement. */
export type AudioCueResolution = (typeof AUDIO_CUE_RESOLUTIONS)[number];

/**
 * Declared behavior when a cue cannot resolve.
 *
 * `silence` is an explicit no-op; `declared_cue` plays the binding named by
 * `fallbackCueId`. Neither ever falls through to unrelated random content.
 */
export const AUDIO_CUE_FALLBACKS = ['silence', 'declared_cue'] as const;

/** An authored cue-miss fallback. */
export type AudioCueFallback = (typeof AUDIO_CUE_FALLBACKS)[number];

/** The current pack audio-binding schema version. */
export const PACK_AUDIO_BINDINGS_SCHEMA_VERSION = 'pack.audio.v1' as const;

/**
 * Where a cue's bytes come from.
 *
 * A SHA-256 is an assertion about immutable bytes, so a binding may only carry
 * one when bytes actually exist. A cue the pack deliberately leaves silent has
 * no bytes and therefore no asset identity — it must not name a tag or pin a
 * hash for content that was never produced.
 */
export const AUDIO_CUE_SOURCE_KINDS = ['asset', 'silence'] as const;

/** How a cue sources its bytes. */
export type AudioCueSourceKind = (typeof AUDIO_CUE_SOURCE_KINDS)[number];

/**
 * An asset-backed cue source: real, publishable bytes.
 *
 * `tag` and `sha256` are both required. A tag alone is availability metadata,
 * not proof of the bytes, and a hash without a tag names nothing.
 */
export const AudioAssetSourceSchema = Type.Object(
  {
    kind: Type.Literal('asset'),
    /** Registry tag of the accepted rendition (never a first-match tag). */
    tag: Type.String({ minLength: 1 }),
    /** SHA-256 of the installed rendition bytes; the cue-miss check. */
    sha256: GenerationSha256Schema,
  },
  { additionalProperties: false },
);

/** An asset-backed cue source, as validated. */
export type AudioAssetSource = Static<typeof AudioAssetSourceSchema>;

/**
 * An intentional-silence cue source: no bytes exist and none are claimed.
 *
 * `additionalProperties: false` is load-bearing here. A silence source that
 * also carried a `tag` or `sha256` would be asserting bytes that do not exist,
 * which is exactly the dishonesty this shape exists to make unrepresentable.
 */
export const AudioSilenceSourceSchema = Type.Object(
  { kind: Type.Literal('silence') },
  { additionalProperties: false },
);

/** An intentional-silence cue source, as validated. */
export type AudioSilenceSource = Static<typeof AudioSilenceSourceSchema>;

/** A cue's byte source. */
export const AudioCueSourceSchema = Type.Union([AudioAssetSourceSchema, AudioSilenceSourceSchema]);

/** A cue's byte source, as validated. */
export type AudioCueSource = Static<typeof AudioCueSourceSchema>;

/**
 * An asset-backed cue binding.
 *
 * `additionalProperties: false` — an unknown key is a typo in an authored
 * pack field, and silently ignoring it is exactly the failure mode this
 * section exists to prevent.
 */
export const AudioAssetCueBindingSchema = Type.Object(
  {
    /** Authored cue identity — stable across repacks. */
    cueId: Type.String({ minLength: 1 }),
    /** Which bus the cue plays on. */
    target: Type.Enum(AUDIO_CUE_TARGETS),
    /** Map id, or `combat`, or a scripted predicate id. */
    context: Type.String({ minLength: 1 }),
    /** The accepted rendition's tag and hash. */
    source: AudioAssetSourceSchema,
    /** `required` cues must resolve or the pack fails validation. */
    resolution: Type.Enum(AUDIO_CUE_RESOLUTIONS),
    /** Declared behavior when the cue cannot resolve. */
    fallback: Type.Enum(AUDIO_CUE_FALLBACKS),
    /** The cue to play when `fallback` is `declared_cue`. */
    fallbackCueId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/**
 * An intentional-silence cue binding.
 *
 * The `resolution`/`fallback` literals are structural, not conventional: a cue
 * with no bytes can never be `required` (nothing could satisfy it) and can only
 * degrade to `silence`. Encoding that here makes `required` + silence and
 * silence + `declared_cue` unrepresentable rather than merely discouraged.
 */
export const AudioSilenceCueBindingSchema = Type.Object(
  {
    /** Authored cue identity — stable across repacks. */
    cueId: Type.String({ minLength: 1 }),
    /** Which bus the cue plays on. */
    target: Type.Enum(AUDIO_CUE_TARGETS),
    /** Map id, or `combat`, or a scripted predicate id. */
    context: Type.String({ minLength: 1 }),
    /** No bytes exist for this cue. */
    source: AudioSilenceSourceSchema,
    /** A cue with no bytes can never be required. */
    resolution: Type.Literal('optional'),
    /** A cue with no bytes can only degrade to silence. */
    fallback: Type.Literal('silence'),
  },
  { additionalProperties: false },
);

/**
 * One authored cue binding.
 *
 * A union rather than one object with optional fields, so the asset/silence
 * distinction is checked by the schema instead of by convention.
 */
export const PackAudioCueBindingSchema = Type.Union([
  AudioAssetCueBindingSchema,
  AudioSilenceCueBindingSchema,
]);

/** An authored cue binding, as validated. */
export type PackAudioCueBinding = Static<typeof PackAudioCueBindingSchema>;

/** An authored cue binding that names real bytes. */
export type AudioAssetCueBinding = Static<typeof AudioAssetCueBindingSchema>;

/** An authored cue binding that intentionally plays nothing. */
export type AudioSilenceCueBinding = Static<typeof AudioSilenceCueBindingSchema>;

/**
 * Narrows a binding to its asset form.
 *
 * A type predicate rather than a cast: callers that need the tag/hash must
 * handle the silence case explicitly, which is the whole point of the union.
 */
export const isAssetCueBinding = (binding: PackAudioCueBinding): binding is AudioAssetCueBinding =>
  binding.source.kind === 'asset';

/** The optional, versioned audio section of a content pack manifest. */
export const PackAudioBindingsSchema = Type.Object(
  {
    schemaVersion: Type.Literal(PACK_AUDIO_BINDINGS_SCHEMA_VERSION),
    bindings: Type.Array(PackAudioCueBindingSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

/** A pack's authored cue bindings. */
export type PackAudioBindings = Static<typeof PackAudioBindingsSchema>;

/**
 * Every semantic problem a set of authored bindings can carry.
 *
 * These are *structural* rules that TypeBox cannot express inside one object
 * schema — uniqueness across the array, and cross-binding references.
 */
export const PACK_AUDIO_BINDING_ISSUE_CODES = [
  /** Two bindings share a `cueId` — cue identity must be unambiguous. */
  'audio.duplicate-cue-id',
  /** Two bindings claim the same `(target, context)` pair — selection is ambiguous. */
  'audio.duplicate-target-context',
  /** A `declared_cue` fallback names a `cueId` no binding declares. */
  'audio.fallback-cue-missing',
  /** A `declared_cue` fallback names its own `cueId` — an infinite loop. */
  'audio.fallback-self-reference',
  /** A `declared_cue` fallback names a cue on a different bus than the original. */
  'audio.fallback-target-mismatch',
  /** Following `declared_cue` fallbacks from this cue loops back on itself. */
  'audio.fallback-cycle',
] as const;

/** A stable pack-audio binding issue code. */
export type PackAudioBindingIssueCode = (typeof PACK_AUDIO_BINDING_ISSUE_CODES)[number];

/** One semantic problem with a set of authored bindings. */
export type PackAudioBindingIssue = {
  code: PackAudioBindingIssueCode;
  /** JSON pointer into the `audio` section. */
  path: string;
  /** Human-readable description. */
  message: string;
};

/**
 * Checks the semantic rules TypeBox cannot express for authored cue bindings.
 *
 * Returns an empty array when the bindings are coherent. Pure — no I/O, no
 * logger — so both the CI validator and the client loader can call it.
 *
 * @param bindings - A schema-validated `pack.audio.v1` section.
 * @returns Every issue found, in declaration order.
 */
export const checkPackAudioBindings = (bindings: PackAudioBindings): PackAudioBindingIssue[] => {
  const issues: PackAudioBindingIssue[] = [];
  const seenCueIds = new Map<string, number>();
  const seenTargetContexts = new Map<string, number>();

  for (const [index, binding] of bindings.bindings.entries()) {
    const basePath = `/audio/bindings/${index}`;

    const priorCueIndex = seenCueIds.get(binding.cueId);
    if (priorCueIndex !== undefined) {
      issues.push({
        code: 'audio.duplicate-cue-id',
        path: `${basePath}/cueId`,
        message: `Cue id "${binding.cueId}" is already declared at index ${priorCueIndex}; cue identity must be unique.`,
      });
    } else {
      seenCueIds.set(binding.cueId, index);
    }

    const targetContextKey = `${binding.target}\u0000${binding.context}`;
    const priorContextIndex = seenTargetContexts.get(targetContextKey);
    if (priorContextIndex !== undefined) {
      issues.push({
        code: 'audio.duplicate-target-context',
        path: `${basePath}/context`,
        message: `Target "${binding.target}" already binds context "${binding.context}" at index ${priorContextIndex}; selection would be ambiguous.`,
      });
    } else {
      seenTargetContexts.set(targetContextKey, index);
    }
  }

  const byCueId = new Map(bindings.bindings.map((binding) => [binding.cueId, binding]));

  /**
   * Walks the `declared_cue` chain from `start` and reports whether it loops
   * back on a cue already visited. Bounded by the binding count, so a
   * self-consistent pack can never make this run forever.
   */
  const reachesCycle = (start: PackAudioCueBinding): boolean => {
    const visited = new Set<string>();
    let current: PackAudioCueBinding | undefined = start;
    while (current) {
      if (visited.has(current.cueId)) {
        return true;
      }
      visited.add(current.cueId);
      if (current.fallback !== 'declared_cue' || !current.fallbackCueId) {
        return false;
      }
      current = byCueId.get(current.fallbackCueId);
    }
    return false;
  };

  for (const [index, binding] of bindings.bindings.entries()) {
    if (binding.fallback !== 'declared_cue') {
      continue;
    }
    const basePath = `/audio/bindings/${index}`;

    if (!binding.fallbackCueId) {
      issues.push({
        code: 'audio.fallback-cue-missing',
        path: `${basePath}/fallbackCueId`,
        message: `Cue "${binding.cueId}" declares a declared_cue fallback but names no fallbackCueId.`,
      });
      continue;
    }

    if (binding.fallbackCueId === binding.cueId) {
      issues.push({
        code: 'audio.fallback-self-reference',
        path: `${basePath}/fallbackCueId`,
        message: `Cue "${binding.cueId}" declares itself as its own fallback; set fallbackCueId to a different cueId declared in the same audio section.`,
      });
      continue;
    }

    const fallback = byCueId.get(binding.fallbackCueId);
    if (!fallback) {
      issues.push({
        code: 'audio.fallback-cue-missing',
        path: `${basePath}/fallbackCueId`,
        message: `Cue "${binding.cueId}" falls back to unknown cue "${binding.fallbackCueId}".`,
      });
      continue;
    }

    if (fallback.target !== binding.target) {
      issues.push({
        code: 'audio.fallback-target-mismatch',
        path: `${basePath}/fallbackCueId`,
        message: `Cue "${binding.cueId}" is on the "${binding.target}" bus but falls back to "${fallback.cueId}" on the "${fallback.target}" bus; a fallback must stay on the same bus.`,
      });
      continue;
    }

    if (reachesCycle(binding)) {
      issues.push({
        code: 'audio.fallback-cycle',
        path: `${basePath}/fallbackCueId`,
        message: `Cue "${binding.cueId}" follows declared_cue fallbacks in a cycle; a fallback chain must terminate.`,
      });
    }
  }

  return issues;
};
