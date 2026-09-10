// packages/shared/schemas/src/lib/catalog/release_lock.ts
//
// Versioned release pointer + installed pack lock (C-496 AC-4).
//
// A catalog publish is revision-consistent only if readers can never observe
// a mixture of old and new objects. The pipeline advances a single release
// pointer document that names the exact manifest/shard revisions and required
// seed dependencies of a complete release; it is written ONLY after every
// required object, shard and seed file has been confirmed uploaded, so the
// previous complete release stays readable until then.
//
// `InstalledPackLockSchema` pins image and definition content hashes for an
// offline install: repacking an atlas cannot change logical frame identity or
// reskin a save, and an offline client validates its local bytes against the
// pinned hashes. The existing `index/v1/` path remains the read-compatible
// legacy surface for old clients.
//
// Contract: C-496

import { type Static, Type } from 'typebox';

/**
 * The current release-pointer schema version.
 */
export const RELEASE_POINTER_SCHEMA_VERSION = 'catalog.release.v1' as const;

/**
 * A pinned dependency required by a release (e.g. a seed/metadata file).
 */
export const ReleaseDependencySchema = Type.Object(
  {
    /** Stable key, e.g. `seed/asset_seed.json`. */
    key: Type.String({ minLength: 1 }),
    /** Immutable content hash of the dependency bytes. */
    hash: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ReleaseDependency = Static<typeof ReleaseDependencySchema>;

/**
 * A shard object included in a release.
 */
export const ReleaseShardSchema = Type.Object(
  {
    /** Category id, e.g. `lpc`. */
    category: Type.String({ minLength: 1 }),
    /** Content-addressed shard key, e.g. `index/v1/lpc.json`. */
    key: Type.String({ minLength: 1 }),
    /** Content hash of the shard bytes. */
    hash: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ReleaseShard = Static<typeof ReleaseShardSchema>;

/**
 * The versioned release pointer document.
 *
 * Consumers fetch this to learn which immutable manifest/shard revisions and
 * required dependencies constitute the current complete release. It is
 * written atomically last, so readers always see the old complete release or
 * the new complete release — never mixed revisions.
 */
export const ReleasePointerSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RELEASE_POINTER_SCHEMA_VERSION),
    /** Release id (e.g. a timestamp or monotonic sequence). */
    releaseId: Type.String({ minLength: 1 }),
    /** Root index key this release points at. */
    rootKey: Type.String({ minLength: 1 }),
    /** Content hash of the root index bytes. */
    rootHash: Type.String({ minLength: 1 }),
    /** Shard revisions included in this release. */
    shards: Type.Array(ReleaseShardSchema, { minItems: 1 }),
    /** Required dependencies (seed/metadata) pinned for offline install. */
    dependencies: Type.Array(ReleaseDependencySchema, { minItems: 1 }),
    /** UTC ISO timestamp of the publish. */
    publishedAt: Type.String(),
  },
  { additionalProperties: false },
);

export type ReleasePointer = Static<typeof ReleasePointerSchema>;

/**
 * A pinned image/definition hash in an installed pack lock.
 */
export const PackLockedAssetSchema = Type.Object(
  {
    /** Stable asset id. */
    id: Type.String({ minLength: 1 }),
    /** Content hash of the image bytes (immutable). */
    imageHash: Type.String({ minLength: 1 }),
    /** Content hash of the visual definition (immutable). */
    definitionHash: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type PackLockedAsset = Static<typeof PackLockedAssetSchema>;

/**
 * Installed pack lock — pins image and definition content hashes so an
 * offline install resolves the exact bytes a release was published against.
 *
 * Repacking an atlas cannot change logical frame identity or reskin a save
 * because logical frame identity is pinned to these hashes.
 */
export const InstalledPackLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RELEASE_POINTER_SCHEMA_VERSION),
    /** The release this lock was installed from. */
    releaseId: Type.String({ minLength: 1 }),
    /** Pinned image/definition hashes for the installed assets. */
    assets: Type.Array(PackLockedAssetSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type InstalledPackLock = Static<typeof InstalledPackLockSchema>;
