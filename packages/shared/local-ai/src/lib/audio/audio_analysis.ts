// packages/shared/local-ai/src/lib/audio/audio_analysis.ts
//
// C-521: turn decoded samples into the measurable record AC-3 asserts on.
//
// Every value here comes from samples that were actually decoded — never from
// a container header, an encoder's metadata, or a provider's claim. Findings
// are typed (`AUDIO_FINDING_CODES`) so a refusal names a code rather than a
// prose sentence.
//
// Contract: C-521 Music and SFX generation with audio preparation

import type { AudioAnalysis } from '@aikami/types';
import { integratedLoudness, rmsDbfs, samplePeakDb, truePeakDb } from './loudness.ts';
import type { AudioFindingDraft, DecodedAudio } from './wav_decode.ts';

/** Thresholds that decide which findings a decoded clip raises. */
export type AudioAnalysisThresholds = {
  /** Frames below this level count as silence. */
  silenceThresholdDbfs: number;
  /** Fraction of silent frames at which `excessive_silence` is raised. */
  excessiveSilenceRatio: number;
  /** Trailing silent run, in seconds, at which `excessive_silence` is raised. */
  excessiveSilenceTailSeconds: number;
  /** Absolute per-channel mean above which `dc_offset` is raised. */
  dcOffsetLimit: number;
};

/** The project's analysis thresholds. */
export const DEFAULT_AUDIO_ANALYSIS_THRESHOLDS: AudioAnalysisThresholds = {
  silenceThresholdDbfs: -60,
  excessiveSilenceRatio: 0.98,
  excessiveSilenceTailSeconds: 2,
  dcOffsetLimit: 0.01,
};

const finding = (
  code: AudioFindingDraft['code'],
  severity: AudioFindingDraft['severity'],
  detail: string,
  measured?: number,
  limit?: number,
): AudioFindingDraft => ({
  code,
  severity,
  detail,
  ...(measured === undefined ? {} : { measured }),
  ...(limit === undefined ? {} : { limit }),
});

const dbfsToLinear = (dbfs: number): number => 10 ** (dbfs / 20);

/** Structural findings a decoder already raised, carried forward verbatim. */
const structuralFindings = (decoded: DecodedAudio): AudioFindingDraft[] => [...decoded.findings];

/**
 * Measures a decoded clip and raises its findings.
 *
 * Structural problems that make measurement meaningless (empty, truncated,
 * nonfinite) are reported and short-circuit the arithmetic so no number is
 * invented from garbage samples.
 */
