// apps/frontend/client/src/lib/views/studio/studio_file_support.ts
//
// C-512/C-521 — pure helpers the Studio ViewModel uses for files and labels.
//
// Extracted so the ViewModel stays a thin state machine: reading a picked file
// as a data URL, formatting a byte size and wording an unknown error are all
// value-in / value-out concerns with no view state behind them.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

export const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Reads a picked file as a data URL (the engine's img2img payload shape). */
export const readFileAsDataUrl = async (file: File): Promise<string> => {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
  }
  return `data:${file.type || 'image/png'};base64,${btoa(binary)}`;
};

/** Human-readable byte size — the library shows provenance and size per entry. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
