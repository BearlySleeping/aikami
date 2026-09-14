// packages/shared/local-ai/src/lib/audio/audio_rendition_profiles.ts
//
// C-521: the declared finishing profiles and the tolerance check that decides
// whether a rendition is accepted.
//
// The mix targets are *tunable project choices*, declared once here so the
// host finisher, the batch runner and the Studio all compare against the same
// numbers. Nothing in this module invents a measurement — it only judges
// measurements taken from decoded bytes.
//
// biome-ignore-all lint/style/useNamingConvention: the keys are the declared
// snake_case audio profile ids, which are the project vocabulary, not identifiers
// Contract: C-521 Music and SFX generation with audio preparation

import { AUDIO_EXTS, MAX_UPLOAD_SIZE } from '@aikami/constants';
import type { AudioFinding, AudioRendition, AudioRenditionProfileId } from '@aikami/types';

/** A declarable finishing profile. */
export type AudioRenditionProfile = {
  id: AudioRenditionProfileId;
  label: string;
  /** Container the finisher writes. */
  container: 'wav' | 'webm' | 'ogg';
  extension: '.wav' | '.webm' | '.ogg';
  codec: 'pcm_s16le' | 'pcm_f32le' | 'opus' | 'vorbis';
  /** Target sample rate, or `null` to keep the master's rate (archival only). */
  sampleRate: number | null;
  /** Target channel count, or `null` to keep the master's count (archival only). */
  channels: number | null;
  /**
   * Integrated-loudness target in LUFS, or `null` when this profile is not
   * normalised by integrated loudness (archival masters and short SFX, which
   * are calibrated by peak/RMS instead — BS.1770 gating is meaningless over
   * a 300 ms one-shot).
   */
  loudnessTargetLufs: number | null;
  /** Half-width of the accepted loudness window, in LU. */
  loudnessToleranceLu: number;
  /**
   * RMS target/band used for profiles whose loudness is calibrated by
   * listening rather than by gated integrated loudness.
   */
  rmsTargetDbfs: number | null;
  rmsToleranceDb: number;
  /** True-peak ceiling in dBTP, or `null` when the profile declares none. */
  truePeakCeilingDbtp: number | null;
  /** Opus/Vorbis bitrate, when the codec is lossy. */
  bitrateKbps?: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** Whether this profile is a loop candidate (music/ambience, not one-shots). */
  loopable: boolean;
  /** True for the archival lossless master — never normalised, never encoded. */
  archival: boolean;
};

/**
 * The declared profiles.
 *
 * Opus is delivered inside `.webm` because the installed catalog's
 * `AUDIO_EXTS` lists `.webm` but no bare `.opus`/`.oga` — widening that
 * constant would be a catalog migration, and the legacy converter already
 * ships Opus-in-WebM.
 */
export const AUDIO_RENDITION_PROFILES: Readonly<
  Record<AudioRenditionProfileId, AudioRenditionProfile>
