// packages/shared/local-ai/src/lib/audio/audio_finishing.ts
//
// C-521: deterministic finishing — build a rendition record from encoded bytes
// plus the PCM those bytes decode to, and build the ffmpeg plan that produces
// them.
//
// Two rules drive the shape of this module:
//
//   * **Measured, not claimed.** A rendition's sample rate, channel count,
//     duration and loudness come from decoding the rendition, not from the
//     encoder's metadata or the master's header. That is why a caller passes
//     `decodedWav` alongside `encoded`.
//   * **No shell interpolation.** The plan is an argument *array*. Paths are
//     validated so they cannot be read as flags, and filter values are
//     formatted numbers — a prompt never reaches a command line.
//
// Contract: C-521 Music and SFX generation with audio preparation

import type {
  AudioAnalysis,
  AudioCodec,
  AudioContainer,
  AudioFinding,
  AudioLoopBounds,
  AudioRendition,
  AudioRenditionProfileId,
} from '@aikami/types';
import { sha256Hex } from '../generated_asset.ts';
import type { AudioAnalysisThresholds } from './audio_analysis.ts';
import { analyseDecodedAudio, hasBlockingFinding, isNearSilentMaster } from './audio_analysis.ts';
import {
  AUDIO_RENDITION_PROFILES,
  type AudioRenditionProfile,
  verifyRenditionAgainstProfile,
} from './audio_rendition_profiles.ts';
import { type DecodedAudio, decodeWav } from './wav_decode.ts';

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

// ── Loop bounds ──────────────────────────────────────────────────────────

/**
 * Structural validity of authored loop bounds against a decoded clip.
 *
 * "Valid" means inside the decoded rendition, non-empty, and at least a few
 * milliseconds long — a 3-sample "loop" is a click, not a cue.
 */
export const validateLoopBounds = (options: {
  loop: AudioLoopBounds;
  sampleCount: number;
  sampleRate: number;
}): AudioFinding[] => {
  const { loop, sampleCount, sampleRate } = options;
  const findings: AudioFinding[] = [];
  if (loop.loopStartSample < 0 || loop.loopEndSample <= loop.loopStartSample) {
    findings.push(
      finding(
        'invalid_loop_bounds',
        'error',
        `loop bounds ${loop.loopStartSample}..${loop.loopEndSample} are inverted or empty`,
        loop.loopEndSample - loop.loopStartSample,
      ),
    );
    return findings;
  }
  if (loop.loopEndSample > sampleCount) {
    findings.push(
      finding(
        'invalid_loop_bounds',
        'error',
        `loop end ${loop.loopEndSample} is past the decoded clip (${sampleCount} samples)`,
        loop.loopEndSample,
        sampleCount,
      ),
    );
    return findings;
  }
  const loopSeconds = (loop.loopEndSample - loop.loopStartSample) / sampleRate;
  if (loopSeconds < 0.05) {
    findings.push(
      finding(
        'invalid_loop_bounds',
        'error',
        `the loop is only ${(loopSeconds * 1000).toFixed(1)} ms long`,
        loopSeconds,
        0.05,
      ),
    );
  }
  return findings;
};

/**
 * Largest sample-to-sample step inside the loop body.
 *
 * Used as the yardstick for the seam: a loop cut on a quiet musical boundary
 * steps no further across its seam than it already does inside itself. A loop
 * cut mid-transient steps far more.
 */
const maxBodyStep = (
  channelData: readonly Float32Array[],
  startSample: number,
  endSample: number,
): number => {
  let step = 0;
  for (const channel of channelData) {
    for (let i = startSample; i + 1 < endSample && i + 1 < channel.length; i += 1) {
      const delta = Math.abs((channel[i + 1] as number) - (channel[i] as number));
      if (delta > step) {
        step = delta;
      }
    }
  }
  return step;
};

/**
 * Checks that the authored seam is a clean musical boundary.
 *
 * A crossfaded seam is skipped — the finisher smooths it, so a large raw step
 * there is expected and not a finding.
 */
