import { describe, expect, test } from 'bun:test';
import { CharacterImporter } from './character-importer.ts';

/**
 * Wraps a Uint8Array into a File, handling the ArrayBufferLike vs ArrayBuffer
 * type mismatch by copying to a plain ArrayBuffer.
 */
function toFile(data: Uint8Array, name: string, type: string): File {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new File([buffer], name, { type });
}

/**
 * Helper to build a minimal valid PNG binary with an embedded tEXt chunk.
 * The PNG structure:
 *   - 8-byte PNG signature
 *   - IHDR chunk (13 bytes data)
 *   - tEXt chunk (keyword\0base64text)
 *   - IEND chunk (0 bytes data)
 *
 * CRC values are computed correctly using the crc-32 library (same as png-chunks-extract).
 */
async function buildPngWithTextChunk(keyword: string, text: string): Promise<Uint8Array> {
  const { default: crc32 } = await import('crc-32');

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 13 bytes of data (1x1 pixel, 8-bit RGB)
  const ihdrData = new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x01, // width: 1
    0x00,
    0x00,
    0x00,
    0x01, // height: 1
    0x08, // bit depth: 8
    0x02, // color type: RGB
    0x00, // compression method
    0x00, // filter method
    0x00, // interlace method
  ]);
  const ihdrChunk = buildChunk('IHDR', ihdrData, crc32);

  // tEXt chunk: keyword\0text
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const textChunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  textChunkData.set(keywordBytes, 0);
  textChunkData[keywordBytes.length] = 0; // null separator
  textChunkData.set(textBytes, keywordBytes.length + 1);
  const textChunk = buildChunk('tEXt', textChunkData, crc32);

  // IEND chunk: 0 bytes of data
  const iendChunk = buildChunk('IEND', new Uint8Array(0), crc32);

  // Combine all parts
  const totalLength = signature.length + ihdrChunk.length + textChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLength);
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(textChunk, offset);
  offset += textChunk.length;
  png.set(iendChunk, offset);

  return png;
}

/**
 * Builds a single PNG chunk with proper length, type, data, and CRC.
 */
// biome-ignore lint/suspicious/noExplicitAny: crc-32 module types are loose
function buildChunk(type: string, data: Uint8Array, crc32: any): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  // Length (4 bytes) + Type (4 bytes) + Data + CRC (4 bytes)
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  // Write data length (big-endian)
  view.setUint32(0, data.length);

  // Write type
  chunk.set(typeBytes, 4);

  // Write data
  chunk.set(data, 8);

  // Compute CRC over type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crcValue = crc32.buf(crcInput);
  view.setInt32(4 + 4 + data.length, crcValue);

  return chunk;
}

describe('CharacterImporter', () => {
  describe('parsePngCard', () => {
    test('should extract and parse character data from a valid PNG with chara tEXt chunk', async () => {
      const characterData = {
        spec: 'chara_card_v2',
        data: {
          name: 'Test Character',
          description: 'A brave adventurer',
        },
      };
      const base64 = btoa(JSON.stringify(characterData));
      const pngBytes = await buildPngWithTextChunk('chara', base64);
      const file = toFile(pngBytes, 'character.png', 'image/png');

      const result = await CharacterImporter.parsePngCard(file);

      expect(result).toEqual(characterData);
    });

    test('should throw an AppError for non-PNG files', async () => {
      const file = new File(['not a png file'], 'fake.png', { type: 'image/png' });

      try {
        await CharacterImporter.parsePngCard(file);
        expect(true).toBe(false); // should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('Invalid PNG file');
        expect((err.cause as { errorType: string }).errorType).toBe('invalid-argument');
      }
    });

    test('should throw an AppError when PNG has no chara tEXt chunk', async () => {
      // Build a valid PNG with a non-chara keyword
      const pngBytes = await buildPngWithTextChunk('other', 'some text');
      const file = toFile(pngBytes, 'no-chara.png', 'image/png');

      try {
        await CharacterImporter.parsePngCard(file);
        expect(true).toBe(false); // should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('No character data found');
        expect((err.cause as { errorType: string }).errorType).toBe('not-found');
      }
    });

    test('should throw an AppError when chara chunk contains invalid base64', async () => {
      // Build a PNG with "chara" keyword but invalid base64 content
      const pngBytes = await buildPngWithTextChunk('chara', '!!!not-valid-base64!!!');
      const file = toFile(pngBytes, 'bad-base64.png', 'image/png');

      try {
        await CharacterImporter.parsePngCard(file);
        expect(true).toBe(false); // should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('invalid base64');
        expect((err.cause as { errorType: string }).errorType).toBe('invalid-argument');
      }
    });

    test('should throw an AppError when chara chunk contains invalid JSON', async () => {
      // Base64-encode a string that is not valid JSON
      const base64 = btoa('this is not json');
      const pngBytes = await buildPngWithTextChunk('chara', base64);
      const file = toFile(pngBytes, 'bad-json.png', 'image/png');

      try {
        await CharacterImporter.parsePngCard(file);
        expect(true).toBe(false); // should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('invalid JSON');
        expect((err.cause as { errorType: string }).errorType).toBe('invalid-argument');
      }
    });

    test('should throw an AppError for empty files', async () => {
      const file = toFile(new Uint8Array(0), 'empty.png', 'image/png');

      try {
        await CharacterImporter.parsePngCard(file);
        expect(true).toBe(false); // should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('Invalid PNG file');
        expect((err.cause as { errorType: string }).errorType).toBe('invalid-argument');
      }
    });

    test('should skip tEXt chunks with non-chara keywords and find the chara chunk', async () => {
      // Build a PNG with multiple tEXt chunks - we need to do this manually
      const { default: crc32 } = await import('crc-32');

      const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const ihdrData = new Uint8Array([
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
      ]);
      const ihdrChunk = buildChunk('IHDR', ihdrData, crc32);

      // First tEXt chunk with "comment" keyword
      const commentText = new TextEncoder().encode('comment\0This is a comment');
      const commentChunk = buildChunk('tEXt', commentText, crc32);

      // Second tEXt chunk with "chara" keyword
      const characterData = { name: 'Found Me' };
      const base64 = btoa(JSON.stringify(characterData));
      const charaText = new TextEncoder().encode(`chara\0${base64}`);
      const charaChunk = buildChunk('tEXt', charaText, crc32);

      const iendChunk = buildChunk('IEND', new Uint8Array(0), crc32);

      const totalLength =
        signature.length +
        ihdrChunk.length +
        commentChunk.length +
        charaChunk.length +
        iendChunk.length;
      const png = new Uint8Array(totalLength);
      let offset = 0;
      png.set(signature, offset);
      offset += signature.length;
      png.set(ihdrChunk, offset);
      offset += ihdrChunk.length;
      png.set(commentChunk, offset);
      offset += commentChunk.length;
      png.set(charaChunk, offset);
      offset += charaChunk.length;
      png.set(iendChunk, offset);

      const file = toFile(png, 'multi-text.png', 'image/png');

      const result = await CharacterImporter.parsePngCard(file);

      expect(result).toEqual({ name: 'Found Me' });
    });
  });
});
