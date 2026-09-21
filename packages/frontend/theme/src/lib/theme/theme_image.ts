// packages/frontend/theme/src/lib/theme/theme_image.ts
//
// C-529 — bounded raster dimension reading for theme assets.
//
// A theme package declares raster ornaments and a preview image. The manifest
// declares `bytes`, which bounds the *encoded* size but says nothing about how
// much memory the decoded bitmap needs — a 100 KiB PNG can decode to 40 million
// pixels. This module reads the header of PNG/JPEG/WebP and reports the
// dimensions without decoding, so the validator can reject a decompression
// bomb before a browser ever allocates the bitmap.
//
// 🔴 Header-only. Nothing here decodes pixel data, and nothing trusts a
// declared dimension — the numbers come from the bytes.

import { THEME_RASTER_MEDIA_TYPES } from '@aikami/constants';

/** Dimensions read from an image header. */
export type ImageDimensions = { readonly width: number; readonly height: number };

const readUint32BE = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 24) |
  ((bytes[offset + 1] ?? 0) << 16) |
  ((bytes[offset + 2] ?? 0) << 8) |
  (bytes[offset + 3] ?? 0);

const readUint24LE = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);

const readUint16LE = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

const matchesAscii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const readPng = (bytes: Uint8Array): ImageDimensions | undefined => {
  if (bytes.length < 24) {
    return undefined;
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return undefined;
  }
  // IHDR is required to be the first chunk: length(4) type(4) width(4) height(4).
  if (!matchesAscii(bytes, 12, 'IHDR')) {
    return undefined;
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
};

/** JPEG start-of-frame markers that carry dimensions. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const readJpeg = (bytes: Uint8Array): ImageDimensions | undefined => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (JPEG_SOF_MARKERS.has(marker)) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    if (marker === 0xda) {
      return undefined;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
};

const readWebp = (bytes: Uint8Array): ImageDimensions | undefined => {
  if (bytes.length < 30 || !matchesAscii(bytes, 0, 'RIFF') || !matchesAscii(bytes, 8, 'WEBP')) {
    return undefined;
  }
  if (matchesAscii(bytes, 12, 'VP8X')) {
    return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
  }
  if (matchesAscii(bytes, 12, 'VP8L')) {
    const bits =
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (matchesAscii(bytes, 12, 'VP8 ')) {
    return {
      width: readUint16LE(bytes, 26) & 0x3fff,
      height: readUint16LE(bytes, 28) & 0x3fff,
    };
  }
  return undefined;
};

/** True when the media type is one this profile accepts for raster assets. */
export const isSupportedRasterMediaType = (mediaType: string): boolean =>
  (THEME_RASTER_MEDIA_TYPES as readonly string[]).includes(mediaType);

/**
 * Reads the dimensions of a PNG, JPEG or WebP image without decoding it.
 *
 * Returns `undefined` for an unsupported container, a truncated header or a
 * zero-sized image — the caller rejects the asset rather than guessing.
 */
export const readImageDimensions = (bytes: Uint8Array): ImageDimensions | undefined => {
  const dimensions = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
  if (dimensions === undefined || dimensions.width <= 0 || dimensions.height <= 0) {
    return undefined;
  }
  return dimensions;
};