export const checkLoopSeam = (options: {
  channelData: readonly Float32Array[];
  loop: AudioLoopBounds;
}): AudioFinding[] => {
  const { channelData, loop } = options;
  if (channelData.length === 0) {
    return [];
  }
  if ((loop.crossfadeSamples ?? 0) > 0) {
    return [];
  }
  const start = loop.loopStartSample;
  const end = loop.loopEndSample;
  if (end <= start || end > (channelData[0]?.length ?? 0)) {
    return [];
  }
  let seamStep = 0;
  for (const channel of channelData) {
    const delta = Math.abs((channel[start] as number) - (channel[end - 1] as number));
    if (delta > seamStep) {
      seamStep = delta;
    }
  }
  const bodyStep = maxBodyStep(channelData, start, end);
  const limit = Math.max(0.02, bodyStep * 2);
  if (seamStep > limit) {
    return [
      finding(
        'loop_seam_mismatch',
        'warning',
        `the loop seam steps ${seamStep.toFixed(4)} while the loudest step inside the loop is ${bodyStep.toFixed(4)} — the seam is not on a quiet musical boundary (author a crossfade or move the bounds)`,
        seamStep,
        limit,
      ),
    ];
  }
  return [];
};

/**
 * Re-locates authored master-space loop bounds inside a decoded rendition.
 *
 * Lossy encoders add pre-skip, so a loop that is sample-accurate on the master
 * can drift by up to a couple of milliseconds in the delivered rendition.
 * AC-4 requires bounds that are valid *for the decoded rendition* and a seam
 * that survives encoding, so the offset is measured (windowed absolute
 * difference over a bounded search radius) rather than assumed.
 *
 * @returns Bounds in rendition samples, or `undefined` when no offset within
 *          the search radius matches — the caller then reports
 *          `invalid_loop_bounds` instead of writing bounds that do not fit.
 */
export const alignLoopBoundsToRendition = (options: {
  masterChannelData: readonly Float32Array[];
  renditionChannelData: readonly Float32Array[];
  loop: AudioLoopBounds;
  /** Search radius in samples. Defaults to 200 ms at 48 kHz. */
  searchRadiusSamples?: number;
  /** Samples compared per candidate offset. Defaults to 256. */
  windowSamples?: number;
}): AudioLoopBounds | undefined => {
  const {
    masterChannelData,
    renditionChannelData,
    loop,
    searchRadiusSamples = 9_600,
    windowSamples = 256,
  } = options;
  const master = masterChannelData;
  const rendition = renditionChannelData;
  if (master.length === 0 || rendition.length === 0) {
    return undefined;
  }
  const masterLength = master[0]?.length ?? 0;
  const renditionLength = rendition[0]?.length ?? 0;
  const start = loop.loopStartSample;
  const end = loop.loopEndSample;
  if (start < 0 || end <= start || end > masterLength) {
    return undefined;
  }

  const window = Math.min(windowSamples, end - start);
  let bestOffset = 0;
  let bestError = Number.POSITIVE_INFINITY;

  for (let offset = -searchRadiusSamples; offset <= searchRadiusSamples; offset += 1) {
    const renditionStart = start + offset;
    if (renditionStart < 0 || renditionStart + window > renditionLength) {
      continue;
    }
    let error = 0;
    for (let channel = 0; channel < master.length && channel < rendition.length; channel += 1) {
      const masterChannel = master[channel] as Float32Array;
      const renditionChannel = rendition[channel] as Float32Array;
      for (let i = 0; i < window; i += 1) {
        error += Math.abs(
          (renditionChannel[renditionStart + i] as number) - (masterChannel[start + i] as number),
        );
      }
    }
    if (error < bestError) {
      bestError = error;
      bestOffset = offset;
    }
  }

  if (!Number.isFinite(bestError)) {
    return undefined;
  }
  const shiftedStart = start + bestOffset;
  const shiftedEnd = end + bestOffset;
  if (shiftedStart < 0 || shiftedEnd > renditionLength || shiftedEnd <= shiftedStart) {
    return undefined;
  }
  // A match that is no better than "the window happens to be quiet" is not a
  // match: require a mean per-sample error well below full scale.
  const meanError = bestError / (window * Math.min(master.length, rendition.length));
  if (meanError > 0.05) {
    return undefined;
  }
  return {
    ...loop,
    loopStartSample: shiftedStart,
    loopEndSample: shiftedEnd,
  };
};

// ── Building a rendition record ──────────────────────────────────────────

/** Inputs for {@link buildAudioRendition}. */
export type BuildAudioRenditionOptions = {
  /** Encoded bytes — hashed and sized exactly as delivered. */
  encoded: Uint8Array;
  /**
   * The PCM those bytes decode to, as a RIFF/WAVE file. For a WAV rendition
   * this is `encoded` itself; for a lossy rendition the host decodes it
   * (`ffmpeg -f wav -c:a pcm_f32le`). Measurements come from here.
   */
  decodedWav: Uint8Array;
  /** Already-decoded PCM, when the caller has decoded these bytes for another check. */
  decoded?: DecodedAudio;
  profileId: AudioRenditionProfileId;
  container: AudioContainer;
  codec: AudioCodec;
  mimeType: string;
  extension: string;
  /** SHA-256 of the master this rendition derives from (itself, for a master). */
  parentMasterHash: string;
  /** The master's own analysis — drives the near-silent guard. */
  masterAnalysis?: AudioAnalysis;
  /** Authored loop bounds, already in this rendition's sample space. */
  loop?: AudioLoopBounds;
  /** Host-side loop findings that cannot be derived from rendition bounds alone. */
  loopFindings?: readonly AudioFinding[];
  createdAt: string;
  thresholds?: AudioAnalysisThresholds;
};

