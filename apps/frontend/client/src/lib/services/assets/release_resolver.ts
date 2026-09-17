// apps/frontend/client/src/lib/services/assets/release_resolver.ts
//
// C-496 / C-523 — the production client's release-resolution path.
//
// Before this module the boot path read the *mutable legacy aliases*
// `seed/asset_seed.json` and `seed/offline_core.json` directly, while the
// publisher wrote immutable `seed/<sha256>/<filename>` objects and advanced
// `index/v1/release.json`. A successful content-addressed publication therefore
// did not have to update what the game actually read — a producer/consumer
// disagreement that no cache invalidation could fix.
//
// The graph verification itself lives in `@aikami/schemas`'s
// `resolveReleaseGraph`, shared with the release tooling, so producer and
// consumer validate the same pointer with the same code. This module is the
// client's thin adapter: it supplies a fetch-backed reader, parses the compact
// seed, and takes the explicit legacy compatibility path ONLY when no release
// pointer exists at all. Corrupt release metadata fails closed.
//
// C-523 AC-5: the installed pack lock is resolved from the SAME graph. The
// release pins its lock as a hash-verified dependency, so the lock a consumer
// verifies audio against always belongs to the selected release. Reading the
// mutable `index/v1/pack_lock.json` alias instead could pair release N+1's
// catalog with release N's lock, or observe the window in which the pointer has
// advanced but the alias has not. The alias is read only on the genuinely
// legacy path (no pointer at all), and that provenance is reported explicitly.
//
// Contract: C-496, C-523

