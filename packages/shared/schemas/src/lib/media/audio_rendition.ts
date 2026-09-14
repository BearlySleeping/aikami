// packages/shared/schemas/src/lib/media/audio_rendition.ts
//
// C-521: the rendition record for generated or imported audio — one
// content-addressed file plus the measurements taken from its *decoded* bytes.
//
// This is the audio sibling of C-520's image rendition record: a master
// (archival lossless) plus the runtime renditions finished from it, each with
// its own hash, its own decoded metadata and its own findings. A rendition's
// `parentMasterHash` is the lineage edge; the master is its own parent.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { type Static, Type } from 'typebox';
import { GenerationSha256Schema } from '../generation/hash.ts';

/** Every finishing profile this contract can declare. */
export const AUDIO_RENDITION_PROFILE_IDS = [
  /** Archival lossless master — the unmodified decoded source. */
  'archival_master',
  /** Music runtime rendition: 48 kHz stereo, lossy, loop-safe. */
  'music_runtime',
  /** Ambience runtime rendition: quieter target, 48 kHz stereo. */
  'ambient_runtime',
  /** Short positional SFX: PCM WAV mono at the runtime sample rate. */
  'sfx_positional',
  /** Declared stereo UI/effect rendition (explicit, never implied). */
  'ui_stereo',
] as const;

/** A declared finishing profile id. */
export type AudioRenditionProfileId = (typeof AUDIO_RENDITION_PROFILE_IDS)[number];

/** Container formats a rendition may carry. */
export const AUDIO_CONTAINERS = ['wav', 'webm', 'ogg', 'flac', 'mp3', 'm4a', 'aac'] as const;

/** A rendition container. */
export type AudioContainer = (typeof AUDIO_CONTAINERS)[number];

/** Codecs a rendition may carry. */
export const AUDIO_CODECS = [
  'pcm_u8',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_f64le',
  'opus',
  'vorbis',
  'flac',
  'mp3',
  'aac',
] as const;

/** A rendition codec. */
export type AudioCodec = (typeof AUDIO_CODECS)[number];

/**
 * Every finding the audio analyser can raise.
 *
 * Codes are stable identifiers — a refusal or a CI failure names one of these
 * rather than a prose sentence, so a caller can branch on it.
 */
export const AUDIO_FINDING_CODES = [
  /** The decoded clip carries no frames at all. */
  'empty_clip',
  /** The container declares more audio than the file actually holds. */
  'truncated_clip',
  /** NaN/Infinity samples were decoded. */
  'nonfinite_samples',
  /** Samples at or beyond full scale (flat-topped or inter-sample clips). */
  'clipping',
  /** Mean sample value far from zero on at least one channel. */
  'dc_offset',
  /** The clip is mostly silence, or carries a long silent tail. */
  'excessive_silence',
  /** A near-silent master was about to be normalised into a loud effect. */
  'near_silent_master',
  /** Measured integrated loudness is outside the profile's declared window. */
  'loudness_out_of_tolerance',
  /** Measured true peak is above the profile's declared ceiling. */
  'true_peak_exceeded',
  /** The bytes are not a container/codec this project can decode. */
  'unsupported_format',
  /** The bytes could not be decoded at all. */
  'decode_failed',
  /** Authored loop bounds are missing, inverted or outside the decoded clip. */
  'invalid_loop_bounds',
  /** Loop bounds do not sit on a quiet musical boundary. */
  'loop_seam_mismatch',
  /** Decoded duration is outside the profile's declared bounds. */
  'duration_out_of_bounds',
  /** Decoded channel count is outside the profile's declared bounds. */
  'channel_count_out_of_bounds',
  /** Decoded sample rate is outside the profile's declared bounds. */
  'sample_rate_out_of_bounds',
  /** The encoded rendition exceeds the installed catalog's size ceiling. */
  'output_size_out_of_bounds',
  /** The installed catalog does not accept this container extension. */
  'container_not_installable',
] as const;

/** A stable audio finding code. */
export type AudioFindingCode = (typeof AUDIO_FINDING_CODES)[number];

/** How a finding is treated: `error` fails the rendition, `warning` notes it. */
export const AUDIO_FINDING_SEVERITIES = ['error', 'warning'] as const;

/** A finding severity. */
export type AudioFindingSeverity = (typeof AUDIO_FINDING_SEVERITIES)[number];

/** One measured or structural finding about a decoded audio rendition. */
export const AudioFindingSchema = Type.Object({
  code: Type.Enum(AUDIO_FINDING_CODES),
  severity: Type.Enum(AUDIO_FINDING_SEVERITIES),
  /** Human-readable detail; never a prompt, a path or a credential. */
  detail: Type.String({ minLength: 1 }),
  /** The measured value that triggered the finding, when there is one. */
  measured: Type.Optional(Type.Number()),
  /** The declared bound the measurement was compared against. */
  limit: Type.Optional(Type.Number()),
});

/** A finding, as validated. */
export type AudioFinding = Static<typeof AudioFindingSchema>;

/**
 * Measurements taken from decoded samples.
 *
 * `integratedLufs` and `truePeakDb` are `null` when the clip is too short or
 * too quiet for the measurement to mean anything — never fabricated, never
 * reported as `-Infinity`.
 */
