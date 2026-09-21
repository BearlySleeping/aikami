// packages/shared/local-ai/src/lib/audio/loudness.ts
//
// C-521: ITU-R BS.1770-4 loudness and true-peak measurement.
//
// These are the measurements AC-3 asserts against a profile's declared mix
// targets (music ≈ -18 LUFS-I ±2, ambience ≈ -24 LUFS-I ±3, true peak
// ≤ -1 dBTP). They are computed from decoded samples, never from a provider's
// metadata or a container header. Short clips that cannot carry a gated
// 400 ms measurement return `null` instead of a fabricated number.
//
// References: ITU-R BS.1770-4 §2 (K-weighting), §3 (gating), Annex 2
// (true-peak 4x oversampling filter).
//
// Portable: pure typed-array arithmetic, no Node/Bun/DOM imports.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** One second-order section, as used by both K-weighting stages. */
export type BiquadCoefficients = {
  /** Feed-forward coefficients b0, b1, b2. */
  b: readonly [number, number, number];
  /** Feedback coefficients a1, a2 (a0 is normalised to 1). */
  a: readonly [number, number];
};

/** The two cascaded sections of the BS.1770 K-weighting filter. */
export type KWeightingFilter = {
  /** Stage 1: high-shelf ("head" model). */
  shelf: BiquadCoefficients;
  /** Stage 2: high-pass (RLB model). */
  highPass: BiquadCoefficients;
};

/**
 * Derives the BS.1770-4 K-weighting coefficients for a sample rate.
 *
 * The standard publishes a coefficient table for 48 kHz; the underlying
 * analog prototypes (1681.974450955533 Hz / 3.999843853973347 dB /
 * Q 0.7071752369554196, and 38.13547087602444 Hz / Q 0.5003270373238773) are
 * rate-independent, so they are transformed per rate here rather than
 * resampled to 48 kHz — the measurement then describes the rate the client
 * actually decodes.
 */
export const kWeightingCoefficients = (sampleRate: number): KWeightingFilter => {
  const shelfF0 = 1681.974450955533;
  const shelfGainDb = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const kShelf = Math.tan((Math.PI * shelfF0) / sampleRate);
  const vh = 10 ** (shelfGainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + kShelf / shelfQ + kShelf * kShelf;

  const hpF0 = 38.13547087602444;
  const hpQ = 0.5003270373238773;
  const kHp = Math.tan((Math.PI * hpF0) / sampleRate);
  const hpA0 = 1 + kHp / hpQ + kHp * kHp;

  return {
    shelf: {
      b: [
        (vh + (vb * kShelf) / shelfQ + kShelf * kShelf) / shelfA0,
        (2 * (kShelf * kShelf - vh)) / shelfA0,
        (vh - (vb * kShelf) / shelfQ + kShelf * kShelf) / shelfA0,
      ],
      a: [(2 * (kShelf * kShelf - 1)) / shelfA0, (1 - kShelf / shelfQ + kShelf * kShelf) / shelfA0],
    },
    highPass: {
      b: [1, -2, 1],
      a: [(2 * (kHp * kHp - 1)) / hpA0, (1 - kHp / hpQ + kHp * kHp) / hpA0],
    },
  };
};

/** Applies one biquad in transposed direct form II, in place on a copy. */
const applyBiquad = (input: Float32Array, coefficients: BiquadCoefficients): Float32Array => {
  const { b, a } = coefficients;
  const [b0, b1, b2] = b;
  const [a1, a2] = a;
  const output = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i] as number;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    output[i] = y;
  }
  return output;
};

/** K-weights one channel; the input is not mutated. */
export const kWeightChannel = (channel: Float32Array, sampleRate: number): Float32Array => {
  const filter = kWeightingCoefficients(sampleRate);
  return applyBiquad(applyBiquad(channel, filter.shelf), filter.highPass);
};

/**
 * BS.1770-4 channel weights.
 *
 * Ordering follows the standard's channel assignment (L, R, C, LFE, Ls, Rs).
 * The LFE channel is excluded, surround channels carry +1.5 dB.
 */
const channelWeight = (channelCount: number, channelIndex: number): number => {
  if (channelCount <= 3) {
    return 1;
  }
  if (channelIndex === 3) {
    return 0; // LFE is not measured
  }
  if (channelIndex >= 4) {
    return 1.41;
  }
  return 1;
};

/** The BS.1770 gating block length (400 ms) and step (100 ms = 75% overlap). */
const BLOCK_SECONDS = 0.4;
const BLOCK_STEP_SECONDS = 0.1;
/** Absolute gate, in LUFS. */
const ABSOLUTE_GATE_LUFS = -70;
/** Relative gate, in LU below the ungated-above-absolute mean. */
const RELATIVE_GATE_LU = -10;

