// scripts/src/lib/catalog/content_address.ts
//
// Content-addressed object keys for the catalog origin (C-395 AC-1).
//
// An object's key is derived from its sha256, not its source path — two
// versions of bgm_combat.webm are two objects that coexist; nothing is ever
// overwritten in place. This makes caching trivially correct and makes
// rollback a matter of publishing an older index.
//
// Layout (State & Data Models):
//   assets/<sha256[0:2]>/<sha256>.<ext>     immutable, Cache-Control: 1 year
//
// The two-character prefix shard keeps any single listing prefix under a few
// hundred objects.

/** Derive the content-addressed object key for an asset. */
export const assetKey = (options: { hash: string; ext: string }): string => {
  const { hash, ext } = options;
  // The hash IS the address — reject anything that is not a sha256 hex
  // digest before it reaches a bucket key.
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`assetKey: invalid sha256 hash ${JSON.stringify(hash)}`);
  }
  // ext may or may not include the leading dot (".webp"), must be lowercase
  // and path-safe (no separators or other invalid characters).
  const normalizedExt = ext.toLowerCase();
  if (!/^\.?[a-z0-9]+$/.test(normalizedExt)) {
    throw new Error(`assetKey: invalid extension ${JSON.stringify(ext)}`);
  }
  // The contract layout renders `<sha256>.<ext>`, so the stored name is
  // `<hash><ext>` with the leading dot preserved.
  const extSuffix = normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`;
  return `assets/${hash.slice(0, 2)}/${hash}${extSuffix}`;
};
