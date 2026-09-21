// apps/backend/image/scripts/preparation_host.test.ts
//
// C-520 AC-3: the production-path preparation host — decode → deterministic
// kernel → encode → hash — with a real PNG round trip, not a mocked one.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { describe, expect, test } from 'bun:test';
import { MEDIA_VALIDATION_CODES } from '@aikami/constants';
import { sha256Hex } from '@aikami/local-ai';
import {
  DEFAULT_PNG_DECODE_LIMITS,
  decodePng,
  encodePng,
  isPng,
  PngCodecError,
} from './png_codec.ts';
import { decodeCandidate, prepareCandidate } from './preparation_host.ts';

/** Builds a PNG from a paint callback so each fixture is a real container. */
const pngFrom = (options: {
  width: number;
  height: number;
  paint: (x: number, y: number) => [number, number, number, number];
}): Uint8Array => {
  const rgba = new Uint8Array(options.width * options.height * 4);
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      const [r, g, b, a] = options.paint(x, y);
      const offset = (y * options.width + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = a;
    }
  }
  return encodePng({ width: options.width, height: options.height, rgba });
};

/** A clean isolated prop: transparent ground, one bright centred block. */
const isolatedPropPng = (): Uint8Array =>
  pngFrom({
    width: 64,
    height: 64,
    paint: (x, y) =>
      x >= 20 && x <= 43 && y >= 20 && y <= 59 ? [220, 220, 210, 255] : [0, 0, 0, 0],
  });

/** A full-alpha dark ground render with a bright prop on it. */
const groundRenderPng = (): Uint8Array =>
  pngFrom({
    width: 64,
    height: 64,
    paint: (x, y) =>
      x >= 20 && x <= 43 && y >= 12 && y <= 57 ? [220, 220, 210, 255] : [0, 0, 0, 255],
  });

/** A native-alpha isolated prop whose object pixels are nearly black. */
const darkIsolatedPropPng = (): Uint8Array =>
  pngFrom({
    width: 64,
    height: 64,
    paint: (x, y) => (x >= 20 && x <= 43 && y >= 12 && y <= 57 ? [4, 5, 6, 255] : [0, 0, 0, 0]),
  });

describe('C-520: PNG codec round trip', () => {
  test('encode then decode returns the same pixels', () => {
    const expected = new Uint8Array(5 * 3 * 4);
    const source = pngFrom({
      width: 5,
      height: 3,
      paint: (x, y) => {
        const rgba: [number, number, number, number] = [
          x * 40,
          y * 60,
          (x + y) * 10,
          x === y ? 0 : 255,
        ];
        expected.set(rgba, (y * 5 + x) * 4);
        return rgba;
      },
    });
    expect(isPng(source)).toBe(true);
    const decoded = decodePng(source);
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(3);
    expect(decoded.rgba).toEqual(expected);
  });

  test('a chunk with a corrupted CRC is refused', () => {
    const corrupted = isolatedPropPng().slice();
    corrupted[29] = (corrupted[29] ?? 0) ^ 1;
    expect(() => decodePng(corrupted)).toThrow(/CRC/);
  });

  test('configured response and dimension limits reject before pixel allocation', () => {
    const png = isolatedPropPng();
    const responseLimited = decodeCandidate(png, {
      ...DEFAULT_PNG_DECODE_LIMITS,
      maxResponseBytes: png.length - 1,
    });
    expect('finding' in responseLimited && responseLimited.finding.message).toContain('response');
    expect(() => decodePng(png, { ...DEFAULT_PNG_DECODE_LIMITS, maxWidth: 63 })).toThrow(
      /dimensions/,
    );
  });

  test('encoding is deterministic — the same pixels always produce the same bytes', async () => {
    const first = isolatedPropPng();
    const second = isolatedPropPng();
    expect(await sha256Hex(first)).toBe(await sha256Hex(second));
  });

  test('a non-PNG payload is refused by name, not coerced', () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5]);
    expect(isPng(notPng)).toBe(false);
    expect(() => decodePng(notPng)).toThrow(PngCodecError);
  });

  test('a truncated PNG is refused rather than decoded approximately', () => {
    const png = isolatedPropPng();
    expect(() => decodePng(png.subarray(0, 40))).toThrow();
  });
});

