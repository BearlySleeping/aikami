// apps/backend/local-stack/stack/generation/__fixtures__/audio_wav.ts
//
// C-521 test fixtures: deterministic synthetic masters and the WAV encoder the
// host-side audio tests share. Not a `.test.ts`, so the runner test, the
// finisher test and the import test all build byte-identical masters.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** Encodes de-interleaved float channels as a 32-bit float RIFF/WAVE file. */
export const encodeFloat32Wav = (
  channelData: readonly Float32Array[],
  sampleRate: number,
): Uint8Array => {
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
  const header = new Uint8Array(44);
  const headerView = new DataView(header.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      header[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  headerView.setUint32(4, 36 + data.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  headerView.setUint32(16, 16, true);
  headerView.setUint16(20, 3, true); // IEEE float
  headerView.setUint16(22, channels, true);
  headerView.setUint32(24, sampleRate, true);
  headerView.setUint32(28, sampleRate * channels * 4, true);
  headerView.setUint16(32, channels * 4, true);
  headerView.setUint16(34, 32, true);
  ascii(36, 'data');
  headerView.setUint32(40, data.length, true);
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
};

/** A sine wave, one channel per entry of `amplitudes`. */
export const sineChannels = (options: {
  frequency: number;
  seconds: number;
  sampleRate: number;
  amplitudes: readonly number[];
}): Float32Array[] => {
  const frames = Math.round(options.seconds * options.sampleRate);
  return options.amplitudes.map((amplitude) => {
    const channel = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      channel[index] =
        amplitude * Math.sin((2 * Math.PI * options.frequency * index) / options.sampleRate);
    }
    return channel;
  });
};

/** A mono/stereo float32 WAV master at `sampleRate`, at the given amplitude. */
export const makeMasterWav = (options: {
  frequency: number;
  seconds: number;
  sampleRate: number;
  amplitude: number;
  channels?: number;
}): Uint8Array =>
  encodeFloat32Wav(
    sineChannels({
      frequency: options.frequency,
      seconds: options.seconds,
      sampleRate: options.sampleRate,
      amplitudes: Array(options.channels ?? 1).fill(options.amplitude),
    }),
    options.sampleRate,
  );
