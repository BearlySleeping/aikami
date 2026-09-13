// packages/shared/utils/src/lib/strip_image_metadata.ts
//
// C-513 Security/privacy — "strip EXIF and any embedded metadata that leaks
// local paths".
//
// A creator's export carries their machine inside its container metadata long
// before anything reaches the hub: EXIF `Artist`/`UserComment`/`ImageDescription`,
// XMP `dc:creator`, a Photoshop `IPTC` block, a PNG `tEXt`/`iTXt` payload or a
// WebP `EXIF`/`XMP ` chunk are all arbitrary, user-writable string fields. Any
// of them can hold `/home/<user>/art/hero.png`.
//
// Stripping runs in the client publish transport and then again, defensively,
// in the hub before it hashes what it stores. Two properties make running it
// twice safe:
//
//   1. **Idempotent.** Removing a segment that is not present returns the input
//      unchanged, so the hub's second pass over client-stripped bytes is a
//      no-op. That is what keeps AC-1's invariant true: the declared
//      `sizeBytes`, the upload's `Content-Length` and the bytes the hub hashes
//      are all the same length.
//   2. **Length-preserving or shrinking — never growing.** Nothing here inserts
//      padding, so an upload can never be larger than what the transport
//      declared.
//
// An unrecognised container (audio, video, SVG, GIF, AVIF) is returned
// byte-identical: this module never guesses at a format it cannot parse, and it
// never re-encodes pixels.
//
// Container policy (what is removed and what is deliberately kept):
//
//   * **JPEG** — every APPn segment except APP0 (JFIF), APP2 (ICC profile) and
//     APP14 (Adobe colour transform), plus every COM comment. The three kept
//     segments are structural: JFIF carries no strings, ICC carries no strings,
//     and APP14 is 12 bytes of colour flags — dropping APP2/APP14 would change
//     how the image renders, not remove anything personal.
//   * **PNG** — the ancillary text/metadata chunks `tEXt`, `zTXt`, `iTXt`,
//     `eXIf` and `tIME`. Critical chunks and the colour chunks (`gAMA`, `cHRM`,
//     `sRGB`, `iCCP`, `pHYs`) are kept for the same reason.
//   * **WebP** — the `EXIF` and `XMP ` RIFF chunks, and the matching EXIF/XMP
//     bits in the `VP8X` feature flags so a decoder is not told to expect a
//     chunk that is gone.

/** A container this module parses. */
export type StrippableImageFormat = 'jpeg' | 'png' | 'webp';

/** The outcome of a metadata strip. */
export type StrippedImageBytes = {
  /** Bytes to store. Metadata removed when the container was recognised. */
  bytes: Uint8Array;
  /** The parsed container, or `'unknown'` when the input was left untouched. */
  format: StrippableImageFormat | 'unknown';
  /** True when at least one segment/chunk was dropped, or a flag rewritten. */
  changed: boolean;
};

/** PNG ancillary chunks that carry text/metadata rather than pixels. */
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** WebP RIFF chunks that carry metadata rather than pixels. */
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);

/** `VP8X` feature-flag bits for the EXIF and XMP chunks (see the WebP spec). */
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

/** JPEG marker of the start of image. */
const JPEG_SOI_MARKER = 0xffd8;
/** JPEG marker that ends the header and starts the entropy-coded scan. */
const JPEG_SOS_MARKER = 0xda;
/** JPEG comment segment. */
const JPEG_COM_MARKER = 0xfe;
/**
 * JPEG APPn markers that are structural, not personal: APP0 (JFIF header),
 * APP2 (ICC colour profile) and APP14 (Adobe colour transform).
 */
const JPEG_KEPT_APP_MARKERS = new Set([0xe0, 0xe2, 0xee]);

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True when `input` starts with the 8-byte PNG signature. */
const isPng = (input: Uint8Array): boolean => {
  if (input.length < PNG_SIGNATURE.length) {
    return false;
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (input[index] !== PNG_SIGNATURE[index]) {
      return false;
    }
  }
  return true;
};

/** True when `input` starts with the JPEG SOI marker. */
const isJpeg = (input: Uint8Array): boolean =>
  input.length >= 2 && ((input[0] as number) << 8) + (input[1] as number) === JPEG_SOI_MARKER;