/** A built rendition plus the verdict on it. */
export type BuiltAudioRendition = {
  rendition: AudioRendition;
  /** `true` when no error-severity finding was raised. */
  accepted: boolean;
};

/**
 * Assembles one rendition record.
 *
 * The record is always returned — a rejected rendition is still recorded, with
 * its findings, so the failure has an addressed, hashable artifact rather than
 * a thrown string.
 */
export const buildAudioRendition = async (
  options: BuildAudioRenditionOptions,
): Promise<BuiltAudioRendition> => {
  const profile: AudioRenditionProfile = AUDIO_RENDITION_PROFILES[options.profileId];
  const decoded = options.decoded ?? decodeWav(options.decodedWav);
  const { analysis, findings: analysisFindings } = analyseDecodedAudio(decoded, options.thresholds);

  const contentHash = await sha256Hex(options.encoded);
  const loop = options.loop;
  const loopEnabled = loop !== undefined && profile.loopable;

  const loopFindings: AudioFinding[] = [...(options.loopFindings ?? [])];
  if (loop !== undefined) {
    if (!profile.loopable) {
      loopFindings.push(
        finding(
          'invalid_loop_bounds',
          'error',
          `${profile.id} is a one-shot profile and cannot carry loop bounds`,
        ),
      );
    } else {
      loopFindings.push(
        ...validateLoopBounds({
          loop,
          sampleCount: decoded.sampleCount,
          sampleRate: decoded.sampleRate,
        }),
        ...checkLoopSeam({ channelData: decoded.channelData, loop }),
      );
    }
  }

  // AC-3: a near-silent master is never normalised into a loud effect. The
  // archival master is exempt — it is preserved verbatim, not normalised.
  const guardFindings: AudioFinding[] = [];
  if (
    !profile.archival &&
    options.masterAnalysis !== undefined &&
    isNearSilentMaster(options.masterAnalysis)
  ) {
    guardFindings.push(
      finding(
        'near_silent_master',
        'error',
        `${profile.id} refuses to normalise a near-silent master (RMS ${options.masterAnalysis.rmsDbfs?.toFixed(2) ?? 'unmeasurable'} dBFS) into a loud effect`,
        options.masterAnalysis.rmsDbfs ?? undefined,
        -60,
      ),
    );
  }

  const preFindings: AudioFinding[] = [...analysisFindings, ...loopFindings, ...guardFindings];

  const profileFindings = verifyRenditionAgainstProfile({
    rendition: {
      profileId: options.profileId,
      byteLength: options.encoded.byteLength,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      sampleCount: decoded.sampleCount,
      durationSeconds: decoded.durationSeconds,
      extension: options.extension,
      analysis,
    },
    profile,
  });

  const findings = [...preFindings, ...profileFindings];
  const rendition: AudioRendition = {
    renditionId: `${options.profileId}:${contentHash.slice(0, 12)}`,
    profileId: options.profileId,
    contentHash,
    container: options.container,
    codec: options.codec,
    mimeType: options.mimeType,
    extension: options.extension,
    byteLength: options.encoded.byteLength,
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    sampleCount: decoded.sampleCount,
    durationSeconds: decoded.durationSeconds,
    analysis,
    ...(loopEnabled && loop !== undefined ? { loop } : {}),
    loopable: loopEnabled && loop !== undefined && !hasBlockingFinding(loopFindings),
    parentMasterHash: options.parentMasterHash,
    findings,
    createdAt: options.createdAt,
  };

  return { rendition, accepted: !hasBlockingFinding(findings) };
};

// ── Peak/RMS calibration for one-shots ──────────────────────────────────

/**
 * Gain that lands a short one-shot on its profile's RMS target without
 * exceeding the true-peak ceiling.
 *
 * Short SFX have no meaningful gated integrated loudness (BS.1770 needs 400 ms
 * blocks), so the profile declares an RMS target and a listening band instead.
 * The gain is clamped so the ceiling wins: a gain that would push the true peak
 * over the ceiling is reduced rather than accepted.
 *
 * @returns The gain in dB and any finding raised (ceiling clamp, no signal).
 */
