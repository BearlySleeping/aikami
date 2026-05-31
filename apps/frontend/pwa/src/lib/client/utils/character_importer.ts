import { toAppError } from '@aikami/utils';
import extractChunks from 'png-chunks-extract';

/**
 * Utility for extracting hidden JSON character data from PNG character cards.
 *
 * Character cards (SillyTavern/RisuAI format) embed a base64-encoded JSON string
 * inside a PNG tEXt chunk, typically under the keyword "chara".
 */
export class CharacterImporter {
  /**
   * Parses a PNG character card file and extracts the embedded JSON data.
   *
   * @param file - A PNG file containing embedded character card data in a tEXt chunk.
   * @returns The parsed JSON data from the character card.
   * @throws {Error} AppError with type 'invalid-argument' if the file is not a valid PNG
   *   or if no character data is found.
   */
  static async parsePngCard(file: File): Promise<unknown> {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let chunks: Array<{ name: string; data: Uint8Array }>;
    try {
      chunks = extractChunks(uint8Array);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: `Invalid PNG file: ${message}`,
      });
    }

    for (const chunk of chunks) {
      if (chunk.name !== 'tEXt') {
        continue;
      }

      const chunkString = new TextDecoder().decode(chunk.data);
      const separatorIndex = chunkString.indexOf('\0');

      if (separatorIndex === -1) {
        continue;
      }

      const keyword = chunkString.slice(0, separatorIndex);
      const text = chunkString.slice(separatorIndex + 1);

      if (keyword !== 'chara') {
        continue;
      }

      let decoded: string;
      try {
        decoded = atob(text);
      } catch {
        throw toAppError({
          errorType: 'invalid-argument',
          errorMessage: 'Character card contains invalid base64 data in chara chunk',
        });
      }

      try {
        return JSON.parse(decoded);
      } catch {
        throw toAppError({
          errorType: 'invalid-argument',
          errorMessage: 'Character card contains invalid JSON after base64 decoding',
        });
      }
    }

    throw toAppError({
      errorType: 'not-found',
      errorMessage: 'No character data found in PNG file (missing chara tEXt chunk)',
    });
  }
}
