// apps/backend/image/scripts/png_codec.ts
//
// C-520: the minimal PNG codec the deterministic preparation host needs.
//
// Why not `sharp`: the preparation host has to run in the same environment as
// the batch CLI, and a native image dependency that is not installed is a
// broken production path rather than a shortcut. PNG is the format ComfyUI and
// sd-server actually emit and the format the preparation profiles declare, so
// a focused, dependency-free codec covers the real seam.
//
// Scope is deliberate and narrow: 8-bit greyscale / RGB / palette-free RGBA,
// non-interlaced — exactly what the image engines produce. Anything else is
// refused loudly rather than decoded approximately, because a wrong decode
// silently corrupts every downstream hash.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { deflateSync, inflateSync } from 'node:zlib';

/** Resource ceilings applied before PNG inflation or RGBA allocation. */
export type PngDecodeLimits = {
  readonly maxResponseBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxInflatedBytes: number;
  readonly maxRgbaBytes: number;
};

/** Catalog-compatible defaults: 64 MiB input and 16,777,216 decoded pixels. */
export const DEFAULT_PNG_DECODE_LIMITS: PngDecodeLimits = Object.freeze({
  maxResponseBytes: 64 * 1024 * 1024,
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxPixels: 16_777_216,
  maxInflatedBytes: 16_777_216 * 4 + 16_384,
  maxRgbaBytes: 16_777_216 * 4,
});

/** The encoder toolchain revision that can change otherwise-identical PNG bytes. */
export const PNG_ENCODER_PROCESSOR = Object.freeze({
  id: 'node:zlib:deflateSync',
  version: process.versions.zlib,
});

/** A decoded straight-alpha RGBA image. */
export type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

/** Refused input, naming the property that is out of scope. */
export class PngCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngCodecError';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PNG_CHUNK_LENGTH = 0x7fffffff;

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let accumulator = index;
    for (let bit = 0; bit < 8; bit++) {
      accumulator = accumulator & 1 ? 0xedb88320 ^ (accumulator >>> 1) : accumulator >>> 1;
    }
    table[index] = accumulator >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)) >>>
  0;

const writeUint32 = (target: Uint8Array, offset: number, value: number): void => {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
};

/** Channels per pixel for a non-palette PNG colour type; 0 means unsupported. */
const _channelsForColourType = (colourType: number): number => {
  switch (colourType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 0;
  }
};

/** True when the bytes carry the PNG signature. */
export const isPng = (bytes: Uint8Array): boolean =>
  PNG_SIGNATURE.length <= bytes.length &&
  PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);

/** Reads the mandatory first IHDR without inflating or allocating pixel storage. */
export const readPngDimensions = (bytes: Uint8Array): { width: number; height: number } => {
  if (!isPng(bytes)) {
    throw new PngCodecError('Not a PNG — the 8-byte signature is absent');
  }
  const offset = PNG_SIGNATURE.length;
  if (offset + 25 > bytes.length) {
    throw new PngCodecError('PNG is truncated before its complete IHDR chunk');
  }
  const length = readUint32(bytes, offset);
  const type = String.fromCharCode(
    bytes[offset + 4] ?? 0,
    bytes[offset + 5] ?? 0,
    bytes[offset + 6] ?? 0,
    bytes[offset + 7] ?? 0,
  );
  if (type !== 'IHDR' || length !== 13) {
    throw new PngCodecError('PNG must begin with a 13-byte IHDR chunk');
  }
  return {
    width: readUint32(bytes, offset + 8),
    height: readUint32(bytes, offset + 12),
  };
};

/**
 * Decodes a PNG into straight-alpha RGBA.
 *
 * @throws PngCodecError for interlaced, 16-bit or palette images — the codec
 *         refuses rather than guessing.
 */
