// apps/frontend/client/src/lib/services/assets/asset_hasher.ts
//
// C-373: SHA-256 content hashing for asset binaries. Uses the native
// WebCrypto digest (available in browsers and Bun) so hashes always match
// the `asset_hashes.json` sidecar emitted by `scan_assets.ts` (Node crypto).
//
// Memory note: `blob.arrayBuffer()` materialises the file bytes once. For
// game assets (LPC spritesheets, audio, tilemaps — typically KBs to a few
// MB) this stays well under the 20 MB per-read budget. WebCrypto's digest
// is one-shot, so a single arrayBuffer read is the correct primitive here;
// the source data is never copied a second time.

/** Hex-encodes a SHA-256 digest buffer. */
const _toHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
};

/**
 * Computes the lowercase hex SHA-256 digest of a Blob.
 *
 * @param blob - The binary to hash.
 * @returns 64-char hex digest.
 */
export const sha256Hex = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return _toHex(new Uint8Array(digest));
};