import {
  type InstalledPackLock,
  InstalledPackLockSchema,
  ReleaseGraphError,
  type ReleaseGraphFailureCode,
  ReleaseReadError,
  resolveReleaseGraph,
} from '@aikami/schemas';
import {
  type AssetSeedDocument,
  type CompactSeedDocument,
  type OfflineCoreDeclaration,
  parseAssetSeed,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { logger } from '$logger';

/**
 * Legacy mutable catalog aliases, retained only for the compatibility path.
 * The release pointer key itself is owned by `@aikami/schemas`'s
 * `resolveReleaseGraph`, which is the single reader of the release graph.
 */
const LEGACY_SEED_KEY = 'seed/asset_seed.json';
const LEGACY_OFFLINE_CORE_KEY = 'seed/offline_core.json';
const LEGACY_PACK_LOCK_KEY = 'index/v1/pack_lock.json';

/**
 * Suffix identifying the release's pinned installed pack lock among the
 * pointer's dependencies. The publisher writes it under a content-addressed
 * `index/v1/revisions/<sha256>/pack_lock.json` key, exactly as it does for the
 * seed (`…/asset_seed.json`) and the offline core (`…/offline_core.json`).
 */
const PACK_LOCK_KEY_SUFFIX = '/pack_lock.json';

/** Timeout for each catalog fetch — a stalled origin must not hang boot. */
const RELEASE_FETCH_TIMEOUT_MS = 15_000;

/** Which surface the catalog was read from. */
type ReleaseResolutionSource = 'release' | 'legacy-compat';

/** Where the resolved installed pack lock came from. */
type PackLockSource = 'release' | 'legacy-alias' | 'absent';

/** The outcome of resolving the catalog from the origin. */
export type ResolvedCatalog = {
  seed: AssetSeedDocument;
  /** Offline-core tags, or an empty list when the declaration is unavailable. */
  coreTags: readonly string[];
  /** Immutable release id, or `legacy` when no release pointer exists. */
  releaseId: string;
  /** Which surface the catalog was read from. */
  source: ReleaseResolutionSource;
  /**
   * The installed pack lock belonging to THIS catalog's release, already
   * hash-verified by `resolveReleaseGraph` (or read from the explicit legacy
   * alias when no release pointer exists at all). `undefined` when nothing
   * pinned a lock — an absent pin is genuinely nothing to verify, and is never
   * silently replaced by a separately fetched mutable alias.
   */
  packLock: InstalledPackLock | undefined;
  /** Where `packLock` came from, so a caller can report the provenance. */
  packLockSource: PackLockSource;
};

/** A typed resolution failure so the caller can report the exact reason. */
export class ReleaseResolutionError extends Error {
  readonly code: 'corrupt-release' | 'missing-dependency' | 'integrity-failure' | 'missing-seed';

  constructor(code: ReleaseResolutionError['code'], message: string) {
    super(message);
    this.name = 'ReleaseResolutionError';
    this.code = code;
  }
}

/**
 * Fetch-backed document reader.
 *
 * @returns Raw bytes, or `undefined` for a genuine 404 (absent object) so an
 *   absent pointer can be told apart from a transport failure.
 * @throws {ReleaseReadError} On a non-404 HTTP error — never masked as absent.
 */
const fetchDocumentReader =
  (originUrl: string) =>
  async (key: string): Promise<Uint8Array | undefined> => {
    const base = originUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/${key}`, {
      signal: AbortSignal.timeout(RELEASE_FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new ReleaseReadError(key, new Error(`HTTP ${response.status}`));
    }
    return new Uint8Array(await response.arrayBuffer());
  };

/** Parses a compact seed body into the typed document, or throws. */
const parseCompactSeedBody = (options: { bytes: Uint8Array; key: string }): AssetSeedDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(options.bytes));
  } catch (error) {
    throw new ReleaseResolutionError(
      'integrity-failure',
      `Seed document ${options.key} is not valid JSON: ${String(error)}`,
    );
  }
  const candidate = parsed as CompactSeedDocument;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    candidate.sv !== 1 ||
    !Array.isArray(candidate.r)
  ) {
    throw new ReleaseResolutionError(
      'integrity-failure',
      `Seed document ${options.key} failed its compact-seed shape check.`,
    );
  }
  return parseAssetSeed(candidate);
};

/** Parses the offline-core declaration, treating any problem as an empty core. */
const parseOfflineCore = (bytes: Uint8Array | undefined): readonly string[] => {
  if (!bytes) {
    return [];
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as OfflineCoreDeclaration;
    return Array.isArray(parsed.tags) ? parsed.tags : [];
  } catch (error) {
    logger.warn('releaseResolver:offline-core-unparseable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Maps a release-graph failure onto the resolver's public error code, so the
 * caller can tell a missing object from an integrity failure without parsing
 * a message.
 */
const releaseResolutionCode = (code: ReleaseGraphFailureCode): ReleaseResolutionError['code'] => {
  switch (code) {
    case 'missing-object':
      return 'missing-dependency';
    case 'missing-seed':
      return 'missing-seed';
    case 'integrity-failure':
      return 'integrity-failure';
    default:
      return 'corrupt-release';
  }
};

/**
 * Parses the release's pinned installed pack lock.
 *
 * The bytes are already hash-verified against the pointer, so a body that does
 * not satisfy `InstalledPackLockSchema` is a producer defect: it fails closed
 * rather than degrading to "no lock" (which would silently stop verifying a
 * release that explicitly pins one).
 */
const parseInstalledPackLock = (options: { bytes: Uint8Array; key: string }): InstalledPackLock => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(options.bytes));
  } catch (error) {
    throw new ReleaseResolutionError(
      'corrupt-release',
      `Pack lock document ${options.key} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Value.Check(InstalledPackLockSchema, parsed)) {
    throw new ReleaseResolutionError(
      'corrupt-release',
      `Pack lock document ${options.key} failed InstalledPackLockSchema.`,
    );
  }
  return parsed as InstalledPackLock;
};

/**
 * Resolves the installed pack lock pinned by the selected release graph.
 *
 * @param graph - The verified graph. Its `documents` map already holds every
 *   hash-verified dependency, so no extra network lookup is performed.
 * @returns The parsed lock plus its provenance; `absent` when the release pins
 *   none (a genuinely pre-C-523 release, not a legacy *install*).
 */
const resolveReleasePackLock = (graph: {
  pointer: { dependencies: readonly { key: string }[] };
  documents: Map<string, Uint8Array>;
}): { packLock: InstalledPackLock | undefined; packLockSource: PackLockSource } => {
  const dependency = graph.pointer.dependencies.find((candidate) =>
    candidate.key.endsWith(PACK_LOCK_KEY_SUFFIX),
  );
  if (!dependency) {
    return { packLock: undefined, packLockSource: 'absent' };
  }
  const bytes = graph.documents.get(dependency.key);
  if (!bytes) {
    // `resolveReleaseGraph` verified every dependency, so this is unreachable —
    // treat it as a failure rather than as "no lock".
    throw new ReleaseResolutionError(
      'missing-dependency',
      `Release pins ${dependency.key} but its verified bytes are unavailable.`,
    );
  }
  return {
    packLock: parseInstalledPackLock({ bytes, key: dependency.key }),
    packLockSource: 'release',
  };
};

