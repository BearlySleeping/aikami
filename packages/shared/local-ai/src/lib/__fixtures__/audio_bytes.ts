// packages/shared/local-ai/src/lib/__fixtures__/audio_bytes.ts
//
// C-521 test fixtures: deterministic synthetic audio and the WAV encoders the
// audio tests need. Kept in `__fixtures__` (not a `.test.ts`) so several suites
// share one generator and the byte layout they assert against is identical.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** Builds a RIFF/WAVE header plus the given interleaved sample bytes. */
const wrapWav = (options: {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Uint8Array;
}): Uint8Array => {
  const { formatTag, channels, sampleRate, bitsPerSample, data } = options;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      header[offset + i] = text.charCodeAt(i);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + data.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, data.length, true);
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
};

const clamp16 = (value: number): number => {
  if (value > 1) {
    return 32767;
  }
  if (value < -1) {
    return -32768;
  }
  return Math.round(value * 32767);
};

/** Encodes de-interleaved channels as a 16-bit PCM WAV. */
export const encodePcm16Wav = (options: {
  channelData: readonly Float32Array[];
  sampleRate: number;
}): Uint8Array => {
  const { channelData, sampleRate } = options;
  const channels = channelData.length;
  const frames = channelData[0]?.length ?? 0;
  const data = new Uint8Array(frames * channels * 2);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16(
        (frame * channels + channel) * 2,
        clamp16((channelData[channel] as Float32Array)[frame] as number),
        true,
      );
    }
  }
  return wrapWav({ formatTag: 1, channels, sampleRate, bitsPerSample: 16, data });
};

/** Encodes de-interleaved channels as a 32-bit float WAV (lossless for tests). */
export const encodeFloat32Wav = (options: {
  channelData: readonly Float32Array[];
  sampleRate: number;
}): Uint8Array => {
  const { channelData, sampleRate } = options;
  const channels = channelData.length;
  const frames = channelData[0]?.length ?? 0;
  const data = new Uint8Array(frames * channels * 4);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(
        (frame * channels + channel) * 4,
        (channelData[channel] as Float32Array)[frame] as number,
        true,
      );
    }
  }
  return wrapWav({ formatTag: 3, channels, sampleRate, bitsPerSample: 32, data });
};

/** A sine wave, one channel per entry of `amplitudes`. */
export const sineWave = (options: {
  frequency: number;
  sampleRate: number;
  seconds: number;
  amplitudes: readonly number[];
  phase?: number;
}): Float32Array[] => {
  const { frequency, sampleRate, seconds, amplitudes, phase = 0 } = options;
  const frames = Math.round(seconds * sampleRate);
  return amplitudes.map((amplitude) => {
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      channel[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
    }
    return channel;
  });
};

/** Digital silence. */
export const silentChannels = (options: {
  channels: number;
  sampleRate: number;
  seconds: number;
}): Float32Array[] => {
  const frames = Math.round(options.seconds * options.sampleRate);
  return Array.from({ length: options.channels }, () => new Float32Array(frames));
};

/** A constant-valued (DC-offset) signal. */
export const dcOffsetSignal = (options: {
  channels: number;
  sampleRate: number;
  seconds: number;
  offset: number;
}): Float32Array[] => {
  const frames = Math.round(options.seconds * options.sampleRate);
  return Array.from({ length: options.channels }, () => {
    const channel = new Float32Array(frames);
    channel.fill(options.offset);
    return channel;
  });
};

/** A signal whose samples are driven hard past full scale (flat-topped). */
export const clippedSignal = (options: {
  channels: number;
  sampleRate: number;
  seconds: number;
}): Float32Array[] =>
  sineWave({ ...options, frequency: 440, amplitudes: Array(options.channels).fill(2) });

/** A signal carrying NaN and Infinity samples. */
export const nonfiniteSignal = (options: {
  channels: number;
  sampleRate: number;
  seconds: number;
}): Float32Array[] => {
  const channels = sineWave({
    ...options,
    frequency: 440,
    amplitudes: Array(options.channels).fill(0.5),
  });
  const first = channels[0] as Float32Array;
  first[10] = Number.NaN;
  first[11] = Number.POSITIVE_INFINITY;
  first[12] = Number.NEGATIVE_INFINITY;
  return channels;
};

/** The bytes of `bytes` with the trailing `count` bytes removed. */
export const truncateBytes = (bytes: Uint8Array, count: number): Uint8Array =>
  bytes.slice(0, Math.max(0, bytes.length - count));