export const decodePng = (
  bytes: Uint8Array,
  limits: PngDecodeLimits = DEFAULT_PNG_DECODE_LIMITS,
): DecodedPng => {
  if (!isPng(bytes)) {
    throw new PngCodecError('Not a PNG — the 8-byte signature is absent');
  }
  if (bytes.length > limits.maxResponseBytes) {
    throw new PngCodecError(
      `PNG response is ${bytes.length} bytes, above the ${limits.maxResponseBytes}-byte limit`,
    );
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  const idat: Uint8Array[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new PngCodecError('PNG is truncated before a complete chunk header and CRC');
    }
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    if (length > MAX_PNG_CHUNK_LENGTH) {
      throw new PngCodecError(
        `PNG chunk "${type}" length ${length} exceeds the PNG 31-bit chunk-length limit`,
      );
    }
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new PngCodecError(
        `PNG chunk "${type}" claims ${length} data bytes and a CRC past the end of the file`,
      );
    }
    const data = bytes.subarray(dataStart, dataEnd);
    const storedCrc = readUint32(bytes, dataEnd);
    const computedCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (storedCrc !== computedCrc) {
      throw new PngCodecError(
        `PNG chunk "${type}" has CRC ${storedCrc.toString(16)}, expected ${computedCrc.toString(16)}`,
      );
    }

    if (type === 'IHDR') {
      if (sawHeader || offset !== PNG_SIGNATURE.length || length !== 13) {
        throw new PngCodecError('PNG must contain one 13-byte IHDR as its first chunk');
      }
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      if (width === 0 || height === 0) {
        throw new PngCodecError('PNG has no positive IHDR dimensions');
      }
      if (width > MAX_PNG_CHUNK_LENGTH || height > MAX_PNG_CHUNK_LENGTH) {
        throw new PngCodecError('PNG IHDR dimensions exceed the PNG 31-bit dimension limit');
      }
      if (width > limits.maxWidth || height > limits.maxHeight) {
        throw new PngCodecError(
          `PNG dimensions ${width}x${height} exceed the ${limits.maxWidth}x${limits.maxHeight} limit`,
        );
      }
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
        throw new PngCodecError(
          `PNG dimensions ${width}x${height} exceed the ${limits.maxPixels}-pixel limit`,
        );
      }
      const rgbaBytes = pixels * 4;
      if (!Number.isSafeInteger(rgbaBytes) || rgbaBytes > limits.maxRgbaBytes) {
        throw new PngCodecError(
          `PNG dimensions ${width}x${height} require ${rgbaBytes} RGBA bytes, above the ${limits.maxRgbaBytes}-byte limit`,
        );
      }
      bitDepth = data[8] ?? 0;
      colourType = data[9] ?? 0;
      interlace = data[12] ?? 0;
      sawHeader = true;
    } else if (type === 'IDAT') {
      if (!sawHeader) {
        throw new PngCodecError('PNG IDAT appears before IHDR');
      }
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) {
        throw new PngCodecError('PNG IEND chunk must be empty');
      }
      sawEnd = true;
      offset = dataEnd + 4;
      break;
    }

    offset = dataEnd + 4;
  }

  if (!sawHeader || width <= 0 || height <= 0) {
    throw new PngCodecError('PNG has no positive IHDR dimensions');
  }
  if (!sawEnd) {
    throw new PngCodecError('PNG carries no complete IEND chunk');
  }
  if (bitDepth !== 8) {
    throw new PngCodecError(`PNG bit depth ${bitDepth} is out of scope — only 8-bit is decoded`);
  }
  if (interlace !== 0) {
    throw new PngCodecError('Interlaced PNG is out of scope');
  }
  const channels = _channelsForColourType(colourType);
  if (channels === 0) {
    throw new PngCodecError(
      `PNG colour type ${colourType} (palette) is out of scope — only greyscale/RGB/RGBA are decoded`,
    );
  }
  if (idat.length === 0) {
    throw new PngCodecError('PNG carries no IDAT data');
  }

  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (!Number.isSafeInteger(expected) || expected > limits.maxInflatedBytes) {
    throw new PngCodecError(
      `PNG ${width}x${height} scanlines require ${expected} inflated bytes, above the ${limits.maxInflatedBytes}-byte limit`,
    );
  }

  const combined = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    combined.set(part, cursor);
    cursor += part.length;
  }

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(combined, { maxOutputLength: expected }));
  } catch (error) {
    throw new PngCodecError(`PNG IDAT failed to inflate: ${(error as Error).message}`);
  }

  if (raw.length !== expected) {
    throw new PngCodecError(
      `PNG pixel data is ${raw.length} bytes, expected exactly ${expected} for ${width}x${height}`,
    );
  }

  const rgba = new Uint8Array(width * height * 4);
  const prior = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const lineStart = y * (stride + 1) + 1;
    current.set(raw.subarray(lineStart, lineStart + stride));

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (current[x - channels] ?? 0) : 0;
      const up = prior[x] ?? 0;
      const upLeft = x >= channels ? (prior[x - channels] ?? 0) : 0;
      const value = current[x] ?? 0;
      let reconstructed = value;
      switch (filter) {
        case 0:
          break;
        case 1:
          reconstructed = value + left;
          break;
        case 2:
          reconstructed = value + up;
          break;
        case 3:
          reconstructed = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          let predictor = upLeft;
          if (pa <= pb && pa <= pc) {
            predictor = left;
          } else if (pb <= pc) {
            predictor = up;
          }
          reconstructed = value + predictor;
          break;
        }
        default:
          throw new PngCodecError(`PNG scanline ${y} uses unknown filter type ${filter}`);
      }
      current[x] = reconstructed & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      if (channels === 1) {
        const grey = current[x] ?? 0;
        rgba[target] = grey;
        rgba[target + 1] = grey;
        rgba[target + 2] = grey;
        rgba[target + 3] = 255;
      } else if (channels === 2) {
        const grey = current[x * 2] ?? 0;
        rgba[target] = grey;
        rgba[target + 1] = grey;
        rgba[target + 2] = grey;
        rgba[target + 3] = current[x * 2 + 1] ?? 0;
      } else if (channels === 3) {
        rgba[target] = current[x * 3] ?? 0;
        rgba[target + 1] = current[x * 3 + 1] ?? 0;
        rgba[target + 2] = current[x * 3 + 2] ?? 0;
        rgba[target + 3] = 255;
      } else {
        rgba[target] = current[x * 4] ?? 0;
        rgba[target + 1] = current[x * 4 + 1] ?? 0;
        rgba[target + 2] = current[x * 4 + 2] ?? 0;
        rgba[target + 3] = current[x * 4 + 3] ?? 0;
      }
    }

    prior.set(current);
  }

  return { width, height, rgba };
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(data.length + 12);
  writeUint32(out, 0, data.length);
  for (let index = 0; index < 4; index++) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/**
 * Encodes straight-alpha RGBA as an 8-bit RGBA PNG.
 *
 * Lossless by construction, which is what the profiles declare — a lossy
 * encode would make the prepared hash depend on encoder tuning rather than on
 * the pixels.
 */
export const encodePng = (image: {
  width: number;
  height: number;
  rgba: Uint8Array;
}): Uint8Array => {
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 — deterministic, no per-line heuristics
    raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, image.width);
  writeUint32(ihdr, 4, image.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
};
