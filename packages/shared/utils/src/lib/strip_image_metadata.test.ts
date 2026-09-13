// packages/shared/utils/src/lib/strip_image_metadata.test.ts
//
// C-513 Security/privacy: "strip EXIF and any embedded metadata that leaks
// local paths".
//
// Every fixture below embeds a real-looking local path (`/home/creator/...`,
// `C:\Users\creator\...`) in the container field a creator's export actually
// carries one in, and every assertion checks that the path is gone from the
// bytes that would be uploaded. The idempotency and byte-identity cases guard
// the AC-1 invariant: the hub re-runs this on already-stripped bytes, so a
// second pass must change nothing.

import { describe, expect, test } from 'bun:test';
import { stripImageMetadata, stripImageMetadataBytes } from './strip_image_metadata.ts';

const POSIX_PATH = '/home/creator/art/hero.png';
const WINDOWS_PATH = 'C:\\Users\\creator\\art\\hero.png';

/** UTF-8 encodes `text` to a plain byte array (fixture building). */
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** Latin-1 decodes bytes so a leaked path can be searched for in the output. */
const latin1 = (bytes: Uint8Array): string => {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
};

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** One JPEG marker segment: `FF <marker> <u16 length> <payload>`. */
const jpegSegment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};

/** A JFIF APP0 header — structural, must survive. */
const jfifApp0 = (): number[] =>
  jpegSegment(0xe0, [...ascii('JFIF\0'), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

/** Start-of-scan + a few entropy bytes + end-of-image. */
const jpegScan = (): number[] => [
  ...jpegSegment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  0x00,
  0x01,
  0x02,
  0xff,
  0xd9,
];

/** EXIF (APP1) + a COM comment, both carrying a local path. */
const jpegWithMetadata = (): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...jfifApp0(),
    ...jpegSegment(0xe1, [...ascii('Exif\0\0'), ...ascii(POSIX_PATH)]),
    ...jpegSegment(0xfe, ascii(WINDOWS_PATH)),
    ...jpegSegment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii(POSIX_PATH)]),
    ...jpegScan(),
  ]);

/** A JPEG with nothing to strip — SOI, JFIF, scan. */
const jpegWithoutMetadata = (): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, ...jfifApp0(), ...jpegScan()]);