> = {
  archival_master: {
    id: 'archival_master',
    label: 'Archival lossless master',
    container: 'wav',
    extension: '.wav',
    codec: 'pcm_f32le',
    sampleRate: null,
    channels: null,
    loudnessTargetLufs: null,
    loudnessToleranceLu: 0,
    rmsTargetDbfs: null,
    rmsToleranceDb: 0,
    truePeakCeilingDbtp: null,
    minDurationSeconds: 0,
    maxDurationSeconds: 3600,
    loopable: true,
    archival: true,
  },
  music_runtime: {
    id: 'music_runtime',
    label: 'Music runtime (48 kHz stereo Opus in WebM)',
    container: 'webm',
    extension: '.webm',
    codec: 'opus',
    sampleRate: 48_000,
    channels: 2,
    loudnessTargetLufs: -18,
    loudnessToleranceLu: 2,
    rmsTargetDbfs: null,
    rmsToleranceDb: 0,
    truePeakCeilingDbtp: -1,
    bitrateKbps: 128,
    minDurationSeconds: 1,
    maxDurationSeconds: 3600,
    loopable: true,
    archival: false,
  },
  ambient_runtime: {
    id: 'ambient_runtime',
    label: 'Ambience runtime (48 kHz stereo Opus in WebM)',
    container: 'webm',
    extension: '.webm',
    codec: 'opus',
    sampleRate: 48_000,
    channels: 2,
    loudnessTargetLufs: -24,
    loudnessToleranceLu: 3,
    rmsTargetDbfs: null,
    rmsToleranceDb: 0,
    truePeakCeilingDbtp: -1,
    bitrateKbps: 96,
    minDurationSeconds: 1,
    maxDurationSeconds: 3600,
    loopable: true,
    archival: false,
  },
  sfx_positional: {
    id: 'sfx_positional',
    label: 'Positional one-shot (48 kHz mono PCM WAV)',
    container: 'wav',
    extension: '.wav',
    codec: 'pcm_s16le',
    sampleRate: 48_000,
    channels: 1,
    // A 300 ms gate-slam has no meaningful gated integrated loudness; it is
    // calibrated by peak/RMS listening instead.
    loudnessTargetLufs: null,
    loudnessToleranceLu: 0,
    rmsTargetDbfs: -20,
    rmsToleranceDb: 6,
    truePeakCeilingDbtp: -1,
    minDurationSeconds: 0.02,
    maxDurationSeconds: 10,
    loopable: false,
    archival: false,
  },
  ui_stereo: {
    id: 'ui_stereo',
    label: 'UI/effect stereo (48 kHz stereo PCM WAV)',
    container: 'wav',
    extension: '.wav',
    codec: 'pcm_s16le',
    sampleRate: 48_000,
    channels: 2,
    loudnessTargetLufs: null,
    loudnessToleranceLu: 0,
    rmsTargetDbfs: -18,
    rmsToleranceDb: 6,
    truePeakCeilingDbtp: -1,
    minDurationSeconds: 0.02,
    maxDurationSeconds: 30,
    loopable: false,
    archival: false,
  },
};

/** Every declared profile, in declaration order. */
export const listAudioRenditionProfiles = (): readonly AudioRenditionProfile[] =>
  Object.values(AUDIO_RENDITION_PROFILES);

/** Looks a profile up by id, or `undefined` when it is not declared. */
export const findAudioRenditionProfile = (id: string): AudioRenditionProfile | undefined =>
  (AUDIO_RENDITION_PROFILES as Record<string, AudioRenditionProfile | undefined>)[id];

const finding = (
  code: AudioFinding['code'],
  severity: AudioFinding['severity'],
  detail: string,
  measured?: number,
  limit?: number,
): AudioFinding => ({
  code,
  severity,
  detail,
  ...(measured === undefined ? {} : { measured }),
  ...(limit === undefined ? {} : { limit }),
});

/**
 * Judges a finished rendition against its profile.
 *
 * This is the only place that decides "accepted": duration, channel count,
 * sample rate, loudness window, true-peak ceiling, catalog size ceiling and
 * catalog installability. Returned findings are merged onto the rendition by
 * the caller; nothing here mutates.
 */
