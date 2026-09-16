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
// Contract: C-496, C-523

import {
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
import { logger } from '$logger';

/**
 * Legacy mutable catalog aliases, retained only for the compatibility path.
 * The release pointer key itself is owned by `@aikami/schemas`'s
 * `resolveReleaseGraph`, which is the single reader of the release graph.
 */
const LEGACY_SEED_KEY = 'seed/asset_seed.json';
const LEGACY_OFFLINE_CORE_KEY = 'seed/offline_core.json';

/** Timeout for each catalog fetch — a stalled origin must not hang boot. */
const RELEASE_FETCH_TIMEOUT_MS = 15_000;

/** Which surface the catalog was read from. */
type ReleaseResolutionSource = 'release' | 'legacy-compat';

/** The outcome of resolving the catalog from the origin. */
export type ResolvedCatalog = {
  seed: AssetSeedDocument;
  /** Offline-core tags, or an empty list when the declaration is unavailable. */
  coreTags: readonly string[];
  /** Immutable release id, or `legacy` when no release pointer exists. */
  releaseId: string;
  /** Which surface the catalog was read from. */
  source: ReleaseResolutionSource;
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

  logger.debug('releaseResolver:resolved', {
    releaseId: graph.releaseId,
    rows: seed.rows.length,
    coreTags: coreTags.length,
    shards: graph.pointer.shards.length,
  });

  return { seed, coreTags, releaseId: graph.releaseId, source: 'release' };
};

/**
 * The explicit legacy compatibility path.
 *
 * Reads the mutable aliases the publisher used to write. Retained only so a
 * client can boot against an origin that predates the release pointer; the
 * caller logs the downgrade and this path is retired once staging and
 * production both publish releases.
 */
const resolveLegacyCatalog = async (options: { originUrl: string }): Promise<ResolvedCatalog> => {
  const { originUrl } = options;
  const reader = fetchDocumentReader(originUrl);

  let seedBytes: Uint8Array | undefined;
  let coreBytes: Uint8Array | undefined;
  try {
    [seedBytes, coreBytes] = await Promise.all([
      reader(LEGACY_SEED_KEY),
      reader(LEGACY_OFFLINE_CORE_KEY),
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
  logger.warn('releaseResolver:legacy-compat', {
    originUrl,
    rows: seed.rows.length,
    note: 'No release pointer; served the mutable legacy seed alias.',
  });

  return {
    seed,
    coreTags: parseOfflineCore(coreBytes),
    releaseId: 'legacy',
    source: 'legacy-compat',
  };
};