export const AudioAnalysisSchema = Type.Object({
  /** ITU-R BS.1770-4 gated integrated loudness. */
  integratedLufs: Type.Union([Type.Number(), Type.Null()]),
  /** True peak (4x oversampled), in dBTP. */
  truePeakDb: Type.Union([Type.Number(), Type.Null()]),
  /** Raw sample peak, in dBFS — kept separate from the true peak. */
  samplePeakDb: Type.Union([Type.Number(), Type.Null()]),
  /** RMS over the whole decoded clip, in dBFS. */
  rmsDbfs: Type.Union([Type.Number(), Type.Null()]),
  /** Largest absolute per-channel mean (DC offset). */
  dcOffset: Type.Number(),
  /** Count of samples at or beyond full scale. */
  clippedSampleCount: Type.Integer({ minimum: 0 }),
  /** Count of NaN/Infinity samples. */
  nonfiniteSampleCount: Type.Integer({ minimum: 0 }),
  /** Fraction of frames below the silence threshold (0-1). */
  silenceRatio: Type.Number({ minimum: 0, maximum: 1 }),
  /** Length of the trailing silent run, in seconds. */
  silenceTailSeconds: Type.Number({ minimum: 0 }),
});

/** Decoded-sample measurements. */
export type AudioAnalysis = Static<typeof AudioAnalysisSchema>;

/** Authored loop bounds, expressed in samples of the *decoded* rendition. */
export const AudioLoopBoundsSchema = Type.Object({
  loopStartSample: Type.Integer({ minimum: 0 }),
  loopEndSample: Type.Integer({ minimum: 1 }),
  /** Crossfade window applied at the seam, in samples (0 = hard cut). */
  crossfadeSamples: Type.Optional(Type.Integer({ minimum: 0 })),
  /** How many repeats were auditioned before acceptance. */
  repeatsAuditioned: Type.Optional(Type.Integer({ minimum: 0 })),
});

/** Authored loop bounds. */
export type AudioLoopBounds = Static<typeof AudioLoopBoundsSchema>;

/** One finished, content-addressed audio rendition. */
export const AudioRenditionSchema = Type.Object({
  /** Stable id of this rendition inside its bundle (profile id + hash prefix). */
  renditionId: Type.String({ minLength: 1 }),
  profileId: Type.Enum(AUDIO_RENDITION_PROFILE_IDS),
  /** SHA-256 of the rendition bytes, hex. */
  contentHash: GenerationSha256Schema,
  container: Type.Enum(AUDIO_CONTAINERS),
  codec: Type.Enum(AUDIO_CODECS),
  mimeType: Type.String({ minLength: 1 }),
  extension: Type.String({ minLength: 1 }),
  byteLength: Type.Integer({ minimum: 0 }),
  // ── decoded facts, never file-header or provider claims ────────────────
  sampleRate: Type.Integer({ minimum: 0 }),
  channels: Type.Integer({ minimum: 0 }),
  sampleCount: Type.Integer({ minimum: 0 }),
  durationSeconds: Type.Number({ minimum: 0 }),
  analysis: AudioAnalysisSchema,
  /** Authored loop bounds; absent for one-shots and non-looping masters. */
  loop: Type.Optional(AudioLoopBoundsSchema),
  /** True only when authored bounds exist and were validated. */
  loopable: Type.Boolean(),
  /** SHA-256 of the master this rendition was finished from. */
  parentMasterHash: GenerationSha256Schema,
  /** Every finding raised while analysing this rendition. */
  findings: Type.Array(AudioFindingSchema),
  createdAt: Type.String({ minLength: 1 }),
});

/** A finished audio rendition. */
export type AudioRendition = Static<typeof AudioRenditionSchema>;

/** One master and the renditions finished from it. */
export const AudioRenditionBundleSchema = Type.Object({
  /** SHA-256 of the archival master. */
  masterHash: GenerationSha256Schema,
  /** The intended runtime profile for this cue. */
  cueProfileId: Type.Enum(AUDIO_RENDITION_PROFILE_IDS),
  renditions: Type.Array(AudioRenditionSchema),
});

/** A master plus its renditions. */
export type AudioRenditionBundle = Static<typeof AudioRenditionBundleSchema>;

/**
 * Why audio generation was refused.
 *
 * A refusal is a *typed* outcome — "no license-eligible SFX model is
 * installed" is a result, not a crash, and never a silent fall back to the
 * music model.
 */
export const AUDIO_GENERATION_REFUSAL_CODES = [
  /** No audio engine is configured for this session. */
  'engine_not_configured',
  /** The configured engine did not answer its health probe. */
  'engine_unreachable',
  /** The recipe's modality has no registered adapter. */
  'no_engine_registered',
  /** The requested profile is declared but not shipped on this host. */
  'profile_unavailable',
  /** The profile needs a model whose licence/intended-use decision is open. */
  'model_license_undecided',
  /** The engine does not expose a capability the recipe requires. */
  'capability_unsupported',
  /** A feature flag turned new generation off (playback is unaffected). */
  'feature_disabled',
  /** Finishing refused the produced master (see findings). */
  'master_rejected',
] as const;

/** A typed audio generation refusal code. */
export type AudioGenerationRefusalCode = (typeof AUDIO_GENERATION_REFUSAL_CODES)[number];

/** A typed refusal to generate audio. */
export const AudioGenerationRefusalSchema = Type.Object({
  code: Type.Enum(AUDIO_GENERATION_REFUSAL_CODES),
  /** User-facing explanation. Never contains a prompt, path or secret. */
  message: Type.String({ minLength: 1 }),
  modality: Type.Literal('audio'),
  /** The profile that was requested, when one was named. */
  profileId: Type.Optional(Type.String({ minLength: 1 })),
  /** The findings that caused a `master_rejected` refusal. */
  findings: Type.Optional(Type.Array(AudioFindingSchema)),
});

/** A typed refusal to generate audio. */
export type AudioGenerationRefusal = Static<typeof AudioGenerationRefusalSchema>;
