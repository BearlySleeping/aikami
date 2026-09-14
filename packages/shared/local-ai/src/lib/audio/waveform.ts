// packages/shared/local-ai/src/lib/audio/waveform.ts
//
// C-521 AC-4: the peak envelope behind the Studio review waveform.
//
// Peaks — not RMS — because a reviewer is looking for a clipped transient and
// for the loop seam, both of which an average hides. Portable so the host
// report and the client panel draw the same picture from the same numbers.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** Peak envelope, one value per bucket, each in 0..1. */
export type AudioPeaks = readonly number[];

/** How many buckets the review waveform uses by default. */
export const DEFAULT_WAVEFORM_BUCKETS = 240;

/**
 * Reduces decoded samples to a peak envelope.
 *
 * @param samples - One channel of decoded PCM.
 * @param buckets - Envelope width. Defaults to {@link DEFAULT_WAVEFORM_BUCKETS}.
 * @returns Up to `buckets` peaks; empty when there is nothing to draw.
 */
export const computeWaveformPeaks = (
  samples: Float32Array,
  buckets: number = DEFAULT_WAVEFORM_BUCKETS,
): AudioPeaks => {
  if (buckets <= 0 || samples.length === 0) {
    return [];
  }
  const perBucket = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * perBucket;
    if (start >= samples.length) {
      break;
    }
    const end = Math.min(samples.length, start + perBucket);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const magnitude = Math.abs(samples[index] as number);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
};

/** Converts a sample bound to seconds for display, guarding a zero rate. */
export const sampleToSeconds = (sample: number, sampleRate: number): number =>
  sampleRate > 0 ? sample / sampleRate : 0;
