// scripts/src/lib/catalog/published_catalog.ts
//
// Carry-forward: publish the previous COMPLETE release plus this candidate's
// authoritative changes, instead of rebuilding the catalog from the local
// checkout alone.
//
// ── Why ────────────────────────────────────────────────────────────────────
//
// The publisher rebuilds the index from the local scan roots. That is correct
// only while the checkout holds the complete asset library. C-435 de-bundled
// the raw library, so this repository now carries a few dozen tags; a
// pack-scoped publish rebuilt from them alone would have replaced a
// ~12,700-entry catalog with those few dozen — silently deleting every LPC
// sheet, legacy portrait and audio bed the client still resolves. That is not a
// pack update, it is a truncation, and it would be invisible in the publish log
// ("0 uploaded, 74 skipped, 0 failed" reads like success).
//
// ── The invariant ──────────────────────────────────────────────────────────
//
//     verified previous release  +  current local authoritative changes
//                                =  new complete candidate release
//
// ── What "verified" means here ─────────────────────────────────────────────
//
// Resolution goes through `resolveReleaseGraph` from `@aikami/schemas` — the
// SAME resolver the production client boot path uses — so the two cannot
// drift. It validates the pointer against `ReleasePointerSchema` and
// SHA-256-verifies the root index, every shard, and every pinned dependency.
//
// Two consequences, both deliberate:
//
//   • The mutable `index/v1/catalog.json` alias is NOT read. Carrying entries
//     forward from an unverified mutable object would launder whatever it
//     happened to contain into a "complete release".
//   • A corrupt pointer or any integrity mismatch FAILS CLOSED. An unreadable
//     previous release is never treated as "no previous release", because that
//     reading turns corruption into silent data loss.
//
// An absent pointer is different, and is NOT an error: it means this origin has
// never published a release, so there is nothing to carry. The caller is told
// so explicitly (`previous: undefined`) rather than being handed an empty list
// it might mistake for a verified-empty catalog.

import type { CatalogAssetEntry, ReleaseDocumentReader } from '@aikami/schemas';
import { resolveReleaseGraph } from '@aikami/schemas';
import type { CatalogEntry } from './catalog_entries.ts';
import { entryToShardEntry } from './index_generation.ts';

/** Thrown when the previous release exists but cannot be trusted. */
export class PreviousReleaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PreviousReleaseError';
    this.code = code;
  }
}

/** A hash-verified previous release, plus the entries it carries. */
export type PreviousRelease = {
  releaseId: string;
  rootKey: string;
  /** Every catalog entry the verified release carries. */
  entries: CatalogAssetEntry[];
  /**
   * Verified dependency objects, keyed by catalog key — e.g.
   * `seed/lpc_credits.json`. Used to carry forward a required release
   * dependency whose source file is absent from a de-bundled checkout.
   */
  dependencies: Map<string, Uint8Array>;
  /** Keys this release pinned, in pointer order (root, shards, dependencies). */
  pinnedKeys: string[];
};

