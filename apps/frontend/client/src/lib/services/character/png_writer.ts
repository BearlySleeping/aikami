// apps/frontend/client/src/lib/services/character/png_writer.ts
//
// PNG tEXt chunk writer with CRC-32 for Aikami character card export (C-246).
// Writes JSON metadata into a tEXt chunk in an existing PNG, or creates a
// minimal placeholder PNG when no avatar is available.

import { AIKAMI_PNG_CHUNK_KEYWORD } from '@aikami/constants';

// ── CRC-32 ─────────────────────────────────────────────────────────────

const _crcTable: number[] = [];

const _buildCrcTable = (): void => {
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crcTable[n] = c;
  }
};

/**
 * Computes CRC-32 for a Uint8Array of data.
 */
export const crc32 = (data: Uint8Array): number => {
  if (_crcTable.length === 0) {
    _buildCrcTable();
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// ── tEXt chunk builder ──────────────────────────────────────────────────

/**
 * Creates a tEXt PNG chunk as a Uint8Array (length + type + data + CRC).
 *
 * @param keyword - The chunk keyword (must be ASCII, 1-79 chars).
 * @param text - The text value to store.
 * @returns The complete chunk bytes (length + type + keyword\0text + CRC).
 */
export const buildTextChunk = (options: { keyword: string; text: string }): Uint8Array => {
  const { keyword, text } = options;

  // Encode keyword + null separator + text
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const nullByte = new Uint8Array([0]);
  const textBytes = encoder.encode(text);

  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData.set(nullByte, keywordBytes.length);
  chunkData.set(textBytes, keywordBytes.length + 1);

  // Build type + data for CRC
  const typeBytes = encoder.encode('tEXt');
  const crcInput = new Uint8Array(typeBytes.length + chunkData.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, typeBytes.length);

  const crcValue = crc32(crcInput);

  // Length (4 bytes, big-endian)
  const length = chunkData.length;
  const lengthBytes = new Uint8Array(4);
  const lengthView = new DataView(lengthBytes.buffer);
  lengthView.setUint32(0, length);

  // CRC (4 bytes, big-endian)
  const crcBytes = new Uint8Array(4);
  const crcView = new DataView(crcBytes.buffer);
  crcView.setUint32(0, crcValue);

  // Assemble: length + type + data + CRC
  const result = new Uint8Array(4 + typeBytes.length + chunkData.length + 4);
  result.set(lengthBytes, 0);
  result.set(typeBytes, 4);
  result.set(chunkData, 8);
  result.set(crcBytes, 8 + chunkData.length);

  return result;
};

// ── PNG embedding ───────────────────────────────────────────────────────

/**
 * Embeds a tEXt chunk with the given keyword and JSON text into an existing
 * PNG binary. The chunk is inserted before the first IDAT chunk.
 *
 * @param pngData - The raw PNG bytes.
 * @param keyword - The tEXt chunk keyword.
 * @param text - The JSON text to embed.
 * @returns A new Uint8Array with the tEXt chunk inserted.
 */
export const embedTextChunk = (options: {
  pngData: Uint8Array;
  keyword: string;
  text: string;
}): Uint8Array => {
  const { pngData, keyword, text } = options;

  const tEXtChunk = buildTextChunk({ keyword, text });
  const result = new Uint8Array(pngData.length + tEXtChunk.length);

  // PNG signature (8 bytes)
  result.set(pngData.slice(0, 8), 0);

  let srcPos = 8;
  let dstPos = 8;
  let inserted = false;

  const dataView = new DataView(pngData.buffer, pngData.byteOffset, pngData.byteLength);
  const decoder = new TextDecoder();

  while (srcPos < pngData.length) {
    if (srcPos + 8 > pngData.length) {
      break;
    }

    const chunkLength = dataView.getUint32(srcPos);
    const chunkType = decoder.decode(pngData.slice(srcPos + 4, srcPos + 8));

    // Insert tEXt chunk before the first IDAT
    if (!inserted && chunkType === 'IDAT') {
      result.set(tEXtChunk, dstPos);
      dstPos += tEXtChunk.length;
      inserted = true;
    }

    // Copy the current chunk
    const chunkSize = 12 + chunkLength; // 4 length + 4 type + length data + 4 CRC
    result.set(pngData.slice(srcPos, srcPos + chunkSize), dstPos);
    dstPos += chunkSize;
    srcPos += chunkSize;
  }

  return result.slice(0, dstPos);
};

// ── Minimal placeholder PNG ─────────────────────────────────────────────

/**
 * Helper: builds a complete PNG chunk (length + type + data + CRC).
 */
const _buildPngChunk = (options: { type: string; data: Uint8Array }): Uint8Array => {
  const { type, data } = options;
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);

  // Length (4 bytes, big-endian)
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, data.length);

  // CRC over type + data
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crcValue = crc32(crcInput);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crcValue);

  const result = new Uint8Array(4 + typeBytes.length + data.length + 4);
  result.set(lengthBytes, 0);
  result.set(typeBytes, 4);
  result.set(data, 8);
  result.set(crcBytes, 8 + data.length);

  return result;
};

/**
 * Creates a minimal 1x1 white pixel PNG with an embedded tEXt chunk.
 * Used as a fallback when the character has no avatar image.
 *
 * @param keyword - The tEXt chunk keyword.
 * @param text - The JSON text to embed.
 * @returns A minimal valid PNG as a Blob.
 */
export const createPlaceholderPngCard = (options: { keyword: string; text: string }): Blob => {
  const { keyword, text } = options;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 1x1, 8-bit grayscale
  const ihdrData = new Uint8Array([
    0,
    0,
    0,
    1, // width = 1
    0,
    0,
    0,
    1, // height = 1
    8, // bit depth = 8
    0, // color type = grayscale
    0, // compression
    0, // filter
    0, // interlace
  ]);

  // IDAT: 1x1 white pixel — zlib-compressed [filter=0, pixel=255]
  const idatData = new Uint8Array([
    0x78,
    0x01, // zlib header
    0x01, // final block, stored
    0x02,
    0x00, // length = 2
    0xfd,
    0xff, // complement
    0x00,
    0xff, // data: filter none, white pixel
    0x00,
    0x40,
    0x00,
    0x40, // Adler-32
  ]);

  // IEND: empty
  const iendData = new Uint8Array(0);

  const chunks = [
    signature,
    _buildPngChunk({ type: 'IHDR', data: ihdrData }),
    buildTextChunk({ keyword, text }),
    _buildPngChunk({ type: 'IDAT', data: idatData }),
    _buildPngChunk({ type: 'IEND', data: iendData }),
  ];

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([result.buffer as ArrayBuffer], { type: 'image/png' });
};

/**
 * Embeds Aikami character card JSON into an avatar PNG.
 *
 * @param avatarBlob - The avatar image as a PNG Blob.
 * @param characterJson - The JSON string to embed.
 * @returns A new PNG Blob with the tEXt chunk.
 */
export const embedCharacterInPng = async (options: {
  avatarBlob: Blob;
  characterJson: string;
}): Promise<Blob> => {
  const { avatarBlob, characterJson } = options;
  const pngBuffer = await avatarBlob.arrayBuffer();
  const pngData = new Uint8Array(pngBuffer);

  const modified = embedTextChunk({
    pngData,
    keyword: AIKAMI_PNG_CHUNK_KEYWORD,
    text: characterJson,
  });

  return new Blob([modified.buffer as ArrayBuffer], { type: 'image/png' });
};
