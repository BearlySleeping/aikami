// scripts/src/lib/catalog/index_activation.ts
//
// The index-upload and release-activation phase of a catalog publish.
//
// Extracted from `pipeline.ts` for two reasons, both structural rather than
// cosmetic:
//
//   • `pipeline.ts` was at the source-file-size hard limit, and the phase is a
//     self-contained responsibility — it shares nothing with the preflight,
//     asset-upload or thumbnail phases beyond the R2 client;
//   • activation is the one decision a release must be able to justify, so it
//     belongs in a function whose whole body is that decision. `releaseWritten`
//     comes from the publisher's own pointer write, never from an exit code: an
//     exit code cannot distinguish "the pointer advanced" from "everything
//     uploaded but the pointer write failed", and those have opposite rollback
//     semantics.
//
// Ordering is the guarantee:
//
//   1. every shard, then the root — never a root pointing at missing shards;
//   2. the versioned release pointer LAST — readers see the old complete
//      release or the new complete release, never a mixture;
//   3. the mutable compatibility alias only after the pointer moved.

import { createHash } from 'node:crypto';
import { PACK_LOCK_KEY, ReleasePointerSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { ASSET_CACHE_CONTROL, INDEX_CACHE_CONTROL, INDEX_KEY_PREFIX } from './config.ts';
import type { CatalogIndexRoot, GeneratedShard } from './index_generation.ts';
import type { PackLockPublishReport } from './publish_report.ts';
import type { SeedPublishReport } from './seed_publish.ts';
import type { R2ClientLike } from './upload.ts';

/**
 * Key of the versioned release pointer document (C-496 AC-4).
 *
 * Written atomically only after every required object, shard, seed file and
 * the root index are confirmed uploaded; the previous complete release stays
 * readable at this key until then.
 */
export const RELEASE_POINTER_KEY = 'index/v1/release.json';

/** SHA-256 hex digest of a UTF-8 string. */
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Content-addressed key of one immutable index revision. */
export const immutableIndexKey = (options: { name: string; hash: string }): string =>
  `${INDEX_KEY_PREFIX}revisions/${options.hash}/${options.name}.json`;

/**
 * What the index upload actually achieved. `releaseWritten` is the only
 * trustworthy activation signal: an exit code cannot distinguish "the pointer
 * advanced" from "everything uploaded but the pointer write failed".
 */
type IndexActivation = {
  rootKey: string;
  shardKeys: string[];
  releaseWritten: boolean;
  /** The pointer already named this exact root, so it was deliberately not rewritten. */
  alreadyActive: boolean;
  legacyAlias: { key: string; written: boolean; error?: string };
  packLock: PackLockPublishReport;
  failedIndexKeys: string[];
};

/**
 * The versioned release pointer: the document that pins this release's exact
 * root, shard and dependency revisions.
 */
const buildReleasePointer = (options: {
  releaseId: string;
  rootKey: string;
  rootHash: string;
  shards: readonly { id: string; key: string; hash: string }[];
  seedReport: SeedPublishReport;
  packLockReport: PackLockPublishReport;
}): Record<string, unknown> => ({
  schemaVersion: 'catalog.release.v1',
  releaseId: options.releaseId,
  rootKey: options.rootKey,
  rootHash: options.rootHash,
  shards: options.shards.map((shard) => ({
    category: shard.id,
    key: shard.key,
    hash: shard.hash,
  })),
  // Project to the pointer's exact dependency shape: `additionalProperties:
  // false` on ReleaseDependencySchema means the seed report's extra `carried`
  // flag must not leak into the published graph. Dependencies pin every
  // immutable seed file, plus the per-pack installed lock when one was produced
  // — so the release graph names the lock the client verifies audio against
  // (C-523 AC-5).
  dependencies: [
    ...options.seedReport.objects.map((object) => ({ key: object.key, hash: object.hash })),
    ...(options.packLockReport.written && options.packLockReport.hash
      ? [{ key: options.packLockReport.key, hash: options.packLockReport.hash }]
      : []),
  ],
  publishedAt: options.releaseId,
});

/**
 * Uploads the immutable index objects and, only once every shard it references
 * is confirmed present, advances the release pointer LAST.
 *
 * A partial publish therefore never leaves a root pointing at missing shards:
 * on any shard failure the previous complete release stays authoritative, and
 * the mutable compatibility alias is never advanced before the pointer.
 */
export const publishIndexAndActivate = async (options: {
  client: R2ClientLike;
  root: CatalogIndexRoot;
  shards: readonly GeneratedShard[];
  releaseId: string;
  seedReport: SeedPublishReport;
  packLockReport: PackLockPublishReport;
  packLockBody: Buffer | undefined;
  /**
   * Root hash the target already serves, from the verified previous release.
   *
   * When it equals this release's root, every byte the pointer would name is
   * already active. Writing the pointer anyway would advance it to a new
   * `releaseId` that describes the same release — a pointer change fabricated
   * to make a retry look like progress. So the pointer write is SKIPPED and
   * `alreadyActive` is reported instead.
   */
  alreadyActiveRootHash?: string;
}): Promise<IndexActivation> => {
  const { client, root, seedReport } = options;
  const rootJson = JSON.stringify(root, null, 2);
  const rootHash = sha256Hex(rootJson);
  const rootKey = immutableIndexKey({ name: 'catalog', hash: rootHash });
  const immutableShards = options.shards.map((shard) => {
    const hash = sha256Hex(shard.json);
    return { ...shard, hash, key: immutableIndexKey({ name: shard.id, hash }) };
  });
  const shardKeys = immutableShards.map((shard) => shard.key);
  const alreadyActive = options.alreadyActiveRootHash === rootHash;

  const failedIndexKeys: string[] = [];
  const putIndexObject = async (object: {
    key: string;
    json: string;
    cacheControl?: string;
  }): Promise<void> => {
    try {
      await client.putObject({
        key: object.key,
        body: Buffer.from(object.json, 'utf8'),
        contentType: 'application/json',
        cacheControl: object.cacheControl ?? ASSET_CACHE_CONTROL,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Index upload failed: ${object.key} — ${message}`);
      failedIndexKeys.push(object.key);
    }
  };

  // The mutable legacy compatibility alias is maintained ONLY after the
  // immutable release is active. Its outcome is tracked separately from
  // `failedIndexKeys`: a failed alias write leaves the immutable release
  // internally correct, so it must not be reported as a release failure — but
  // the report must not claim the alias was updated either.
  const legacyAlias: { key: string; written: boolean; error?: string } = {
    key: PACK_LOCK_KEY,
    written: false,
  };
  const writeLegacyAlias = async (body: string): Promise<void> => {
    try {
      await client.putObject({
        key: PACK_LOCK_KEY,
        body: Buffer.from(body, 'utf8'),
        contentType: 'application/json',
        cacheControl: INDEX_CACHE_CONTROL,
      });
      legacyAlias.written = true;
    } catch (error) {
      legacyAlias.error = error instanceof Error ? error.message : String(error);
      console.warn(
        `  ⚠ legacy pack-lock alias not updated (immutable release unaffected): ${legacyAlias.error}`,
      );
    }
  };
  const unsettled = (packLock: PackLockPublishReport): IndexActivation => ({
    rootKey,
    shardKeys,
    releaseWritten: false,
    alreadyActive: false,
    legacyAlias,
    packLock,
    failedIndexKeys,
  });

  // Upload every shard first.
  for (const shard of immutableShards) {
    await putIndexObject({ key: shard.key, json: shard.json });
  }
  if (failedIndexKeys.length > 0) {
    console.error(
      `  ⛔ ${failedIndexKeys.length} shard(s) failed — release pointer NOT advanced (previous release preserved).`,
    );
    return unsettled(options.packLockReport);
  }

  await putIndexObject({ key: rootKey, json: rootJson });
  // Seed failures block the release too: a missing seed file means offline
  // boot/credits data is incomplete, so the publish must not report ok.
  if (failedIndexKeys.length > 0 || seedReport.failed > 0) {
    return unsettled(options.packLockReport);
  }

  // The release this pointer would name is already the one being served. The
  // immutable objects above were still written (idempotent by content address,
  // and a missing one would be a real gap), but the pointer is left alone.
  if (alreadyActive) {
    console.log(
      `  🔁 release already active at root ${rootHash.slice(0, 12)}… — pointer NOT rewritten`,
    );
    if (options.packLockBody !== undefined) {
      // The alias is mutable and idempotent; rewriting it repairs a previous
      // run whose alias write degraded, without touching the release pointer.
      await writeLegacyAlias(options.packLockBody.toString('utf8'));
    }
    return {
      rootKey,
      shardKeys,
      releaseWritten: false,
      alreadyActive: true,
      legacyAlias,
      packLock: { ...options.packLockReport, legacyAliasWritten: legacyAlias.written },
      failedIndexKeys,
    };
  }

  const releasePointer = buildReleasePointer({
    releaseId: options.releaseId,
    rootKey,
    rootHash,
    shards: immutableShards,
    seedReport,
    packLockReport: options.packLockReport,
  });
  if (!Value.Check(ReleasePointerSchema, releasePointer)) {
    console.error('  ⛔ Generated release pointer failed validation — release NOT advanced.');
    return unsettled(options.packLockReport);
  }

  // Write the versioned release pointer LAST, pinning the exact root, shard
  // and dependency revisions of this complete release. Writing it here (after
  // every required object is confirmed) means readers fetch either the old
  // complete release or the new complete release, never a mixture. On any
  // failure the pointer is left untouched (AC-4).
  await putIndexObject({
    key: RELEASE_POINTER_KEY,
    json: JSON.stringify(releasePointer, null, 2),
    cacheControl: INDEX_CACHE_CONTROL,
  });
  const releaseWritten = failedIndexKeys.length === 0;
  if (!releaseWritten) {
    return unsettled(options.packLockReport);
  }
  // A pack with no image pins legitimately produces no lock body; that is not a
  // publish failure, so activation stands and only the mutable alias is skipped.
  if (options.packLockBody === undefined) {
    return {
      rootKey,
      shardKeys,
      releaseWritten,
      alreadyActive: false,
      legacyAlias,
      packLock: options.packLockReport,
      failedIndexKeys,
    };
  }
  // Activation point: the pointer is the authoritative surface. Only now is
  // the mutable compatibility alias allowed to move.
  await writeLegacyAlias(options.packLockBody.toString('utf8'));
  return {
    rootKey,
    shardKeys,
    releaseWritten,
    alreadyActive: false,
    legacyAlias,
    packLock: { ...options.packLockReport, legacyAliasWritten: legacyAlias.written },
    failedIndexKeys,
  };
};