/**
 * Resolves the catalog through the published release graph, or the explicit
 * legacy compatibility path when no release pointer exists.
 *
 * @param options.originUrl - `PUBLIC_ASSETS_BASE_URL`.
 * @returns A release-consistent boot seed plus its provenance.
 * @throws {ReleaseResolutionError} When the release metadata is present but
 *   malformed, references a missing object, or fails hash verification. A
 *   caller must NOT fall back to legacy metadata in these cases.
 */
export const resolveCatalogRelease = async (options: {
  originUrl: string;
}): Promise<ResolvedCatalog> => {
  const { originUrl } = options;

  let graph: Awaited<ReturnType<typeof resolveReleaseGraph>>;
  try {
    graph = await resolveReleaseGraph({ reader: fetchDocumentReader(originUrl) });
  } catch (error) {
    if (error instanceof ReleaseReadError) {
      throw new ReleaseResolutionError('corrupt-release', error.message);
    }
    if (error instanceof ReleaseGraphError) {
      throw new ReleaseResolutionError(releaseResolutionCode(error.code), error.message);
    }
    throw new ReleaseResolutionError(
      'corrupt-release',
      error instanceof Error ? error.message : String(error),
    );
  }

  // A genuinely absent pointer is the only case that takes the legacy path.
  if (!graph) {
    logger.warn('releaseResolver:no-release-pointer', { originUrl });
    return resolveLegacyCatalog({ originUrl });
  }

  const seed = parseCompactSeedBody({
    bytes: graph.seedBytes,
    key: `seed/${graph.releaseId}/asset_seed.json`,
  });
  const coreTags = parseOfflineCore(graph.offlineCoreBytes);
  const { packLock, packLockSource } = resolveReleasePackLock(graph);

  logger.debug('releaseResolver:resolved', {
    releaseId: graph.releaseId,
    rows: seed.rows.length,
    coreTags: coreTags.length,
    shards: graph.pointer.shards.length,
    packLockSource,
  });

  return {
    seed,
    coreTags,
    releaseId: graph.releaseId,
    source: 'release',
    packLock,
    packLockSource,
  };
};

/**
 * The explicit legacy compatibility path.
 *
 * Reads the mutable aliases the publisher used to write. Retained only so a
 * client can boot against an origin that predates the release pointer; the
 * caller logs the downgrade and this path is retired once staging and
 * production both publish releases. This is the only place the mutable
 * `index/v1/pack_lock.json` alias is read.
 */
const resolveLegacyCatalog = async (options: { originUrl: string }): Promise<ResolvedCatalog> => {
  const { originUrl } = options;
  const reader = fetchDocumentReader(originUrl);

  let seedBytes: Uint8Array | undefined;
  let coreBytes: Uint8Array | undefined;
  let lockBytes: Uint8Array | undefined;
  try {
    [seedBytes, coreBytes, lockBytes] = await Promise.all([
      reader(LEGACY_SEED_KEY),
      reader(LEGACY_OFFLINE_CORE_KEY),
      reader(LEGACY_PACK_LOCK_KEY),
    ]);
  } catch (error) {
    throw new ReleaseResolutionError(
      'corrupt-release',
      `Legacy catalog read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!seedBytes) {
    throw new ReleaseResolutionError(
      'missing-seed',
      `Legacy seed ${LEGACY_SEED_KEY} unavailable and no release pointer exists.`,
    );
  }

  const seed = parseCompactSeedBody({ bytes: seedBytes, key: LEGACY_SEED_KEY });

  // The mutable alias is the ONLY lock surface a pre-release origin has. It is
  // read here — explicitly, on the path that has already established that no
  // release pointer exists — never as a fallback for a release that pins one.
  let packLock: InstalledPackLock | undefined;
  if (lockBytes) {
    try {
      packLock = parseInstalledPackLock({ bytes: lockBytes, key: LEGACY_PACK_LOCK_KEY });
    } catch (error) {
      logger.warn('releaseResolver:legacy-pack-lock-unusable', {
        originUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn('releaseResolver:legacy-compat', {
    originUrl,
    rows: seed.rows.length,
    packLockSource: packLock ? 'legacy-alias' : 'absent',
    note: 'No release pointer; served the mutable legacy seed alias.',
  });

  return {
    seed,
    coreTags: parseOfflineCore(coreBytes),
    releaseId: 'legacy',
    source: 'legacy-compat',
    packLock,
    packLockSource: packLock ? 'legacy-alias' : 'absent',
  };
};