export const analyseDecodedAudio = (
  decoded: DecodedAudio,
  thresholds: AudioAnalysisThresholds = DEFAULT_AUDIO_ANALYSIS_THRESHOLDS,
): { analysis: AudioAnalysis; findings: AudioFindingDraft[] } => {
  const findings = structuralFindings(decoded);
  const empty: AudioAnalysis = {
    integratedLufs: null,
    truePeakDb: null,
    samplePeakDb: null,
    rmsDbfs: null,
    dcOffset: 0,
    clippedSampleCount: 0,
    nonfiniteSampleCount: 0,
    silenceRatio: decoded.sampleCount === 0 ? 1 : 0,
    silenceTailSeconds: 0,
  };

  if (decoded.channelData.length === 0 || decoded.sampleCount === 0) {
    return { analysis: empty, findings };
  }

  const { channelData, sampleCount, sampleRate } = decoded;
  const silenceAmplitude = dbfsToLinear(thresholds.silenceThresholdDbfs);

  let nonfiniteSampleCount = 0;
  let clippedSampleCount = 0;
  let maxAbsDc = 0;
  /** Latest frame index that carried energy — used for the silent tail. */
  let lastLoudFrame = -1;
  let silentFrames = 0;

  for (const channel of channelData) {
    let sum = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i] as number;
      if (!Number.isFinite(value)) {
        nonfiniteSampleCount += 1;
        continue;
      }
      sum += value;
      const magnitude = Math.abs(value);
      if (magnitude >= 1) {
        clippedSampleCount += 1;
      }
    }
    maxAbsDc = Math.max(maxAbsDc, Math.abs(sum / channel.length));
  }

  // Silence is per-frame across all channels: a frame is silent only when
  // every channel is below the threshold.
  for (let frame = 0; frame < sampleCount; frame += 1) {
    let loudest = 0;
    for (const channel of channelData) {
      const magnitude = Math.abs(channel[frame] as number);
      if (magnitude > loudest) {
        loudest = magnitude;
      }
    }
    if (!Number.isFinite(loudest) || loudest < silenceAmplitude) {
      silentFrames += 1;
    } else {
      lastLoudFrame = frame;
    }
  }

  const silenceRatio = sampleCount > 0 ? silentFrames / sampleCount : 0;
  const silenceTailSeconds = sampleRate > 0 ? (sampleCount - 1 - lastLoudFrame) / sampleRate : 0;

  const measuredRms = rmsDbfs(channelData);
  const analysis: AudioAnalysis = {
    integratedLufs: integratedLoudness(channelData, sampleRate),
    truePeakDb: truePeakDb(channelData),
    samplePeakDb: samplePeakDb(channelData),
    rmsDbfs: measuredRms,
    dcOffset: maxAbsDc,
    clippedSampleCount,
    nonfiniteSampleCount,
    silenceRatio,
    silenceTailSeconds: Math.max(0, silenceTailSeconds),
  };

  if (nonfiniteSampleCount > 0) {
    findings.push(
      finding(
        'nonfinite_samples',
        'error',
        `decoded ${nonfiniteSampleCount} NaN/Infinity samples — the clip cannot be measured or encoded`,
        nonfiniteSampleCount,
      ),
    );
  }
  if (clippedSampleCount > 0) {
    findings.push(
      finding(
        'clipping',
        'error',
        `decoded ${clippedSampleCount} samples at or beyond full scale`,
        clippedSampleCount,
      ),
    );
  }
  if (maxAbsDc > thresholds.dcOffsetLimit) {
    findings.push(
      finding(
        'dc_offset',
        'error',
        `largest per-channel mean sample is ${maxAbsDc.toFixed(4)} — a DC-offset master would be normalised into a biased effect`,
        maxAbsDc,
        thresholds.dcOffsetLimit,
      ),
    );
  }
  if (
    silenceRatio >= thresholds.excessiveSilenceRatio ||
    analysis.silenceTailSeconds >= thresholds.excessiveSilenceTailSeconds
  ) {
    findings.push(
      finding(
        'excessive_silence',
        'warning',
        `${(silenceRatio * 100).toFixed(1)}% of frames are silent and the silent tail is ${analysis.silenceTailSeconds.toFixed(2)}s`,
        silenceRatio,
        thresholds.excessiveSilenceRatio,
      ),
    );
  }

  return { analysis, findings };
};

/**
 * Decides whether a decoded clip is too quiet to be finished into a loud
 * effect.
 *
 * AC-3 is explicit: "a near-silent master is never normalised into a loud
 * effect". A mastering normaliser applied to a noise floor would produce a
 * loud, obviously-wrong cue, so this guard refuses the master instead.
 */
export const isNearSilentMaster = (analysis: AudioAnalysis, thresholdDbfs = -60): boolean => {
  if (analysis.clippedSampleCount > 0 || analysis.nonfiniteSampleCount > 0) {
    return false;
  }
  if (analysis.rmsDbfs === null) {
    return true;
  }
  return analysis.rmsDbfs <= thresholdDbfs;
};

/** True when an audio rendition carries an error-severity finding. */
export const hasBlockingAudioFinding = (findings: readonly { severity: string }[]): boolean =>
  findings.some((entry) => entry.severity === 'error');
