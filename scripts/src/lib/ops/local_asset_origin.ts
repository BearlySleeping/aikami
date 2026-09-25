// scripts/src/lib/ops/local_asset_origin.ts
//
// Local asset origin for in-game verification (dev-only).
//
// Why this exists: the client is fully de-bundled. It resolves every asset
// through `PUBLIC_ASSETS_BASE_URL` (the published CDN origin) — `static/
// game-data/maps` and `static/game-data/contentPacks` are empty, and
// `AssetStore._originUrl` returns null without an origin, so there is no
// bundled fallback. A local art/map/manifest change is therefore invisible
// in-game until it is published.
//
// This tool gives a real in-game test WITHOUT any remote write:
//   - it serves a locally-built asset origin on localhost;
//   - artifacts you have changed (a repacked prop atlas, a rebuilt map, the
//     pack manifest) are served from local files, content-addressed exactly
//     like the publish pipeline;
//   - everything else is proxied read-only to the published origin, so the
//     rest of the game still loads;
//   - the seed is rewritten so the new artifacts resolve, and the origin URL
//     in the seed is rewritten to point at localhost.
//
// Point the client at it with `PUBLIC_ASSETS_BASE_URL=http://localhost:<port>`
// (apps/frontend/client/.env.local).
//
// Usage:
//   bun scripts/src/lib/ops/local_asset_origin.ts [--port 8788] [--no-serve]
//   bun scripts/src/lib/ops/local_asset_origin.ts --published-only --port 8788
//
// The default mode overlays the local candidate plane on a read-only published
// seed. `--published-only` fetches and pins the public seed locally but applies
// zero candidate overrides, giving before/after evidence a truthful baseline.
// Neither mode ever sends a write request to the published origin.
//
// The override set is deliberately small and explicit — a file only differs
// from the published CDN when it is listed here.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ContentPackManifest, ContentPackManifestSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import type { CatalogEntry } from '../catalog/catalog_entries.ts';
import { generateCatalogIndex } from '../catalog/index_generation.ts';
import { buildPackLock, PACK_LOCK_KEY } from '../catalog/pack_lock.ts';
import {
  type CandidateOverride,
  collectEmberwatchCandidateOverrides,
  findPublishedSeedPath,
  missingCandidateOverrides,
  readPublishedSeedHashes,
} from './emberwatch_candidate_plane.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

/** Default listen port; `--port` overrides it. */
const DEFAULT_PORT = 8788;

/**
 * The Emberwatch artifacts this session serves from the worktree instead of
 * the published origin — the COMPLETE candidate plane (C-529). Derived from
 * `emberwatch_candidate_plane.ts` so portraits, enemy visuals, maps, audio and
 * the prop atlas cannot silently diverge from what the candidate declares.
 *
 * The terrain atlas is included only when its local bytes differ from the
 * published ones (C-548): an unchanged atlas stays proxied, so a local-origin
 * run does not silently swap accepted art, but a candidate whose maps depend on
 * the regenerated atlas (C-546's bridge frames) serves its own build.
 *
 * `publishedHashes` comes from the snapshot seed, so it is resolved per run.
 */
const emberwatchOverrides = (publishedHashes: ReadonlyMap<string, string>): CandidateOverride[] =>
  collectEmberwatchCandidateOverrides(repository, publishedHashes);