export const verifyRenditionAgainstProfile = (options: {
  rendition: Pick<
    AudioRendition,
    | 'profileId'
    | 'byteLength'
    | 'sampleRate'
    | 'channels'
    | 'sampleCount'
    | 'durationSeconds'
    | 'extension'
    | 'analysis'
  >;
  profile?: AudioRenditionProfile;
}): AudioFinding[] => {
  const profile = options.profile ?? AUDIO_RENDITION_PROFILES[options.rendition.profileId];
  const rendition = options.rendition;
  const findings: AudioFinding[] = [];

  if (rendition.sampleCount === 0) {
    findings.push(finding('empty_clip', 'error', 'the rendition decodes to zero frames'));
    return findings;
  }

  if (
    rendition.durationSeconds < profile.minDurationSeconds ||
    rendition.durationSeconds > profile.maxDurationSeconds
  ) {
    findings.push(
      finding(
        'duration_out_of_bounds',
        'error',
        `${rendition.durationSeconds.toFixed(3)}s is outside ${profile.id}'s ${profile.minDurationSeconds}-${profile.maxDurationSeconds}s window`,
        rendition.durationSeconds,
        profile.maxDurationSeconds,
      ),
    );
  }

  if (profile.channels !== null && rendition.channels !== profile.channels) {
    findings.push(
      finding(
        'channel_count_out_of_bounds',
        'error',
        `${profile.id} requires ${profile.channels} channels but the rendition decoded ${rendition.channels}`,
        rendition.channels,
        profile.channels,
      ),
    );
  }

  if (profile.sampleRate !== null && rendition.sampleRate !== profile.sampleRate) {
    findings.push(
      finding(
        'sample_rate_out_of_bounds',
        'error',
        `${profile.id} requires ${profile.sampleRate} Hz but the rendition decoded ${rendition.sampleRate} Hz`,
        rendition.sampleRate,
        profile.sampleRate,
      ),
    );
  }

  if (profile.loudnessTargetLufs !== null) {
    const measured = rendition.analysis.integratedLufs;
    const lower = profile.loudnessTargetLufs - profile.loudnessToleranceLu;
    const upper = profile.loudnessTargetLufs + profile.loudnessToleranceLu;
    if (measured === null) {
      findings.push(
        finding(
          'loudness_out_of_tolerance',
          'error',
          `${profile.id} requires a measurable integrated loudness of ${profile.loudnessTargetLufs} ±${profile.loudnessToleranceLu} LUFS, but the clip is too short or too quiet to measure`,
          undefined,
          profile.loudnessTargetLufs,
        ),
      );
    } else if (measured < lower || measured > upper) {
      findings.push(
        finding(
          'loudness_out_of_tolerance',
          'error',
          `${profile.id} requires ${lower.toFixed(2)}..${upper.toFixed(2)} LUFS but the rendition measures ${measured.toFixed(2)} LUFS`,
          measured,
          profile.loudnessTargetLufs,
        ),
      );
    }
  }

  if (profile.rmsTargetDbfs !== null && rendition.analysis.rmsDbfs !== null) {
    const lower = profile.rmsTargetDbfs - profile.rmsToleranceDb;
    const upper = profile.rmsTargetDbfs + profile.rmsToleranceDb;
    if (rendition.analysis.rmsDbfs < lower || rendition.analysis.rmsDbfs > upper) {
      findings.push(
        finding(
          'loudness_out_of_tolerance',
          'error',
          `${profile.id} requires ${lower.toFixed(2)}..${upper.toFixed(2)} dBFS RMS but the rendition measures ${rendition.analysis.rmsDbfs.toFixed(2)} dBFS`,
          rendition.analysis.rmsDbfs,
          profile.rmsTargetDbfs,
        ),
      );
    }
  }

  if (
    profile.truePeakCeilingDbtp !== null &&
    rendition.analysis.truePeakDb !== null &&
    rendition.analysis.truePeakDb > profile.truePeakCeilingDbtp
  ) {
    findings.push(
      finding(
        'true_peak_exceeded',
        'error',
        `${profile.id} caps true peak at ${profile.truePeakCeilingDbtp} dBTP but the rendition measures ${rendition.analysis.truePeakDb.toFixed(2)} dBTP`,
        rendition.analysis.truePeakDb,
        profile.truePeakCeilingDbtp,
      ),
    );
  }

  if (rendition.byteLength > MAX_UPLOAD_SIZE) {
    findings.push(
      finding(
        'output_size_out_of_bounds',
        'error',
        `the rendition is ${rendition.byteLength} bytes, above the installed catalog's ${MAX_UPLOAD_SIZE}-byte ceiling`,
        rendition.byteLength,
        MAX_UPLOAD_SIZE,
      ),
    );
  }

  const extension = rendition.extension.toLowerCase();
  if (!AUDIO_EXTS.has(extension)) {
    findings.push(
      finding(
        'container_not_installable',
        'error',
        `"${extension}" is not one of the installed catalog's audio extensions (${[...AUDIO_EXTS].join(' ')})`,
      ),
    );
  }

  return findings;
};
