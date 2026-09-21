// packages/shared/local-ai/src/lib/audio/wav_decode.ts
//
// C-521: a real RIFF/WAVE decoder.
//
// The engine adapters in this package already parse a WAV *header*
// (`parseWavHeader`) to record what they produced. Finishing cannot work from
// a header: "the actual metadata agrees with the decoded bytes rather than
// file-header fields" means every measurement — duration, channels, silence,
// loudness, loop bounds — has to come from samples this module actually
// decoded. Compressed renditions are decoded to PCM by the host (`ffmpeg -f
// f32le`) and then analysed here, so one code path measures every rendition.
//
// Portable: no Node/Bun imports, no DOM. Pure typed-array arithmetic.
//
// Contract: C-521 Music and SFX generation with audio preparation

import type { AudioCodec, AudioFinding } from '@aikami/types';

/** A finding raised while decoding, before a rendition record exists. */
export type AudioFindingDraft = Omit<AudioFinding, 'severity'> & {
  severity: AudioFinding['severity'];
};

/** Decoded, de-interleaved audio plus the structural facts of its container. */
export type DecodedAudio = {
  /** Container this was decoded from. */
  container: 'wav';
  /** Sample format actually found in the `fmt ` chunk. */
  codec: AudioCodec;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  sampleCount: number;
  durationSeconds: number;
  /**
   * One array per channel, each `sampleCount` long. De-interleaved so every
   * measurement (per-channel DC offset, K-weighted loudness) reads a channel
   * without striding.
   */
  channelData: readonly Float32Array[];
  /** Structural findings (truncation, empty data, unsupported format). */
  findings: readonly AudioFindingDraft[];
};

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Reads 4 ASCII bytes at `offset`. */
const asciiAt = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );

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

/** The `fmt ` chunk fields this decoder needs. */
type WavFormat = {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  codec: AudioCodec;
};

const codecFor = (formatTag: number, bitsPerSample: number): AudioCodec | undefined => {
  if (formatTag === WAVE_FORMAT_PCM) {
    switch (bitsPerSample) {
      case 8:
        return 'pcm_u8';
      case 16:
        return 'pcm_s16le';
      case 24:
        return 'pcm_s24le';
      case 32:
        return 'pcm_s32le';
      default:
        return undefined;
    }
  }
  if (formatTag === WAVE_FORMAT_IEEE_FLOAT) {
    if (bitsPerSample === 32) {
      return 'pcm_f32le';
    }
    if (bitsPerSample === 64) {
      return 'pcm_f64le';
    }
  }
  return undefined;
};

const parseFormat = (bytes: Uint8Array, offset: number): WavFormat | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (offset + 16 > bytes.length) {
    return undefined;
  }
  let formatTag = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const bitsPerSample = view.getUint16(offset + 14, true);
  // WAVE_FORMAT_EXTENSIBLE carries the real format tag in its SubFormat GUID.
  if (formatTag === WAVE_FORMAT_EXTENSIBLE && offset + 26 <= bytes.length) {
    formatTag = view.getUint16(offset + 24, true);
  }
  const codec = codecFor(formatTag, bitsPerSample);
  if (codec === undefined || channels <= 0 || sampleRate <= 0) {
    return undefined;
  }
  return { formatTag, channels, sampleRate, bitsPerSample, codec };
};

/** Reads one nominally-scaled sample into a Float32 sample in [-1, 1). */
const readSample = (
  bytes: Uint8Array,
  view: DataView,
  byteOffset: number,
  codec: AudioCodec,
): number => {
  switch (codec) {
    case 'pcm_u8':
      return ((bytes[byteOffset] ?? 128) - 128) / 128;
    case 'pcm_s16le':
      return view.getInt16(byteOffset, true) / 32768;
    case 'pcm_s24le': {
      const raw =
        (bytes[byteOffset] ?? 0) |
        ((bytes[byteOffset + 1] ?? 0) << 8) |
        ((bytes[byteOffset + 2] ?? 0) << 16);
      // Sign-extend 24 bits.
      const signed = (raw << 8) >> 8;
      return signed / 8388608;
    }
    case 'pcm_s32le':
      return view.getInt32(byteOffset, true) / 2147483648;
    case 'pcm_f32le':
      return view.getFloat32(byteOffset, true);
    case 'pcm_f64le':
      return view.getFloat64(byteOffset, true);
    default:
      return Number.NaN;
  }
};

