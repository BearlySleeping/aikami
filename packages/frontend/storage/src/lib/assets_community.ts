// packages/frontend/storage/src/lib/assets_community.ts
//
// C-513 — the community-asset import seam.
//
// An approved community asset is imported into the local registry as an `r2`
// source: the same backend + content-addressed URL shape the curated catalog
// uses, so the existing resolver, cache and prefetch paths pick it up with no
// new resolution path. Importing is local-first — after the import the bytes
// live in the on-device cache and resolve with no network.
//
// AC-11: an import never *silently* replaces a curated (seed) tag or a
// different local accepted asset. The collision is returned for an explicit
// decision (`'version'` = keep both, bump the registry version) and nothing is
// written until then.
//
// Contract: C-513 AC-4 / AC-10 / AC-11

import { COMMUNITY_ASSET_PACK_ID, GENERATED_ASSET_PACK_ID } from '@aikami/constants';
import { logger } from '$logger';
import type { LocalDatabaseInterface } from './storage_adapter.ts';

/** Input for the community-asset registry write. */
export type CommunityAssetRegistration = {
  /** Resolver tag — must satisfy the `AssetRefSchema.tag` shape. */
  tag: string;
  /** Lowercase hex SHA-256 of the promoted bytes (the content address). */
  hash: string;
  sizeBytes: number;
  category: string;
  /** Public content-addressed URL the bytes resolve from. */
  url: string;
  /** Redacted provenance source (`original`, `generated:<provider>`, a URL). */
  provenanceSource: string;
  /** Licence identifier carried into the registry row. */
  license?: string;
  /**
   * Explicit collision decision (AC-11). Absent ⇒ a collision is surfaced and
   * nothing is written.
   */
  collision?: 'version';
};

/** Why an import did not become resolvable. */
export type CommunityAssetCollisionKind = 'seed' | 'local-generated' | 'community-import';

/** Result of a community-asset import. */
export type CommunityAssetImportResult = {
  imported: boolean;
  tag: string;
  hash: string;
  /** Registry row version after the write. */
  version?: number;
  /** True when identical bytes for this tag were already registered. */
  unchanged?: boolean;
  /**
   * Present when the import was refused pending an explicit decision. The
   * caller surfaces this and re-runs with `collision: 'version'` (or renames).
   */
  collision?: { kind: CommunityAssetCollisionKind; existingHash: string };
  /** Why the write was a no-op. */
  reason?: string;
};

/**
 * Classifies the current owner of a colliding tag.
 *
 * @param packId - The `assets.pack_id` of the existing row.
 */
const collisionKindFor = (packId: string): CommunityAssetCollisionKind => {
  if (packId === GENERATED_ASSET_PACK_ID) {
    return 'local-generated';
  }
  if (packId === COMMUNITY_ASSET_PACK_ID) {
    return 'community-import';
  }
  return 'seed';
};

/**
 * Registers an imported community asset as a first-class registry asset.
 *
 * Order: collision check → row upsert → `r2` source row. A tag owned by the
 * boot seed or by a *different* local generated asset is never overwritten
 * implicitly; identical bytes for the same owned tag are idempotent.
 *
 * @param db — The shared local database connection.
 * @param asset — The promoted asset's identity + provenance projection.
 */
export const registerCommunityAssetRow = async (
  db: LocalDatabaseInterface,
  asset: CommunityAssetRegistration,
): Promise<CommunityAssetImportResult> => {
  const base = { tag: asset.tag, hash: asset.hash };

  const existingResult = await db.query({
    sql: 'SELECT id, pack_id, hash, version FROM assets WHERE id = ?',
    args: [asset.tag],
  });
  const existing = existingResult.rows[0];

  if (existing) {
    const existingPackId = existing.pack_id as string;
    const existingHash = existing.hash as string;

    // Identical bytes for a tag we already own ⇒ nothing to do (idempotent).
    if (existingHash === asset.hash) {
      logger.debug('assets_community:import-unchanged', {
        tag: asset.tag,
        hash: asset.hash,
      });
      return {
        ...base,
        imported: true,
        unchanged: true,
        version: existing.version as number,
      };
    }

    // Different bytes under an existing tag. Which owner it belongs to decides
    // whether an explicit decision is even possible:
    //   * seed (curated catalog)  — never shadowed, not even explicitly;
    //   * local-generated         — the owner's own work outranks an import;
    //   * community-import        — an earlier import of the same tag.
    const kind = collisionKindFor(existingPackId);

    if (kind === 'seed' || asset.collision !== 'version') {
      logger.info('assets_community:import-collision', {
        tag: asset.tag,
        kind,
      });
      return {
        ...base,
        imported: false,
        reason: 'tag_collision',
        collision: { kind, existingHash },
      };
    }
  }

  const unchanged = false;
  let version = 1;
  if (existing) {
    version = (existing.version as number) + 1;
  }

  const queries: { sql: string; args: readonly unknown[] }[] = [
    {
      sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')
            ON CONFLICT(id) DO UPDATE SET
              pack_id = excluded.pack_id,
              category = excluded.category,
              hash = excluded.hash,
              version = excluded.version,
              size_bytes = excluded.size_bytes,
              license = excluded.license,
              attribution = excluded.attribution`,
      args: [
        asset.tag,
        COMMUNITY_ASSET_PACK_ID,
        asset.category,
        asset.hash,
        version,
        asset.sizeBytes,
        asset.license ?? 'unknown',
        asset.provenanceSource,
      ],
    },
    {
      // The URL is the public content-addressed object — a stable cache key,
      // never a session-scoped blob URL. Priority 0 sits behind a
      // local-generated row (-1) and level with the curated catalog.
      sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
            VALUES (?, 'r2', ?, 0)`,
      args: [asset.tag, asset.url],
    },
  ];

  await db.transaction(queries);
  // 🔴 Durability, not tidiness. The snapshot adapter debounces its persistence
  // (300 ms) and its `pagehide` flush is fire-and-forget, so an import followed
  // by an immediate reload — exactly the scenario AC-10 exercises — could lose
  // the row. `registerGenerated` awaits the same flush for the same reason.
  await db.flush?.();

  logger.info('assets_community:imported', {
    tag: asset.tag,
    hash: asset.hash,
    sizeBytes: asset.sizeBytes,
    version,
  });

  return { ...base, imported: true, unchanged, version };
};