describe('C-520 AC-3: the host prepares a real candidate deterministically', () => {
  test('the same raw bytes and profile produce the same prepared hash', async () => {
    const raw = isolatedPropPng();
    const first = await prepareCandidate({
      rawBytes: raw,
      preparationProfileId: 'prop-native-alpha',
    });
    const second = await prepareCandidate({
      rawBytes: raw,
      preparationProfileId: 'prop-native-alpha',
    });
    expect(first.preparedSha256).toBe(second.preparedSha256);
    expect(first.ext).toBe('.png');
    expect(first.report.machinePassed).toBe(true);
    expect(first.report.manualReviewRequired).toBe(true);
  });

  test('the report names both hashes and the profile version', async () => {
    const raw = isolatedPropPng();
    const prepared = await prepareCandidate({
      rawBytes: raw,
      preparationProfileId: 'prop-native-alpha',
    });
    expect(prepared.report.inputSha256).toBe(await sha256Hex(raw));
    expect(prepared.report.outputSha256).toBe(prepared.preparedSha256);
    expect(prepared.report.profileId).toBe('prop-native-alpha');
    expect(prepared.report.profileVersion).toBe('1.0.0');
    expect(prepared.report.processor.deterministic).toBe(true);
    expect(prepared.report.processor.encoder).toEqual({
      id: 'node:zlib:deflateSync',
      version: process.versions.zlib,
    });
    expect(prepared.report.operations).toEqual([
      'decode-orient',
      'alpha-cleanup',
      'trim',
      'encode',
    ]);
  });

  test('the ground profile preserves dark pixels from a native-alpha render', async () => {
    const raw = darkIsolatedPropPng();
    const prepared = await prepareCandidate({
      rawBytes: raw,
      preparationProfileId: 'prop-full-alpha-ground',
    });
    expect(prepared.report.machinePassed).toBe(true);
    const decoded = decodePng(prepared.bytes);
    expect(decoded.width).toBeLessThan(64);
    expect(decoded.height).toBeLessThan(64);
    expect(decoded.rgba.some((channel) => channel === 4)).toBe(true);
  });

  test('an unextracted ground render is rejected with a stable code', async () => {
    const raw = groundRenderPng();
    const prepared = await prepareCandidate({
      rawBytes: raw,
      preparationProfileId: 'prop-native-alpha',
    });
    expect(prepared.report.machinePassed).toBe(false);
    expect(prepared.report.findings.map((finding) => finding.code)).toContain(
      MEDIA_VALIDATION_CODES.alphaRequired,
    );
  });

  test('a non-PNG candidate is a format-mismatch finding, not a crash', async () => {
    const prepared = await prepareCandidate({
      rawBytes: new Uint8Array([9, 9, 9, 9]),
      preparationProfileId: 'prop-native-alpha',
    });
    expect(prepared.report.machinePassed).toBe(false);
    expect(prepared.report.findings[0]?.code).toBe(MEDIA_VALIDATION_CODES.formatMismatch);
  });

  test('an unknown preparation profile is refused before any pixel work', async () => {
    await expect(
      prepareCandidate({ rawBytes: isolatedPropPng(), preparationProfileId: 'nope' }),
    ).rejects.toThrow(/Unknown preparation profile/);
  });

  test('the decoder hands the kernel a straight-alpha surface', () => {
    const decoded = decodeCandidate(isolatedPropPng());
    expect('image' in decoded).toBe(true);
    if (!('image' in decoded)) {
      return;
    }
    expect(decoded.image.width).toBe(64);
    expect(decoded.image.data[0 * 4 + 3]).toBe(0);
    const insideOffset = (30 * 64 + 30) * 4;
    expect(decoded.image.data[insideOffset + 3]).toBe(255);
  });
});