describe('JPEG metadata stripping', () => {
  test('removes EXIF, XMP and COM segments while keeping JFIF and the scan data', () => {
    const input = jpegWithMetadata();
    const result = stripImageMetadata(input);

    expect(result.format).toBe('jpeg');
    expect(result.changed).toBe(true);
    expect(result.bytes.length).toBeLessThan(input.length);

    const text = latin1(result.bytes);
    expect(text).not.toContain(POSIX_PATH);
    expect(text).not.toContain(WINDOWS_PATH);
    expect(text).not.toContain('Exif');
    expect(text).not.toContain('ns.adobe.com');
    // What the decoder needs is intact.
    expect(text).toContain('JFIF');
    expect(text.slice(0, 2)).toBe('\u00ff\u00d8');
    expect(text.slice(-2)).toBe('\u00ff\u00d9');
    expect(text).toContain('\u00ff\u00da');
  });

  test('is idempotent — a second pass over stripped bytes changes nothing', () => {
    const once = stripImageMetadata(jpegWithMetadata());
    const twice = stripImageMetadata(once.bytes);

    expect(twice.changed).toBe(false);
    expect(twice.bytes.length).toBe(once.bytes.length);
    expect([...twice.bytes]).toEqual([...once.bytes]);
  });

  test('a JPEG with no metadata is returned as the identical reference', () => {
    const input = jpegWithoutMetadata();
    const result = stripImageMetadata(input);

    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });

  test('a truncated JPEG is not rewritten into something unusable', () => {
    // SOI + an APP1 header claiming more payload than exists.
    const truncated = Uint8Array.from([
      0xff,
      0xd8,
      ...jpegSegment(0xe1, [...ascii('Exif\0\0'), ...ascii(POSIX_PATH)]).slice(0, 6),
    ]);
    const result = stripImageMetadata(truncated);

    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(truncated);
  });

  test('skips marker fill bytes and still strips later APP1 and COM metadata', () => {
    const input = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xff,
      0xff,
      ...jfifApp0().slice(1),
      0xff,
      0xff,
      ...jpegSegment(0xe1, [...ascii('Exif\0\0'), ...ascii(POSIX_PATH)]).slice(1),
      0xff,
      0xff,
      ...jpegSegment(0xfe, ascii(WINDOWS_PATH)).slice(1),
      ...jpegScan(),
    ]);

    const result = stripImageMetadata(input);

    expect(result.changed).toBe(true);
    expect(latin1(result.bytes)).toContain('JFIF');
    expect(latin1(result.bytes)).not.toContain(POSIX_PATH);
    expect(latin1(result.bytes)).not.toContain(WINDOWS_PATH);
    expect(latin1(result.bytes)).toContain('\u00ff\u00da');
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** One PNG chunk: `<u32 length> <type> <data> <crc>`. */
const pngChunk = (type: string, data: number[]): number[] => {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...ascii(type),
    ...data,
    // The stripper never validates CRCs; zeros keep the fixture readable.
    0x00,
    0x00,
    0x00,
    0x00,
  ];
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = (): number[] => pngChunk('IHDR', [0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0]);
const PNG_IDAT = (): number[] => pngChunk('IDAT', [0x78, 0x9c, 0x01, 0x02, 0x03]);
const PNG_IEND = (): number[] => pngChunk('IEND', []);

const pngWithMetadata = (): Uint8Array =>
  Uint8Array.from([
    ...PNG_SIGNATURE,
    ...PNG_IHDR(),
    ...pngChunk('tEXt', [...ascii('Comment\0'), ...ascii(POSIX_PATH)]),
    ...pngChunk('iTXt', [...ascii('Description\0\0\0\0\0'), ...ascii(WINDOWS_PATH)]),
    ...pngChunk('eXIf', [...ascii('Exif\0\0'), ...ascii(POSIX_PATH)]),
    ...PNG_IDAT(),
    ...PNG_IEND(),
  ]);

const pngWithoutMetadata = (): Uint8Array =>
  Uint8Array.from([...PNG_SIGNATURE, ...PNG_IHDR(), ...PNG_IDAT(), ...PNG_IEND()]);

describe('PNG metadata stripping', () => {
  test('removes tEXt, iTXt and eXIf while keeping IHDR, IDAT and IEND', () => {
    const input = pngWithMetadata();
    const result = stripImageMetadata(input);

    expect(result.format).toBe('png');
    expect(result.changed).toBe(true);
    expect(result.bytes.length).toBeLessThan(input.length);

    const text = latin1(result.bytes);
    expect(text).not.toContain(POSIX_PATH);
    expect(text).not.toContain(WINDOWS_PATH);
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('iTXt');
    expect(text).not.toContain('eXIf');
    expect(text).toContain('IHDR');
    expect(text).toContain('IDAT');
    expect(text).toContain('IEND');
  });

  test('is idempotent', () => {
    const once = stripImageMetadata(pngWithMetadata());
    const twice = stripImageMetadata(once.bytes);
    expect(twice.changed).toBe(false);
    expect([...twice.bytes]).toEqual([...once.bytes]);
  });

  test('a PNG with no metadata is returned as the identical reference', () => {
    const input = pngWithoutMetadata();
    const result = stripImageMetadata(input);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

/** One RIFF chunk: `<fourcc> <u32le size> <data> <pad-if-odd>`. */
const webpChunk = (fourCc: string, data: number[]): number[] => {
  const size = data.length;
  const pad = size % 2 === 1 ? [0x00] : [];
  return [
    ...ascii(fourCc),
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...data,
    ...pad,
  ];
};

/** `VP8X` flags: EXIF (0x08) and XMP (0x04) advertised. */
const webpVp8x = (flags: number): number[] =>
  webpChunk('VP8X', [flags, 0, 0, 0, 0x0f, 0, 0, 0x0f, 0, 0]);

const webpWithMetadata = (): Uint8Array => {
  const body = [
    ...ascii('WEBP'),
    ...webpVp8x(0x0c),
    ...webpChunk('EXIF', ascii(POSIX_PATH)),
    ...webpChunk('XMP ', ascii(WINDOWS_PATH)),
    ...webpChunk('VP8 ', [0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00]),
  ];
  return Uint8Array.from([
    ...ascii('RIFF'),
    body.length & 0xff,
    (body.length >>> 8) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 24) & 0xff,
    ...body,
  ]);
};

const webpWithoutMetadata = (): Uint8Array => {
  const body = [...ascii('WEBP'), ...webpChunk('VP8 ', [0x9d, 0x01, 0x2a, 0x01])];
  return Uint8Array.from([
    ...ascii('RIFF'),
    body.length & 0xff,
    (body.length >>> 8) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 24) & 0xff,
    ...body,
  ]);
};

describe('WebP metadata stripping', () => {
  test('removes the EXIF and XMP chunks and clears their VP8X feature flags', () => {
    const input = webpWithMetadata();
    const result = stripImageMetadata(input);

    expect(result.format).toBe('webp');
    expect(result.changed).toBe(true);
    expect(result.bytes.length).toBeLessThan(input.length);

    const text = latin1(result.bytes);
    expect(text).not.toContain(POSIX_PATH);
    expect(text).not.toContain(WINDOWS_PATH);
    expect(text).not.toContain('EXIF');
    expect(text).not.toContain('XMP ');
    // The image payload and the container header survive.
    expect(text).toContain('VP8 ');
    expect(text.slice(0, 4)).toBe('RIFF');
    expect(text.slice(8, 12)).toBe('WEBP');

    // The VP8X flags byte no longer advertises the removed chunks.
    const vp8xAt = text.indexOf('VP8X');
    expect(vp8xAt).toBeGreaterThan(0);
    // fourcc(4) + size(4) precede the flags byte.
    expect(result.bytes[vp8xAt + 8]).toBe(0x00);
  });

  test('the RIFF size field matches the stripped length', () => {
    const result = stripImageMetadata(webpWithMetadata());
    const size =
      (result.bytes[4] as number) |
      ((result.bytes[5] as number) << 8) |
      ((result.bytes[6] as number) << 16) |
      ((result.bytes[7] as number) << 24);
    expect(size >>> 0).toBe(result.bytes.length - 8);
  });

  test('is idempotent — including the already-cleared VP8X flags', () => {
    const once = stripImageMetadata(webpWithMetadata());
    const twice = stripImageMetadata(once.bytes);
    expect(twice.changed).toBe(false);
    expect([...twice.bytes]).toEqual([...once.bytes]);
  });

  test('a WebP with no metadata is returned as the identical reference', () => {
    const input = webpWithoutMetadata();
    const result = stripImageMetadata(input);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Non-image containers
// ---------------------------------------------------------------------------

describe('containers this module cannot parse', () => {
  test('audio bytes are returned untouched, byte for byte', () => {
    const ogg = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
    const result = stripImageMetadata(ogg);

    expect(result.format).toBe('unknown');
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(ogg);
  });

  test('empty input is not an error', () => {
    const result = stripImageMetadata(new Uint8Array(0));
    expect(result.format).toBe('unknown');
    expect(result.bytes.length).toBe(0);
  });

  test('the bytes-only wrapper agrees with the full result', () => {
    const input = jpegWithMetadata();
    expect([...stripImageMetadataBytes(input)]).toEqual([...stripImageMetadata(input).bytes]);
  });
});

describe('the AC-1 invariant holds across the strip', () => {
  test('stripping never grows the payload — for every supported container', () => {
    for (const input of [jpegWithMetadata(), pngWithMetadata(), webpWithMetadata()]) {
      const stripped = stripImageMetadata(input);
      expect(stripped.bytes.length).toBeLessThanOrEqual(input.length);
    }
  });

  test('the stripped length is stable, so a declared size stays truthful', () => {
    // The client declares `sizeBytes` from this length and the hub re-strips
    // before hashing; both must see the same number.
    const clientSide = stripImageMetadata(pngWithMetadata());
    const hubSide = stripImageMetadata(clientSide.bytes);
    expect(hubSide.bytes.length).toBe(clientSide.bytes.length);
  });
});