export const computeRmsNormalisationGain = (options: {
  analysis: Pick<AudioAnalysis, 'rmsDbfs' | 'truePeakDb'>;
  profile: Pick<AudioRenditionProfile, 'rmsTargetDbfs' | 'truePeakCeilingDbtp' | 'id'>;
}): { gainDb: number; findings: AudioFinding[] } => {
  const { analysis, profile } = options;
  const findings: AudioFinding[] = [];
  if (profile.rmsTargetDbfs === null) {
    return { gainDb: 0, findings };
  }
  if (analysis.rmsDbfs === null) {
    findings.push(
      finding(
        'loudness_out_of_tolerance',
        'error',
        `${profile.id} cannot normalise a clip with no measurable RMS`,
      ),
    );
    return { gainDb: 0, findings };
  }
  let gainDb = profile.rmsTargetDbfs - analysis.rmsDbfs;

  if (profile.truePeakCeilingDbtp !== null && analysis.truePeakDb !== null) {
    const resultingPeak = analysis.truePeakDb + gainDb;
    if (resultingPeak > profile.truePeakCeilingDbtp) {
      const reduced = gainDb - (resultingPeak - profile.truePeakCeilingDbtp);
      findings.push(
        finding(
          'true_peak_exceeded',
          'warning',
          `the RMS target would put true peak at ${resultingPeak.toFixed(2)} dBTP; gain reduced to ${reduced.toFixed(2)} dB to respect the ${profile.truePeakCeilingDbtp} dBTP ceiling`,
          resultingPeak,
          profile.truePeakCeilingDbtp,
        ),
      );
      gainDb = reduced;
    }
  }
  return { gainDb, findings };
};

// ── The ffmpeg plan ──────────────────────────────────────────────────────

/** A finishing plan: a tool and an argument array — never a command string. */
export type FfmpegAudioPlan = {
  tool: 'ffmpeg';
  profileId: AudioRenditionProfileId;
  args: readonly string[];
  outputExtension: string;
  /** The filters applied, for logging without exposing paths. */
  filterChain: string;
};

/**
 * Rejects a path that would be read as an ffmpeg option rather than a file.
 *
 * Without this, a path like `-i/etc/passwd` becomes an argv entry ffmpeg
 * interprets as a flag. Paths are also never interpolated into a filter, so
 * "no shell interpolation from prompts/paths" holds by construction.
 */
export const assertSafeFfmpegPath = (path: string, label: string): void => {
  if (path.length === 0) {
    throw new Error(`${label} is empty`);
  }
  if (path.startsWith('-')) {
    throw new Error(`${label} "${path}" starts with "-" and would be parsed as an ffmpeg option`);
  }
  if (path.includes('\0')) {
    throw new Error(`${label} contains a NUL byte`);
  }
};

/**
 * The pinned codec/bitrate arguments for a profile.
 *
 * Explicit rather than a chain of ternaries so every profile's encoder settings
 * are readable in one place — determinism depends on nothing being left to an
 * ffmpeg default.
 */
const _encoderArgsFor = (profile: AudioRenditionProfile): string[] => {
  switch (profile.codec) {
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', `${profile.bitrateKbps ?? 128}k`];
    case 'vorbis':
      return ['-c:a', 'libvorbis', '-b:a', `${profile.bitrateKbps ?? 128}k`];
    case 'pcm_f32le':
      return ['-c:a', 'pcm_f32le'];
    default:
      return ['-c:a', 'pcm_s16le'];
  }
};

/** Formats a filter value — numbers only, never a caller-supplied string. */
const num = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new Error(`filter value must be finite, got ${value}`);
  }
  return value.toFixed(4);
};

/** Options for {@link buildFfmpegRenditionPlan}. */
export type BuildFfmpegRenditionPlanOptions = {
  inputPath: string;
  outputPath: string;
  profile: AudioRenditionProfileId | AudioRenditionProfile;
  /** First-pass loudnorm measurements. Required for normalised profiles. */
  loudness?: {
    inputI: number;
    inputTp: number;
    inputLra: number;
    inputThresh: number;
    offset: number;
  };
  /** Measured gain for peak/RMS-calibrated profiles (one-shots). */
  gainDb?: number;
  /** Loop region to trim the master to, in master samples. */
  loop?: AudioLoopBounds;
  /** The master's sample rate — converts loop sample bounds to a time base. */
  inputSampleRate?: number;
};