/** True when `input` is a `RIFF....WEBP` container. */
const isWebp = (input: Uint8Array): boolean =>
  input.length >= 12 && asciiAt(input, 0, 4) === 'RIFF' && asciiAt(input, 8, 4) === 'WEBP';

/** Reads `length` bytes at `offset` as ASCII (non-printable bytes included). */
function asciiAt(input: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = offset; index < offset + length; index++) {
    text += String.fromCharCode(input[index] as number);
  }
  return text;
}

/** Big-endian u32 — PNG's chunk length field. */
const readUint32BigEndian = (input: Uint8Array, offset: number): number =>
  (((input[offset] as number) << 24) |
    ((input[offset + 1] as number) << 16) |
    ((input[offset + 2] as number) << 8) |
    (input[offset + 3] as number)) >>>
  0;

/** Little-endian u32 — RIFF's size field and WebP's chunk sizes. */
const readUint32LittleEndian = (input: Uint8Array, offset: number): number =>
  (((input[offset + 3] as number) << 24) |
    ((input[offset + 2] as number) << 16) |
    ((input[offset + 1] as number) << 8) |
    (input[offset] as number)) >>>
  0;

/** Writes a little-endian u32 in place. */
const writeUint32LittleEndian = (input: Uint8Array, offset: number, value: number): void => {
  input[offset] = value & 0xff;
  input[offset + 1] = (value >>> 8) & 0xff;
  input[offset + 2] = (value >>> 16) & 0xff;
  input[offset + 3] = (value >>> 24) & 0xff;
};

/** Concatenates kept byte ranges plus the verbatim tail into one buffer. */
const concatRanges = (ranges: readonly Uint8Array[], tail: Uint8Array): Uint8Array => {
  let total = tail.length;
  for (const range of ranges) {
    total += range.length;
  }
  const output = new Uint8Array(total);
  let at = 0;
  for (const range of ranges) {
    output.set(range, at);
    at += range.length;
  }
  output.set(tail, at);
  return output;
};