/** A `ReleaseDocumentReader` over the public origin. */
export const httpReleaseReader = (options: {
  originUrl: string;
  timeoutMs?: number;
}): ReleaseDocumentReader => {
  const base = options.originUrl.replace(/\/+$/, '');
  return async (key: string): Promise<Uint8Array | undefined> => {
    const response = await fetch(`${base}/${key}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${key}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
};

type ShardDocument = { entries?: CatalogAssetEntry[] };

/**
 * Resolves and hash-verifies the release currently published at an origin.
 *
 * @returns The verified release, or `undefined` when the origin publishes no
 *   release pointer (a first publish).
 * @throws {PreviousReleaseError} When a pointer exists but is corrupt, or any
 *   pinned object fails its integrity check. The caller must abort.
 */
export const resolvePreviousRelease = async (options: {
  originUrl: string;
  reader?: ReleaseDocumentReader;
}): Promise<PreviousRelease | undefined> => {
  const reader = options.reader ?? httpReleaseReader({ originUrl: options.originUrl });

  let graph: Awaited<ReturnType<typeof resolveReleaseGraph>>;
  try {
    graph = await resolveReleaseGraph({ reader });
  } catch (error) {
    throw new PreviousReleaseError(
      'previous-release-untrusted',
      `The published release at ${options.originUrl} could not be verified: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        'Refusing to publish — carrying forward from an unverified release could ' +
        'truncate the catalog, and treating it as absent would too.',
    );
  }

  if (!graph) {
    return undefined;
  }

  const entries: CatalogAssetEntry[] = [];
  const seenShardKeys = new Set<string>();

  for (const shard of graph.pointer.shards) {
    // The pointer names the shard; the graph holds its VERIFIED bytes. Reading
    // by key from `documents` (not re-fetching) is what makes the entries
    // provably the ones the hash covered.
    const bytes = graph.documents.get(shard.key);
    if (!bytes) {
      throw new PreviousReleaseError(
        'previous-release-incomplete',
        `Verified release ${graph.releaseId} pins shard ${shard.key} but the resolver did not ` +
          'retain it. Refusing to publish with a partial view of the previous catalog.',
      );
    }
    seenShardKeys.add(shard.key);
    let parsed: ShardDocument;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as ShardDocument;
    } catch (error) {
      throw new PreviousReleaseError(
        'previous-release-corrupt-shard',
        `Shard ${shard.key} of verified release ${graph.releaseId} is not valid JSON: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const entry of parsed.entries ?? []) {
      entries.push(entry);
    }
  }

  const dependencies = new Map<string, Uint8Array>();
  for (const dependency of graph.pointer.dependencies) {
    const bytes = graph.documents.get(dependency.key);
    if (bytes) {
      dependencies.set(dependency.key, bytes);
    }
  }

  return {
    releaseId: graph.releaseId,
    rootKey: graph.pointer.rootKey,
    entries,
    dependencies,
    pinnedKeys: [
      graph.pointer.rootKey,
      ...graph.pointer.shards.map((shard) => shard.key),
      ...graph.pointer.dependencies.map((dependency) => dependency.key),
    ],
  };
};

/** How a candidate's entries related to the carried set. */
export type MergeReport = {
  /** Entries taken from the verified previous release, unchanged. */
  carried: number;
  /** Carried tags this candidate replaced with its own bytes. */
  replaced: number;
  /** Tags this candidate introduces. */
  added: number;
  /** Carried tags dropped by an explicit retirement declaration. */
  retired: number;
  /** Total entries in the merged result. */
  total: number;
};

/**
 * Unions a candidate's entries over the carried set.
 *
 * A LOCAL entry always wins for its own tag: replacing the pack's artifacts is
 * the point of the publish, and a stale carried copy must never shadow the
 * bytes being published.
 *
 * Absence is NOT deletion. A tag missing from the local scan is carried
 * forward, because a de-bundled checkout is not evidence that anyone intended
 * to remove it. Deleting a tag requires an explicit `retire` declaration, so
 * removal is always a decision someone made rather than a side effect of a
 * file not being present.
 */
export const mergeCatalogEntries = (options: {
  /**
   * This candidate's entries. Accepts either side of the scan→index boundary
   * (`CatalogEntry` from a scan root, or an already-projected
   * `CatalogAssetEntry`), so callers do not have to convert just to merge.
   */
  local: readonly (CatalogEntry | CatalogAssetEntry)[];
  carried: readonly CatalogAssetEntry[];
  /** Tags explicitly declared retired. Anything else is preserved. */
  retire?: readonly string[];
}): { entries: CatalogAssetEntry[]; report: MergeReport } => {
  const retire = new Set(options.retire ?? []);
  const byTag = new Map<string, CatalogAssetEntry>();
  const carriedTags = new Set<string>();

  for (const entry of options.carried) {
    carriedTags.add(entry.tag);
    byTag.set(entry.tag, entry);
  }

  let replaced = 0;
  let added = 0;
  for (const raw of options.local) {
    const entry: CatalogAssetEntry = 'rootDir' in raw ? entryToShardEntry(raw) : raw;
    if (carriedTags.has(entry.tag)) {
      replaced += 1;
    } else {
      added += 1;
    }
    byTag.set(entry.tag, entry);
  }

  let retired = 0;
  for (const tag of retire) {
    if (byTag.delete(tag)) {
      retired += 1;
    }
  }

  const entries = [...byTag.values()];
  return {
    entries,
    report: {
      carried: carriedTags.size - replaced,
      replaced,
      added,
      retired,
      total: entries.length,
    },
  };
};