/**
 * Builds the ffmpeg argument array for one profile.
 *
 * Determinism: for a pinned ffmpeg build and a fixed master, the same plan
 * produces byte-identical output, which is what makes a rendition hash
 * reproducible. All encoder settings (rate, channels, bitrate, codec) are
 * pinned here rather than left to ffmpeg defaults, and `-map_metadata -1`
 * strips environment-dependent tags so the bytes do not carry a timestamp.
 *
 * @throws when a normalised profile is planned without measurements, or a
 *         path would be read as an option.
 */
export const buildFfmpegRenditionPlan = (
  options: BuildFfmpegRenditionPlanOptions,
): FfmpegAudioPlan => {
  const profile =
    typeof options.profile === 'string'
      ? AUDIO_RENDITION_PROFILES[options.profile]
      : options.profile;
  assertSafeFfmpegPath(options.inputPath, 'input path');
  assertSafeFfmpegPath(options.outputPath, 'output path');

  const filters: string[] = [];
  let loopLabel: string | undefined;

  if (options.loop !== undefined) {
    if (options.inputSampleRate === undefined) {
      throw new Error('a loop region needs the master sample rate to build a time base');
    }
    const { loopStartSample, loopEndSample, crossfadeSamples } = options.loop;
    if (loopEndSample <= loopStartSample) {
      throw new Error('loop bounds are inverted');
    }
    const body = `atrim=start_sample=${loopStartSample}:end_sample=${loopEndSample},asetpts=N/SR/TB`;
    const crossfade = crossfadeSamples ?? 0;
    if (crossfade > 0) {
      // Crossfade the body's tail into its own head so the seam is smooth by
      // construction: the body and its head are split, trimmed and faded.
      const fadeSeconds = num(crossfade / options.inputSampleRate);
      filters.push(
        `${body},asplit=2[body][head]`,
        `[head]atrim=end_sample=${crossfade},asetpts=N/SR/TB[headtrim]`,
        `[body][headtrim]acrossfade=d=${fadeSeconds}:c1=tri:c2=tri[looped]`,
      );
    } else {
      filters.push(`${body}[looped]`);
    }
    loopLabel = '[looped]';
  }

  const link = loopLabel ?? '[0:a]';

  if (profile.loudnessTargetLufs !== null) {
    if (options.loudness === undefined) {
      throw new Error(
        `${profile.id} normalises by integrated loudness — first-pass loudnorm measurements are required (refusing to guess a gain)`,
      );
    }
    const { inputI, inputTp, inputLra, inputThresh, offset } = options.loudness;
    filters.push(
      `${link}loudnorm=I=${num(profile.loudnessTargetLufs)}:TP=${num(profile.truePeakCeilingDbtp ?? -1)}:LRA=11:measured_I=${num(inputI)}:measured_TP=${num(inputTp)}:measured_LRA=${num(inputLra)}:measured_thresh=${num(inputThresh)}:offset=${num(offset)}:linear=true:print_format=summary[out]`,
    );
  } else if (profile.rmsTargetDbfs !== null) {
    if (options.gainDb === undefined) {
      throw new Error(
        `${profile.id} normalises by RMS — a measured gain is required (refusing to guess a gain)`,
      );
    }
    filters.push(`${link}volume=${num(options.gainDb)}dB[out]`);
  } else if (loopLabel !== undefined) {
    // Trimmed to a loop with no normalisation — hand the loop chain's tail out.
    const last = filters.length - 1;
    filters[last] = (filters[last] as string).replace(loopLabel, '[out]');
  }

  const filterChain = filters.length > 0 ? filters.join(';') : '';
  const encoderArgs: string[] = _encoderArgsFor(profile);

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    options.inputPath,
    // Strip container tags (encoder version, creation time) so identical input
    // yields identical bytes.
    '-map_metadata',
    '-1',
    // Matroska/WebM writes a random SegmentUID and a creation timestamp unless
    // the muxer runs in bitexact mode — that alone would break a repeatable
    // rendition hash.
    '-fflags',
    '+bitexact',
    '-flags',
    '+bitexact',
  ];
  if (filterChain.length > 0) {
    args.push('-filter_complex', filterChain, '-map', '[out]');
  } else {
    args.push('-map', '0:a:0');
  }
  args.push(...encoderArgs);
  if (profile.sampleRate !== null) {
    args.push('-ar', String(profile.sampleRate));
  }
  if (profile.channels !== null) {
    args.push('-ac', String(profile.channels));
  }
  args.push('-f', profile.container, options.outputPath);

  return {
    tool: 'ffmpeg',
    profileId: profile.id,
    args,
    outputExtension: profile.extension,
    filterChain,
  };
};
