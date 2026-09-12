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
//
// The override set is deliberately small and explicit — a file only differs
// from the published CDN when it is listed here.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '$logger';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

/** One artifact served locally instead of from the published origin. */
type Override = {
  /** Published registry tag the client resolves (e.g. `sprites:tilesets:props.webp`). */
  tag: string;
  /** Absolute path to the local file that should win. */
  file: string;
  /** Category recorded in the seed row. */
  category: string;
  /** File extension including the dot. */
  ext: string;
};

/** Default listen port; `--port` overrides it. */
const DEFAULT_PORT = 8788;

/** The Emberwatch artifacts this session changes. */
const EMBERWATCH_OVERRIDES: Override[] = [
  {
    tag: 'sprites:tilesets:props.webp',
    file: join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets/props.webp'),
    category: 'tilesets',
    ext: '.webp',
  },
  {
    tag: 'sprites:tilesets:props.json',
    file: join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets/props.json'),
    category: 'tilesets',
    ext: '.json',
  },
  {
    tag: 'emberwatch:maps:village',
    file: join(repository, 'content/packs/emberwatch/maps/village.json'),
    category: 'contentPacks',
    ext: '.json',
  },
  {
    tag: 'emberwatch:manifest',
    file: join(repository, 'content/packs/emberwatch/manifest.json'),
    category: 'contentPacks',
    ext: '.json',
  },
];

type SeedRow = { t: string; h: string; s: number; c: string; e: string };
type Seed = { sv: number; g: string; o: string; r: SeedRow[] };

/** Newest catalog snapshot under `.local/catalog/<mode>/snapshots`. */
const findSnapshotSeed = (): string => {
  const base = join(repository, '.local/catalog/production/snapshots');
  if (!existsSync(base)) {
    throw new Error(`No catalog snapshot found at ${base} — run a catalog snapshot first.`);
  }
  // Snapshot directories are named by content digest, so lexicographic order
  // says nothing about recency — pick by modification time.
  const newest = readdirSync(base)
    .map((name) => {
      try {
        return { name, mtimeMs: statSync(join(base, name)).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { name: string; mtimeMs: number } => entry !== undefined)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!newest) {
    throw new Error(`No catalog snapshots under ${base}`);
  }
  return join(base, newest.name, 'remote/seed/asset_seed.json');
};

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
}): {
  overrides: { tag: string; hash: string; bytes: number }[];
  seed: Seed;
} => {
  const seed = JSON.parse(readFileSync(options.seedPath, 'utf8')) as Seed;
  seed.o = options.originUrl;

  // The registry is (re)seeded only when the seed's fingerprint changes. That
  // fingerprint is now content-derived (`generatedAt` + derivation revision +
  // a digest of every tag→hash pair), so changed rows alone would be enough.
  // Stamping a fresh generation anyway keeps the override visible in logs and
  // independent of the storage package's internals.
  seed.g = new Date().toISOString();

  const applied: { tag: string; hash: string; bytes: number }[] = [];

  for (const override of EMBERWATCH_OVERRIDES) {
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

  // The client fetches the seed from `${origin}/seed/asset_seed.json`.
  mkdirSync(join(options.outDir, 'seed'), { recursive: true });
  writeFileSync(join(options.outDir, 'seed/asset_seed.json'), JSON.stringify(seed));
  // Offline core is optional for the client; copy it through when present so
  // the origin behaves like the real one.
  const corePath = join(dirname(options.seedPath), 'offline_core.json');
  if (existsSync(corePath)) {
    writeFileSync(join(options.outDir, 'seed/offline_core.json'), readFileSync(corePath));
  }

  return { overrides: applied, seed };
};

/** Serves the local origin, proxying anything not overridden to the upstream. */
const serve = (options: {
  outDir: string;
  upstream: string;
  port: number;
  logPath?: string;
}): void => {
  const logLine = (entry: Record<string, unknown>): void => {
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
    async fetch(request) {
      const url = new URL(request.url);
      const localPath = join(options.outDir, decodeURIComponent(url.pathname));
      // Never serve outside the origin dir. Compare with a trailing separator
      // so a sibling like `<outDir>-secret` cannot pass a bare prefix test.
      const withinOrigin =
        localPath === options.outDir || localPath.startsWith(`${options.outDir}${sep}`);
      if (withinOrigin && existsSync(localPath)) {
        const file = Bun.file(localPath);
        logLine({ kind: 'local', path: url.pathname, bytes: file.size });
        return new Response(file, {
          headers: {
            'content-type': url.pathname.endsWith('.json')
              ? 'application/json'
              : file.type || 'application/octet-stream',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
          },
        });
      }
      // Not overridden — proxy read-only to the published origin.
      const upstream = new URL(url.pathname + url.search, options.upstream);
      try {
        const response = await fetch(upstream, { method: 'GET' });
        logLine({ kind: 'proxy', path: url.pathname, status: response.status });
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
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response('upstream fetch failed', { status: 502 });
      }
    },
  });
  logger.info('localAssetOrigin:serving', {
    url: `http://localhost:${server.port}`,
    upstream: options.upstream,
    hint: 'Set PUBLIC_ASSETS_BASE_URL to this URL in apps/frontend/client/.env.local',
  });
};

const main = (): void => {
  const args = process.argv.slice(2);
  const portFlag = args.indexOf('--port');
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `local-asset-origin: --port must be an integer in 1..65535 (got ${String(args[portFlag + 1])})`,
    );
  }
  const shouldServe = !args.includes('--no-serve');

  const seedPath = findSnapshotSeed();
  const outDir = join(repository, '.local/catalog/local-origin');
  mkdirSync(outDir, { recursive: true });

  const built = buildOrigin({ seedPath, outDir, originUrl: `http://localhost:${port}` });

  logger.info('localAssetOrigin:built', {
    seedPath,
    outDir,
    overrides: built.overrides.length,
    totalRows: built.seed.r.length,
  });
  for (const override of built.overrides) {
    logger.info('localAssetOrigin:override', {
      tag: override.tag,
      hash: override.hash.slice(0, 12),
      bytes: override.bytes,
    });
  }

  if (shouldServe) {
    serve({
      outDir,
      upstream: 'https://assets.bearlysleeping.com',
      port,
      logPath: join(outDir, 'requests.log'),
    });
  }
};

main();
