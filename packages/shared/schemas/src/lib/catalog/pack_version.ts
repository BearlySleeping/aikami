// packages/shared/schemas/src/lib/catalog/pack_version.ts
//
// Catalog API-boundary wire shape for an immutable published pack version
// (C-394). `manifestHash` is the content address joining this row to its
// entry in the static index — the only coupling between the write model
// and the read model.

import { type Static, Type } from 'typebox';
import { SEMVER_PATTERN } from '../game/content_pack.ts';

/** sha256 of the canonical manifest bytes — lowercase 64-char hex. */
const MANIFEST_HASH_PATTERN = '^[0-9a-f]{64}$';

/**
 * Read shape of a pack version as exposed on the wire.
 *
 * Omits the internal uuid and the server-assigned published timestamp —
 * a version's identity on the wire is (pack identity + semver), and its
 * content is addressed by the manifest hash.
 */
export const PackVersionSchema = Type.Object({
  /** Semver string, unique per pack — (pack_id, version) is UNIQUE in storage. */
  version: Type.String({
    pattern: SEMVER_PATTERN,
    description: 'Semver version string, unique per pack',
  }),
  /** sha256 of the canonical manifest bytes — joins this row to the static index. */
  manifestHash: Type.String({
    pattern: MANIFEST_HASH_PATTERN,
    description: 'sha256 content address of the manifest',
  }),
});

export type PackVersion = Static<typeof PackVersionSchema>;
