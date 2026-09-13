// packages/shared/local-ai/src/lib/__fixtures__/media_bytes.ts
//
// C-517: genuine container fixtures for the format-correctness tests.
//
// These are NOT arbitrary byte arrays relabelled with a MIME type — they carry
// real container structure, so "the engine returned WebP while the recipe
// declared PNG" is a genuine format disagreement rather than a fixture lie.
// PNG and WebP are full 1×1 images produced by a real encoder; the remaining
// entries are minimal headers for the sniffing table (no shipped recipe emits
// them yet).
//
// Test-only: nothing in `src/` may import this module at runtime.

/** Decodes base64 through `atob` — available in Bun and browsers, no imports. */
const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** 1×1 RGB PNG (70 bytes) — real IHDR/IDAT/IEND chunks with valid CRCs. */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 1×1 lossless WebP (26 bytes) — RIFF/WEBP/VP8L, real encoder output. */
export const WEBP_1X1_BASE64 = 'UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAc=';

/** The genuine 1×1 PNG bytes. */
export const pngBytes = (): Uint8Array => decodeBase64(PNG_1X1_BASE64);

/** The genuine 1×1 WebP bytes. */
export const webpBytes = (): Uint8Array => decodeBase64(WEBP_1X1_BASE64);

/** Builds a minimal, structurally valid 16-bit PCM WAV with silent frames. */
export const wavBytes = (
  options: { sampleRate?: number; channels?: number; frames?: number } = {},
): Uint8Array => {
  const sampleRate = options.sampleRate ?? 44_100;
  const channels = options.channels ?? 2;
  const frames = options.frames ?? 44_100;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = frames * blockAlign;
  const buffer = new Uint8Array(44 + dataBytes);
  const view = new DataView(buffer.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      buffer[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
};

/** Builds a byte array from a `"ff d8 ff"`-style magic-byte string. */
const fromMagic = (magic: string, trailing = 16): Uint8Array => {
  const bytes = magic
    .trim()
    .split(/\s+/)
    .map((token) => Number.parseInt(token, 16));
  return new Uint8Array([...bytes, ...new Array<number>(trailing).fill(0)]);
};

/** Builds a complete ISO-BMFF `ftyp` box from its major and compatible brands. */
const ftypBox = (options: {
  majorBrand: string;
  compatibleBrands?: readonly string[];
}): Uint8Array => {
  const compatibleBrands = options.compatibleBrands ?? [];
  const bytes = new Uint8Array(16 + compatibleBrands.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  const writeBrand = (offset: number, brand: string): void => {
    for (let index = 0; index < 4; index++) {
      bytes[offset + index] = brand.charCodeAt(index);
    }
  };
  writeBrand(4, 'ftyp');
  writeBrand(8, options.majorBrand);
  for (const [index, brand] of compatibleBrands.entries()) {
    writeBrand(16 + index * 4, brand);
  }
  return bytes;
};

/** Minimal container headers for the remaining sniffing-table entries. */
export const minimalContainers = {
  jpeg: (): Uint8Array => fromMagic('ff d8 ff e0 00 10 4a 46 49 46 00'),
  gif: (): Uint8Array => fromMagic('47 49 46 38 39 61'),
  mp3: (): Uint8Array => fromMagic('49 44 33 03 00 00 00 00 00 00'),
  ogg: (): Uint8Array => fromMagic('4f 67 67 53 00 02 00 00 00 00 00 00'),
  flac: (): Uint8Array => fromMagic('66 4c 61 43 00 00 00 22'),
  aac: (): Uint8Array => fromMagic('ff f1 50 80 00 1f fc'),
  m4a: (): Uint8Array => ftypBox({ majorBrand: 'M4A ', compatibleBrands: ['isom'] }),
  webm: (): Uint8Array => fromMagic('1a 45 df a3 01 00 00 00 00 00 00 1f'),
  avif: (): Uint8Array => ftypBox({ majorBrand: 'avif', compatibleBrands: ['mif1'] }),
  avifCompatible: (): Uint8Array =>
    ftypBox({ majorBrand: 'mif1', compatibleBrands: ['miaf', 'avif'] }),
  avisCompatible: (): Uint8Array => ftypBox({ majorBrand: 'mif1', compatibleBrands: ['avis'] }),
  svg: (): Uint8Array =>
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
} as const;

/** Deliberately unrecognised bytes — a truncated/undecodable payload. */
export const undecodableBytes = (): Uint8Array => new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff]);
