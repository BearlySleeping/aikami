// apps/frontend/pwa/src/lib/services/character/png-utils.ts

/**
 * Extracts tEXt chunks from a PNG file's binary data.
 * @param options - The options object containing the binary data
 * @returns A dictionary of text chunks
 */
export const extractTextChunks = (options: { data: Uint8Array }): Record<string, string> => {
  const { data } = options;
  const chunks: Record<string, string> = {};
  const dataView = new DataView(data.buffer);
  let pos = 8; // Skip PNG signature

  while (pos < data.length) {
    if (pos + 8 > data.length) {
      break;
    }

    const length = dataView.getUint32(pos);
    const typeBytes = data.slice(pos + 4, pos + 8);
    const type = new TextDecoder().decode(typeBytes);

    if (type === 'IEND') {
      break;
    }

    if (type === 'tEXt') {
      const chunkData = data.slice(pos + 8, pos + 8 + length);
      const separatorIndex = chunkData.indexOf(0);

      if (separatorIndex !== -1) {
        const key = new TextDecoder().decode(chunkData.slice(0, separatorIndex));
        const value = new TextDecoder().decode(chunkData.slice(separatorIndex + 1));
        chunks[key] = value;
      }
    }

    pos += 12 + length; // 4 length + 4 type + length data + 4 CRC
  }

  return chunks;
};

/**
 * Validates if a file has a valid PNG signature.
 * @param options - The options object containing the file buffer
 * @returns True if the file is a PNG
 */
export const isPng = (options: { buffer: ArrayBuffer }): boolean => {
  const { buffer } = options;
  const uint8Array = new Uint8Array(buffer);
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (uint8Array.length < 8) {
    return false;
  }
  return pngSignature.every((byte, i) => uint8Array[i] === byte);
};