/**
 * BS.1770-4 gated integrated loudness, in LUFS.
 *
 * @returns LUFS, or `null` when the clip is shorter than one 400 ms block or
 *          every block falls below the absolute gate. A `null` means
 *          "unmeasurable", not "silent".
 */
export const integratedLoudness = (
  channelData: readonly Float32Array[],
  sampleRate: number,
): number | null => {
  if (channelData.length === 0 || sampleRate <= 0) {
    return null;
  }
  const sampleCount = channelData[0]?.length ?? 0;
  const blockSamples = Math.round(BLOCK_SECONDS * sampleRate);
  const stepSamples = Math.round(BLOCK_STEP_SECONDS * sampleRate);
  if (blockSamples <= 0 || stepSamples <= 0 || sampleCount < blockSamples) {
    return null;
  }

  const weighted = channelData.map((channel) => kWeightChannel(channel, sampleRate));
  const blockCount = Math.floor((sampleCount - blockSamples) / stepSamples) + 1;
  const blockLoudness = new Float64Array(blockCount);
  const blockMeanSquare = new Float64Array(blockCount);

  for (let block = 0; block < blockCount; block += 1) {
    const start = block * stepSamples;
    const end = start + blockSamples;
    let weightedSum = 0;
    for (let channel = 0; channel < weighted.length; channel += 1) {
      const data = weighted[channel] as Float32Array;
      let sum = 0;
      for (let i = start; i < end; i += 1) {
        const value = data[i] as number;
        sum += value * value;
      }
      const meanSquare = sum / blockSamples;
      weightedSum += channelWeight(weighted.length, channel) * meanSquare;
    }
    blockMeanSquare[block] = weightedSum;
    blockLoudness[block] = -0.691 + 10 * Math.log10(weightedSum);
  }

  // Absolute gate.
  let absoluteSum = 0;
  let absoluteCount = 0;
  for (let block = 0; block < blockCount; block += 1) {
    if ((blockLoudness[block] as number) > ABSOLUTE_GATE_LUFS) {
      absoluteSum += blockMeanSquare[block] as number;
      absoluteCount += 1;
    }
  }
  if (absoluteCount === 0) {
    return null;
  }

  // Relative gate, computed from the absolute-gated mean.
  const relativeThreshold =
    -0.691 + 10 * Math.log10(absoluteSum / absoluteCount) + RELATIVE_GATE_LU;

  let gatedSum = 0;
  let gatedCount = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const loudness = blockLoudness[block] as number;
    if (loudness > ABSOLUTE_GATE_LUFS && loudness > relativeThreshold) {
      gatedSum += blockMeanSquare[block] as number;
      gatedCount += 1;
    }
  }
  if (gatedCount === 0) {
    return null;
  }

  return -0.691 + 10 * Math.log10(gatedSum / gatedCount);
};

/**
 * BS.1770-4 Annex 2 polyphase filter — 4 phases × 12 taps, used to reconstruct
 * the inter-sample waveform before taking the peak.
 */
const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875,
    0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
    0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
    0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625,
    0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875,
    0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125,
    0.001708984375,
  ],
];

/** The largest absolute sample value across every channel. */
const peakAbs = (channelData: readonly Float32Array[]): number => {
  let peak = 0;
  for (const channel of channelData) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = Math.abs(channel[i] as number);
      if (value > peak) {
        peak = value;
      }
    }
  }
  return peak;
};

const toDb = (linear: number): number | null =>
  linear > 0 && Number.isFinite(linear) ? 20 * Math.log10(linear) : null;

/** Sample peak across all channels, in dBFS. */
export const samplePeakDb = (channelData: readonly Float32Array[]): number | null =>
  toDb(peakAbs(channelData));

/**
 * True peak across all channels, in dBTP — the peak of the 4x oversampled
 * waveform, so inter-sample peaks above the sample peak are reported.
 */
export const truePeakDb = (channelData: readonly Float32Array[]): number | null => {
  let peak = 0;
  for (const channel of channelData) {
    const length = channel.length;
    for (let phase = 0; phase < TRUE_PEAK_PHASES.length; phase += 1) {
      const taps = TRUE_PEAK_PHASES[phase] as readonly number[];
      for (let n = 0; n < length; n += 1) {
        let value = 0;
        for (let k = 0; k < taps.length; k += 1) {
          const index = n - k;
          if (index >= 0) {
            value += (taps[k] as number) * (channel[index] as number);
          }
        }
        const magnitude = Math.abs(value);
        if (magnitude > peak) {
          peak = magnitude;
        }
      }
    }
  }
  return toDb(peak);
};

/** RMS across all channels, in dBFS. */
export const rmsDbfs = (channelData: readonly Float32Array[]): number | null => {
  let sum = 0;
  let count = 0;
  for (const channel of channelData) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i] as number;
      sum += value * value;
      count += 1;
    }
  }
  if (count === 0) {
    return null;
  }
  return toDb(Math.sqrt(sum / count));
};