type SeedRow = {
  t: string;
  h: string;
  s: number;
  c: string;
  e: string;
  /** Verbatim license records (optional, mirrors CompactSeedRow). */
  l?: readonly string[];
};
type Seed = { sv: number; g: string; o: string; r: SeedRow[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Converts seed rows into catalog entries for local index generation.
 *
 * The seed does not carry attribution (authors/sourceUrls) or the scan
 * subcategory, so those are defaulted — a local dev origin is served without
 * the publish pipeline's attribution preflight. The LPC slot (second tag
 * segment) is used as the subcategory so `generateCatalogIndex` splits the
 * ~12,700-entry LPC shard into per-slot shards that stay under the 1 MB
 * budget instead of throwing.
 */
const seedRowsToCatalogEntries = (seed: Seed): CatalogEntry[] =>
  seed.r.map((row) => {
    const parts = row.t.split(':');
    const subcategory = row.c === 'lpc' && parts.length > 1 ? parts[1] : undefined;
    return {
      tag: row.t,
      hash: row.h,
      sizeBytes: row.s,
      category: row.c,
      ...(subcategory ? { subcategory } : {}),
      ext: row.e,
      path: '',
      rootDir: '',
      licenses: row.l ?? [],
      authors: [],
      sourceUrls: [],
    };
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Content-addressed object key, matching the publish pipeline. */
const objectKey = (hash: string, ext: string): string => `assets/${hash.slice(0, 2)}/${hash}${ext}`;

/**
 * Builds the local origin directory: content-addressed override objects plus
 * a seed whose rows point at them and whose origin is localhost.
 */
const buildOrigin = (options: {
  seedPath: string;
  outDir: string;
  originUrl: string;
  manifestPath: string;
  overrides: readonly CandidateOverride[];
}): {
  overrides: { tag: string; hash: string; bytes: number }[];
  seed: Seed;
  indexShards: number;
} => {
  const seed = JSON.parse(readFileSync(options.seedPath, 'utf8')) as Seed;
  seed.o = options.originUrl;

  const overrides = [...options.overrides];

  // The registry is (re)seeded only when the seed's fingerprint changes. That
  // fingerprint is now content-derived (`generatedAt` + derivation revision +
  // a digest of every tag→hash pair), so changed rows alone would be enough.
  // Stamping a fresh generation anyway keeps the override visible in logs and
  // independent of the storage package's internals.
  seed.g = new Date().toISOString();

  const applied: { tag: string; hash: string; bytes: number }[] = [];

  for (const override of overrides) {
    if (!existsSync(override.file)) {
      throw new Error(`Override file missing: ${override.file}`);
    }
    const bytes = readFileSync(override.file);
    const hash = sha256(bytes);
    const key = objectKey(hash, override.ext);
    const target = join(options.outDir, key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);

    const row: SeedRow = {
      t: override.tag,
      h: hash,
      s: bytes.length,
      c: override.category,
      e: override.ext,
    };
    const existing = seed.r.findIndex((candidate) => candidate.t === override.tag);
    if (existing >= 0) {
      seed.r[existing] = row;
    } else {
      seed.r.push(row);
    }
    applied.push({ tag: override.tag, hash, bytes: bytes.length });
  }

  // The client resolves the release graph first. Write the legacy aliases for
  // back-compat AND a content-addressed release graph, so a local run exercises
  // the same `resolveReleaseGraph` path production uses instead of silently
  // taking the legacy fallback.
  mkdirSync(join(options.outDir, 'seed'), { recursive: true });
  const seedJson = JSON.stringify(seed);
  writeFileSync(join(options.outDir, 'seed/asset_seed.json'), seedJson);

  const corePath = join(dirname(options.seedPath), 'offline_core.json');
  const coreBytes = existsSync(corePath) ? readFileSync(corePath) : undefined;
  if (coreBytes) {
    writeFileSync(join(options.outDir, 'seed/offline_core.json'), coreBytes);
  }

  // Content-addressed seed/core under `seed/<sha>/<name>` — the immutable keys
  // the release pointer pins.
  const seedBytes = Buffer.from(seedJson, 'utf8');
  const seedHash = sha256(seedBytes);
  const seedKey = `seed/${seedHash}/asset_seed.json`;
  writeObject(options.outDir, seedKey, seedBytes);
  const coreKey = coreBytes ? `seed/${sha256(coreBytes)}/offline_core.json` : undefined;
  if (coreBytes && coreKey) {
    writeObject(options.outDir, coreKey, coreBytes);
  }

  // The hub's SSR catalog browse/preview fetches `${origin}/index/v1/...`
  // and builds its slot catalog from the LPC shard. The published production
  // index is stale (6 LPC assets) while the seed is complete, so generate a
  // full index locally from the (override-applied) seed. `originUrl` is set
  // to the local origin so the client resolves every asset back through it.
  const { root, shards } = generateCatalogIndex({
    entries: seedRowsToCatalogEntries(seed),
    originUrl: options.originUrl,
  });
  const indexPath = join(options.outDir, 'index/v1');
  mkdirSync(indexPath, { recursive: true });
  const rootJson = JSON.stringify(root, null, 2);
  const rootHash = sha256(Buffer.from(rootJson, 'utf8'));
  const rootKey = `index/v1/revisions/${rootHash}/catalog.json`;
  writeObject(options.outDir, rootKey, Buffer.from(rootJson, 'utf8'));
  const shardRefs = shards.map((shard) => {
    const hash = sha256(Buffer.from(shard.json, 'utf8'));
    const key = `index/v1/revisions/${hash}/${shard.id}.json`;
    writeObject(options.outDir, key, Buffer.from(shard.json, 'utf8'));
    return { category: shard.category, key, hash };
  });

  // C-523 AC-5: the installed pack lock. Its `audioAssets` pins are what the
  // client hash-verifies an authored cue against before it plays, so the local
  // origin has to publish it or that verification never runs.
  const lock = writePackLock({
    seed,
    applied,
    outDir: options.outDir,
    manifestPath: options.manifestPath,
  });
  if (!lock) {
    throw new Error('Local asset origin requires a valid Emberwatch pack lock');
  }

  // The release pointer: pins the root, every shard, the seed/core and the
  // IMMUTABLE pack-lock revision, exactly like the production publisher's
  // release graph. The mutable `index/v1/pack_lock.json` alias is written for
  // back-compat but is deliberately NOT what the pointer pins — a later write
  // to the alias must not be able to invalidate a released graph.
  const dependencies: { key: string; hash: string }[] = [{ key: seedKey, hash: seedHash }];
  if (coreBytes && coreKey) {
    dependencies.push({ key: coreKey, hash: sha256(coreBytes) });
  }
  dependencies.push({ key: lock.key, hash: lock.hash });
  const releasePointer = {
    schemaVersion: 'catalog.release.v1',
    releaseId: seed.g,
    rootKey,
    rootHash,
    shards: shardRefs,
    dependencies,
    publishedAt: seed.g,
  };
  writeFileSync(join(indexPath, 'release.json'), `${JSON.stringify(releasePointer, null, 2)}\n`);

  return { overrides: applied, seed, indexShards: shards.length };
};

/** Writes bytes to a repo-relative key under the origin directory. */
const writeObject = (outDir: string, key: string, bytes: Buffer): void => {
  const target = join(outDir, key);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};

/**
 * Writes the Emberwatch installed pack lock.
 *
 * The lock is written under its immutable content-addressed revision key AND
 * the mutable `index/v1/pack_lock.json` compatibility alias, mirroring the
 * production publisher: the release pointer pins the immutable key, so a later
 * write to the alias cannot invalidate an already-published graph.
 *
 * Pins are taken from what the *seed* carries (the override-applied rows), so
 * a locally rebuilt map or atlas is pinned at its local hash — exactly what the
 * client will have installed.
 *
 * @returns The immutable key + SHA-256 of the lock bytes, or `undefined` when
 *   no lock could be built (no manifest pin).
 */
const writePackLock = (options: {
  seed: Seed;
  applied: readonly { tag: string; hash: string }[];
  outDir: string;
  manifestPath: string;
}): { key: string; hash: string } | undefined => {
  const manifestHash =
    options.applied.find((override) => override.tag === 'emberwatch:manifest')?.hash ??
    options.seed.r.find((row) => row.t === 'emberwatch:manifest')?.h;
  if (!manifestHash) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const manifestCandidate = isRecord(parsed) ? { ...parsed } : undefined;
  // Published Emberwatch manifests predate the current onboarding action union.
  // Onboarding is irrelevant to lock pins; omit only that legacy optional
  // section so the published bytes can still be used as a truthful baseline.
  if (manifestCandidate) {
    delete manifestCandidate.onboarding;
  }
  if (!manifestCandidate || !Value.Check(ContentPackManifestSchema, manifestCandidate)) {
    logger.warn('localAssetOrigin:pack-lock-manifest-invalid', {
      manifestPath: options.manifestPath,
    });
    return undefined;
  }
  const manifest = manifestCandidate as ContentPackManifest;

  const lock = buildPackLock({
    releaseId: options.seed.g,
    manifest,
    manifestHash,
    seedRows: options.seed.r.map((row) => ({ tag: row.t, hash: row.h })),
  });
  if (!lock) {
    return;
  }

  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  const hash = sha256(lockBytes);
  const key = `index/v1/revisions/${hash}/pack_lock.json`;
  writeObject(options.outDir, key, lockBytes);
  writeObject(options.outDir, PACK_LOCK_KEY, lockBytes);
  logger.info('localAssetOrigin:pack-lock', {
    key,
    alias: PACK_LOCK_KEY,
    assets: lock.assets.length,
    audioAssets: lock.audioAssets?.length ?? 0,
  });
  return { key, hash };
};

type OriginServeOptions = {
  outDir: string;
  upstream: string;
  port: number;
  logPath?: string;
};

type LogLine = (entry: Record<string, unknown>) => void;

const localFileResponse = (options: {
  originRoot: string;
  requestPath: string;
  localPath: string;
  logLine: LogLine;
}): Response | undefined => {
  // Never serve outside the origin dir. Compare with a trailing separator so a
  // sibling like `<outDir>-secret` cannot pass a bare prefix test.
  const withinOrigin =
    options.localPath === options.originRoot ||
    options.localPath.startsWith(`${options.originRoot}${sep}`);
  if (!withinOrigin || !existsSync(options.localPath)) {
    return undefined;
  }
  const file = Bun.file(options.localPath);
  options.logLine({ kind: 'local', path: options.requestPath, bytes: file.size });
  return new Response(file, {
    headers: {
      'content-type': options.requestPath.endsWith('.json')
        ? 'application/json'
        : file.type || 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
};

const proxyResponse = async (options: {
  url: URL;
  upstream: string;
  logLine: LogLine;
}): Promise<Response> => {
  const upstreamUrl = new URL(options.url.pathname + options.url.search, options.upstream);
  try {
    const response = await fetch(upstreamUrl, { method: 'GET' });
    options.logLine({ kind: 'proxy', path: options.url.pathname, status: response.status });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    logger.warn('localAssetOrigin:proxy-failed', {
      path: options.url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response('upstream fetch failed', { status: 502 });
  }
};

const handleOriginRequest = async (
  options: OriginServeOptions,
  request: Request,
  logLine: LogLine,
): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('read-only origin', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const url = new URL(request.url);
  const localPath = join(options.outDir, decodeURIComponent(url.pathname));
  const local = localFileResponse({
    originRoot: options.outDir,
    requestPath: url.pathname,
    localPath,
    logLine,
  });
  if (local) {
    return local;
  }
  return proxyResponse({ url, upstream: options.upstream, logLine });
};

/** Serves the local origin, proxying anything not overridden to the upstream. */
const serve = (options: OriginServeOptions): void => {
  const logLine: LogLine = (entry) => {
    if (!options.logPath) {
      return;
    }
    try {
      appendFileSync(options.logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
    } catch {
      // Logging must never break asset serving.
    }
  };

  const server = Bun.serve({
    // Loopback only: this server hands out local build artifacts and proxies
    // with no auth, so it must never be reachable from the network.
    hostname: '127.0.0.1',
    port: options.port,
    fetch: (request) => handleOriginRequest(options, request, logLine),
  });
  logger.info('localAssetOrigin:serving', {
    url: `http://localhost:${server.port}`,
    upstream: options.upstream,
    hint: 'Set PUBLIC_ASSETS_BASE_URL to this URL in apps/frontend/client/.env.local',
  });
};

const argValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

/** Download the public mutable seed and its exact Emberwatch manifest once. */
const downloadPublishedSeed = async (options: {
  upstream: string;
  outDir: string;
}): Promise<{ seedPath: string; manifestPath: string }> => {
  const seedUrl = new URL('seed/asset_seed.json', `${options.upstream}/`);
  const seedResponse = await fetch(seedUrl, { method: 'GET' });
  if (!seedResponse.ok) {
    throw new Error(`Could not read published seed ${seedUrl}: HTTP ${seedResponse.status}`);
  }
  const seedBytes = Buffer.from(await seedResponse.arrayBuffer());
  const seedDir = join(options.outDir, 'published-seed');
  const seedPath = join(seedDir, 'asset_seed.json');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(seedPath, seedBytes);

  const seed = JSON.parse(seedBytes.toString('utf8')) as Seed;
  const manifestRow = seed.r.find((row) => row.t === 'emberwatch:manifest');
  if (!manifestRow) {
    throw new Error(
      'Published seed has no emberwatch:manifest row; cannot build a truthful before lane.',
    );
  }
  const manifestKey = objectKey(manifestRow.h, '.json');
  const manifestUrl = new URL(manifestKey, `${options.upstream}/`);
  const manifestResponse = await fetch(manifestUrl, { method: 'GET' });
  if (!manifestResponse.ok) {
    throw new Error(
      `Could not read published Emberwatch manifest: HTTP ${manifestResponse.status}`,
    );
  }
  const manifestPath = join(options.outDir, manifestKey);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, Buffer.from(await manifestResponse.arrayBuffer()));

  // Optional, but when published the client should receive the same offline-core
  // declaration from the local origin rather than reaching around it.
  const coreUrl = new URL('seed/offline_core.json', `${options.upstream}/`);
  const coreResponse = await fetch(coreUrl, { method: 'GET' });
  if (coreResponse.ok) {
    writeFileSync(
      join(seedDir, 'offline_core.json'),
      Buffer.from(await coreResponse.arrayBuffer()),
    );
  }
  return { seedPath, manifestPath };
};

type OriginOptions = {
  port: number;
  shouldServe: boolean;
  publishedOnly: boolean;
  checkPlane: boolean;
  upstream: string;
  outDir: string;
};

const parseOriginOptions = (args: string[]): OriginOptions => {
  const rawPort = argValue(args, '--port');
  const port = Number(rawPort ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `local-asset-origin: --port must be an integer in 1..65535 (got ${String(rawPort)})`,
    );
  }
  const publishedOnly = args.includes('--published-only');
  return {
    port,
    shouldServe: !args.includes('--no-serve'),
    publishedOnly,
    checkPlane: args.includes('--check-plane'),
    upstream: (argValue(args, '--upstream') ?? 'https://assets.bearlysleeping.com').replace(
      /\/$/,
      '',
    ),
    outDir: resolve(
      argValue(args, '--out-dir') ??
        join(repository, '.local/catalog', publishedOnly ? 'published-origin' : 'local-origin'),
    ),
  };
};

const prepareOutputDirectory = (options: OriginOptions): void => {
  if (options.publishedOnly) {
    // Never let a previous candidate run leak into the published baseline.
    rmSync(options.outDir, { recursive: true, force: true });
  }
  mkdirSync(options.outDir, { recursive: true });
};

const checkCandidatePlane = (
  options: OriginOptions,
  publishedHashes: ReadonlyMap<string, string>,
): boolean => {
  if (!options.checkPlane) {
    return false;
  }
  const missing = missingCandidateOverrides(repository, publishedHashes);
  if (missing.length > 0) {
    console.error(
      `local-asset-origin: candidate plane is INCOMPLETE — the human gate would render stale published rows for:\n  ${missing.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `local-asset-origin: candidate plane complete (${emberwatchOverrides(publishedHashes).length} overrides serve every required Emberwatch tag)`,
  );
  return true;
};

const resolvePublishedInputs = async (
  options: OriginOptions,
  snapshotSeedPath: string | undefined,
): Promise<{ seedPath: string; manifestPath: string }> => {
  const downloaded =
    options.publishedOnly || snapshotSeedPath === undefined
      ? await downloadPublishedSeed({ upstream: options.upstream, outDir: options.outDir })
      : undefined;
  const seedPath = options.publishedOnly
    ? downloaded?.seedPath
    : (snapshotSeedPath ?? downloaded?.seedPath);
  if (!seedPath) {
    throw new Error('Could not resolve a published catalog seed.');
  }
  return {
    seedPath,
    manifestPath: options.publishedOnly
      ? (downloaded?.manifestPath ?? join(repository, 'content/packs/emberwatch/manifest.json'))
      : join(repository, 'content/packs/emberwatch/manifest.json'),
  };
};

const buildAndServe = (options: {
  origin: OriginOptions;
  seedPath: string;
  manifestPath: string;
  publishedHashes: ReadonlyMap<string, string>;
}): void => {
  const overrides = options.origin.publishedOnly
    ? []
    : emberwatchOverrides(options.publishedHashes);
  const built = buildOrigin({
    seedPath: options.seedPath,
    outDir: options.origin.outDir,
    originUrl: `http://localhost:${options.origin.port}`,
    manifestPath: options.manifestPath,
    overrides,
  });

  logger.info('localAssetOrigin:built', {
    seedPath: options.seedPath,
    outDir: options.origin.outDir,
    publishedOnly: options.origin.publishedOnly,
    overrides: built.overrides.length,
    totalRows: built.seed.r.length,
    indexShards: built.indexShards,
  });
  for (const override of built.overrides) {
    logger.info('localAssetOrigin:override', {
      tag: override.tag,
      hash: override.hash.slice(0, 12),
      bytes: override.bytes,
    });
  }
  if (!options.origin.shouldServe) {
    return;
  }
  serve({
    outDir: options.origin.outDir,
    upstream: options.origin.upstream,
    port: options.origin.port,
    logPath: join(options.origin.outDir, 'requests.log'),
  });
};

const main = async (): Promise<void> => {
  const origin = parseOriginOptions(process.argv.slice(2));
  prepareOutputDirectory(origin);
  // The published rows drive the terrain-atlas rule (C-548). A missing
  // snapshot is handled by the downloaded public seed below.
  const snapshotSeedPath = findPublishedSeedPath(repository);
  const publishedHashes = readPublishedSeedHashes(snapshotSeedPath ?? '');
  if (checkCandidatePlane(origin, publishedHashes)) {
    return;
  }
  const inputs = await resolvePublishedInputs(origin, snapshotSeedPath);
  buildAndServe({ origin, ...inputs, publishedHashes });
};

await main();