/** Drops JPEG APPn/COM segments, preserving the header and the scan data. */
const stripJpegSegments = (input: Uint8Array): { bytes: Uint8Array; changed: boolean } => {
  const kept: Uint8Array[] = [input.subarray(0, 2)];
  let changed = false;
  let offset = 2;

  while (offset + 3 < input.length) {
    if (input[offset] !== 0xff) {
      // Not a marker — either the entropy-coded scan has already begun or the
      // file is malformed. Copy the remainder verbatim.
      break;
    }
    const markerStart = offset;
    while (offset < input.length && input[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= input.length) {
      offset = markerStart;
      break;
    }
    const marker = input[offset] as number;
    const markerEnd = offset + 1;

    // SOS ends the header: the entropy-coded data that follows is opaque.
    if (marker === JPEG_SOS_MARKER) {
      offset = markerStart;
      break;
    }

    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      kept.push(input.subarray(markerStart, markerEnd));
      offset = markerEnd;
      continue;
    }

    const lengthField = markerEnd;
    const segmentLength =
      ((input[lengthField] as number) << 8) | (input[lengthField + 1] as number);
    if (segmentLength < 2) {
      offset = markerStart;
      break;
    }
    const segmentEnd = lengthField + segmentLength;
    if (segmentEnd > input.length) {
      offset = markerStart;
      break;
    }

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const removable = (isApp && !JPEG_KEPT_APP_MARKERS.has(marker)) || marker === JPEG_COM_MARKER;
    if (removable) {
      changed = true;
    } else {
      kept.push(input.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }

  if (!changed) {
    return { bytes: input, changed: false };
  }
  return { bytes: concatRanges(kept, input.subarray(offset)), changed: true };
};

/** Drops PNG ancillary text/metadata chunks, preserving pixels and colour. */
const stripPngChunks = (input: Uint8Array): { bytes: Uint8Array; changed: boolean } => {
  const kept: Uint8Array[] = [input.subarray(0, 8)];
  let changed = false;
  let offset = 8;

  while (offset + 12 <= input.length) {
    const dataLength = readUint32BigEndian(input, offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > input.length) {
      // Truncated chunk — copy the remainder verbatim rather than guess.
      break;
    }
    const chunkType = asciiAt(input, offset + 4, 4);
    if (PNG_METADATA_CHUNKS.has(chunkType)) {
      changed = true;
    } else {
      kept.push(input.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  if (!changed) {
    return { bytes: input, changed: false };
  }
  return { bytes: concatRanges(kept, input.subarray(offset)), changed: true };
};

/** Drops WebP EXIF/XMP chunks and clears their VP8X feature flags. */
const stripWebpChunks = (input: Uint8Array): { bytes: Uint8Array; changed: boolean } => {
  const kept: Uint8Array[] = [];
  let removedChunk = false;
  let keptLength = 0;
  let vp8xFlagsOffset = -1;
  let vp8xFlags = 0;
  let offset = 12;

  while (offset + 8 <= input.length) {
    const fourCc = asciiAt(input, offset, 4);
    const dataLength = readUint32LittleEndian(input, offset + 4);
    const chunkEnd = offset + 8 + dataLength + (dataLength % 2);
    if (chunkEnd > input.length) {
      break;
    }
    if (WEBP_METADATA_CHUNKS.has(fourCc)) {
      removedChunk = true;
    } else {
      if (fourCc === 'VP8X') {
        // The flags byte sits immediately after the chunk's 8-byte header.
        vp8xFlagsOffset = 12 + keptLength + 8;
        vp8xFlags = input[vp8xFlagsOffset] as number;
      }
      kept.push(input.subarray(offset, chunkEnd));
      keptLength += chunkEnd - offset;
    }
    offset = chunkEnd;
  }

  // Nothing to remove *and* no stale flag advertising a chunk that is already
  // absent ⇒ the input is already clean. Returning the same reference here is
  // what makes the hub's second pass a genuine no-op.
  const needsFlagClear =
    vp8xFlagsOffset >= 0 && (vp8xFlags & (WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG)) !== 0;
  if (!(removedChunk || needsFlagClear)) {
    return { bytes: input, changed: false };
  }

  const output = concatRanges([input.subarray(0, 12), ...kept], input.subarray(offset));

  // The `VP8X` flags byte advertises which feature chunks follow. A decoder
  // told to expect an EXIF chunk that is no longer there can fail or warn, so
  // the bits are cleared in place — same length, no growth.
  if (needsFlagClear) {
    output[vp8xFlagsOffset] =
      (output[vp8xFlagsOffset] as number) & ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
  }

  // RIFF size = everything after the 8-byte "RIFF" + size header.
  writeUint32LittleEndian(output, 4, output.length - 8);
  return { bytes: output, changed: true };
};

/**
 * Strips container metadata that could carry the creator's local paths.
 *
 * Idempotent and never grows its input, so it can run in the client publish
 * transport and again in the hub without perturbing the declared size, the
 * `Content-Length` or the stored hash.
 *
 * @param input - The bytes as the creator exported them.
 * @returns The bytes to store, the parsed container, and whether anything was
 * removed. An unrecognised container is returned as the same reference.
 */
export const stripImageMetadata = (input: Uint8Array): StrippedImageBytes => {
  let format: StrippableImageFormat;
  let result: { bytes: Uint8Array; changed: boolean };

  if (isJpeg(input)) {
    format = 'jpeg';
    result = stripJpegSegments(input);
  } else if (isPng(input)) {
    format = 'png';
    result = stripPngChunks(input);
  } else if (isWebp(input)) {
    format = 'webp';
    result = stripWebpChunks(input);
  } else {
    return { bytes: input, format: 'unknown', changed: false };
  }

  // Fail safe: a rewrite that produced nothing usable is not an improvement on
  // the original bytes.
  if (result.bytes.length === 0) {
    return { bytes: input, format: 'unknown', changed: false };
  }

  // A JPEG that no longer scans to its start-of-scan marker is not a JPEG we
  // understood — keep the original rather than ship a headerless stub.
  if (format === 'jpeg') {
    let sawStartOfScan = false;
    for (let index = 2; index + 1 < result.bytes.length; index++) {
      if (result.bytes[index] === 0xff && result.bytes[index + 1] === JPEG_SOS_MARKER) {
        sawStartOfScan = true;
        break;
      }
    }
    if (!sawStartOfScan) {
      return { bytes: input, format: 'unknown', changed: false };
    }
  }

  return { bytes: result.bytes, format, changed: result.changed };
};

/** Convenience wrapper when only the bytes matter. */
export const stripImageMetadataBytes = (input: Uint8Array): Uint8Array =>
  stripImageMetadata(input).bytes;