/**
 * Decodes a RIFF/WAVE file into de-interleaved Float32 channels.
 *
 * Never throws: a file this decoder cannot read comes back with a
 * `decode_failed` / `unsupported_format` finding and zero channels, so a host
 * records "why" instead of catching an exception.
 */
export const decodeWav = (bytes: Uint8Array): DecodedAudio => {
  const findings: AudioFindingDraft[] = [];
  const empty = (
    detail: string,
    code: AudioFindingDraft['code'] = 'decode_failed',
  ): DecodedAudio => {
    findings.push(finding(code, 'error', detail));
    return {
      container: 'wav',
      codec: 'pcm_s16le',
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      sampleCount: 0,
      durationSeconds: 0,
      channelData: [],
      findings,
    };
  };

  if (bytes.length < 12) {
    return empty('fewer than 12 bytes — not a RIFF/WAVE container', 'unsupported_format');
  }
  if (asciiAt(bytes, 0) !== 'RIFF' || asciiAt(bytes, 8) !== 'WAVE') {
    return empty('magic bytes are not RIFF/WAVE', 'unsupported_format');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: WavFormat | undefined;
  let dataOffset: number | undefined;
  let dataBytes = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = asciiAt(bytes, offset);
    const declaredSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + declaredSize;
    if (chunkId === 'fmt ') {
      format = parseFormat(bytes, chunkStart);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      // A truncated file is a fact about the bytes, not an error to throw on:
      // record it and decode what is actually there.
      if (chunkEnd > bytes.length) {
        findings.push(
          finding(
            'truncated_clip',
            'error',
            `data chunk declares ${declaredSize} bytes but only ${bytes.length - chunkStart} are present`,
            bytes.length - chunkStart,
            declaredSize,
          ),
        );
        dataBytes = Math.max(0, bytes.length - chunkStart);
      } else {
        dataBytes = declaredSize;
      }
      break;
    }
    if (chunkEnd > bytes.length) {
      // Some other chunk overruns the file — nothing usable follows.
      break;
    }
    // Chunks are word-aligned — an odd size carries one pad byte.
    offset = chunkEnd + (declaredSize % 2);
  }

  if (format === undefined) {
    return empty('no readable `fmt ` chunk', 'unsupported_format');
  }
  if (dataOffset === undefined) {
    return empty('no `data` chunk', 'unsupported_format');
  }
  if (dataBytes === 0) {
    return {
      container: 'wav',
      codec: format.codec,
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitsPerSample: format.bitsPerSample,
      sampleCount: 0,
      durationSeconds: 0,
      channelData: [],
      findings: [...findings, finding('empty_clip', 'error', 'the data chunk carries no frames')],
    };
  }

  const bytesPerSample = format.bitsPerSample / 8;
  const frameBytes = bytesPerSample * format.channels;
  const frameCount = Math.floor(dataBytes / frameBytes);

  // A partial trailing frame is truncation the header did not advertise.
  if (dataBytes % frameBytes !== 0) {
    findings.push(
      finding(
        'truncated_clip',
        'error',
        `the data chunk ends mid-frame (${dataBytes % frameBytes} extra bytes)`,
        dataBytes % frameBytes,
        frameBytes,
      ),
    );
  }

  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < format.channels; channel += 1) {
    channelData.push(new Float32Array(frameCount));
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameBase = dataOffset + frame * frameBytes;
    for (let channel = 0; channel < format.channels; channel += 1) {
      (channelData[channel] as Float32Array)[frame] = readSample(
        bytes,
        view,
        frameBase + channel * bytesPerSample,
        format.codec,
      );
    }
  }

  return {
    container: 'wav',
    codec: format.codec,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    sampleCount: frameCount,
    durationSeconds: format.sampleRate > 0 ? frameCount / format.sampleRate : 0,
    channelData,
    findings,
  };
};
