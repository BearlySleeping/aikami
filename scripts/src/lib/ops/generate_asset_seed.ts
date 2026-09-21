// scripts/src/lib/ops/generate_asset_seed.ts
//
// Generates and validates the compact boot seed the client ships (C-435):
//
//   static/game-data/asset_seed.json    every catalog asset — tag, hash, size,
//                                       category, ext (short keys, ~1.8 MB)
//   static/game-data/offline_core.json  the tag set the client prefetches and
//                                       pins on first run (C-448)
//
// The seed replaced manifest.json + asset_hashes.json on the boot path, but
// landed as a hand-written artifact with no way to reproduce or verify it.
// This is that way.
//
// Usage:
//   bun run scripts/src/lib/ops/generate_asset_seed.ts            # validate
//   bun run scripts/src/lib/ops/generate_asset_seed.ts --write    # regenerate
//   bun run scripts/src/lib/ops/generate_asset_seed.ts --write \
//     --manifest <path> --hashes <path> --out <path>
//
// Regeneration reads the manifest + hash sidecar that `scan_assets.ts` emits.
// Those are produced wherever the raw assets live — after de-bundling that is
// no longer this repo, so the paths are arguments rather than assumptions.
//
// ── Determinism, and why `o` is no longer read from the environment ────────
//
// A candidate is sealed ONCE and promoted unchanged, so every byte it contains
// must be reproducible from the source tree alone. The seed's `o` field used to
// be `process.env.PUBLIC_ASSETS_BASE_URL`, which made the same source produce
// different seed bytes under `--mode staging` and `--mode production` — so the
// "same" candidate could not be promoted, and two runs of the same build could
// disagree. It is now an explicit `--origin` argument that defaults to empty;
// the authoritative per-release origin lives in the release pointer and the
// index root, which ARE environment-scoped.
//
// Contract: C-243, C-435

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { tagToAssetPath } from '@aikami/constants';
import type {
  AssetHashesFile,
  AssetManifest,
  CompactSeedRow,
  OfflineCoreDeclaration,
} from '@aikami/types';
import type { CompactSeedDocument } from '../catalog/compact_seed.ts';

/** Plain console output, matching the other ops scripts in this directory. */
const log = console;

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const GAME_DATA_DIR = join(REPO_ROOT, 'apps/frontend/client/static/game-data');
const SEED_PATH = join(GAME_DATA_DIR, 'asset_seed.json');
const OFFLINE_CORE_PATH = join(GAME_DATA_DIR, 'offline_core.json');
const CONTENT_PACKS_DIR = join(REPO_ROOT, 'content/packs');

type AssetCreditsFile = {
  credits: Record<string, { licenses?: readonly string[] }>;
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Builds the compact seed rows from a manifest + its hash sidecar. */
export const buildRows = (options: {
  manifest: AssetManifest;
  hashes: AssetHashesFile;
  credits: AssetCreditsFile;
}): { rows: CompactSeedRow[]; skipped: string[] } => {
  const rows: CompactSeedRow[] = [];
  const skipped: string[] = [];

  for (const [tag, entry] of Object.entries(options.manifest.assets)) {
    const hashEntry = options.hashes.hashes[tag];
    if (!hashEntry) {
      // No hash means no R2 key and no integrity check — never seed it.
      skipped.push(tag);
      continue;
    }
    rows.push({
      t: tag,
      h: hashEntry.hash,
      s: hashEntry.sizeBytes,
      c: entry.category,
      e: entry.ext,
      l: [...(options.credits.credits[tag]?.licenses ?? [])],
    });
  }

  rows.sort((a, b) => a.t.localeCompare(b.t));
  return { rows, skipped };
};

/**
 * Assembles the seed document.
 *
 * Pure, and the only place the document's shape is decided — so "the same rows
 * produce the same bytes" is a property of one function rather than of the
 * script's control flow.
 */
export const buildSeedDocument = (options: {
  rows: readonly CompactSeedRow[];
  /** Scan timestamp, preserved from the committed sidecar. Metadata only. */
  scannedAt: string;
  /** Origin stamp. Empty for a promotable candidate — see the module header. */
  origin: string;
}): CompactSeedDocument => ({
  sv: 1,
  g: options.scannedAt,
  o: options.origin,
  r: [...options.rows].sort((a, b) => a.t.localeCompare(b.t)),
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Checks the invariant the whole de-bundled boot path rests on: a seed row
 * carries only a tag and an extension, so `tagToAssetPath` must reproduce the
 * asset's real relative path exactly. If it cannot, bundled URLs are wrong and
 * the offline core silently 404s.
 */
export const validatePathDerivation = (options: {
  rows: readonly CompactSeedRow[];
  manifest?: AssetManifest;
}): string[] => {
  const problems: string[] = [];

  for (const row of options.rows) {
    const derived = tagToAssetPath({ tag: row.t, ext: row.e });
    const actual = options.manifest?.assets[row.t]?.path;
    if (actual !== undefined && derived !== actual) {
      problems.push(`${row.t}: derives "${derived}" but the manifest says "${actual}"`);
    }
  }

  return problems;
};

/** Checks that every offline-core tag exists in the seed and ships on disk. */
const validateOfflineCore = async (options: {
  rows: readonly CompactSeedRow[];
  core: OfflineCoreDeclaration;
}): Promise<string[]> => {
  const problems: string[] = [];
  const byTag = new Map(options.rows.map((row) => [row.t, row]));

  for (const tag of options.core.tags) {
    const row = byTag.get(tag);
    if (!row) {
      problems.push(`${tag}: declared offline-core but absent from the seed`);
      continue;
    }
    // Check both game-data and content-packs directories
    const gameDataPath = join(GAME_DATA_DIR, tagToAssetPath({ tag, ext: row.e }));
    const contentPacksPath = join(CONTENT_PACKS_DIR, tagToAssetPath({ tag, ext: row.e }));
    try {
      await readFile(gameDataPath);
    } catch {
      try {
        await readFile(contentPacksPath);
      } catch {
        problems.push(
          `${tag}: declared offline-core but not bundled at ${gameDataPath} or ${contentPacksPath}`,
        );
      }
    }
  }

  return problems;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

/** Every row this checkout can produce, from both scan roots. */
const buildLocalRows = async (options: {
  manifestPath: string;
  hashesPath: string;
}): Promise<{ rows: CompactSeedRow[]; manifest: AssetManifest }> => {
  const manifest = await readJson<AssetManifest>(options.manifestPath);
  const hashes = await readJson<AssetHashesFile>(options.hashesPath);
  const credits = await readJson<AssetCreditsFile>(
    join(resolve(options.manifestPath, '..'), 'asset_credits.json'),
  );

  const { rows, skipped } = buildRows({ manifest, hashes, credits });
  if (skipped.length > 0) {
    log.warn(
      `⚠ Skipped ${skipped.length} tag(s) with no hash entry, e.g. ${skipped.slice(0, 3).join(', ')}`,
    );
  }

  // Content-pack tags, so offline-core tags (emberwatch:*) resolve.
  const contentPackManifestPath = join(CONTENT_PACKS_DIR, 'manifest.json');
  let cpManifest: AssetManifest;
  try {
    cpManifest = await readJson<AssetManifest>(contentPackManifestPath);
  } catch (error) {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
    log.warn('⚠ Content-packs manifest not found — skipping content-pack tags in seed');
    return { rows, manifest };
  }

  const cpHashes = await readJson<AssetHashesFile>(join(CONTENT_PACKS_DIR, 'asset_hashes.json'));
  const cpCredits = await readJson<AssetCreditsFile>(join(CONTENT_PACKS_DIR, 'asset_credits.json'));
  const { rows: cpRows, skipped: cpSkipped } = buildRows({
    manifest: cpManifest,
    hashes: cpHashes,
    credits: cpCredits,
  });
  rows.push(...cpRows);
  if (cpSkipped.length > 0) {
    log.warn(
      `⚠ Content-packs skipped ${cpSkipped.length} tag(s) with no hash entry, e.g. ${cpSkipped.slice(0, 3).join(', ')}`,
    );
  }

  return { rows, manifest };
};

/**
 * Unions the entries already published at `originUrl` into the local rows.
 *
 * C-435: this checkout no longer holds the complete asset library, so the
 * locally-built rows alone are a FRACTION of the catalog. Writing that as the
 * boot seed would ship a client that cannot resolve every LPC sheet, legacy
 * portrait and audio bed it previously could. A local row always wins for its
 * tag.
 */
const mergePublishedRows = async (options: {
  rows: CompactSeedRow[];
  originUrl: string;
}): Promise<void> => {
  const { resolvePreviousRelease } = await import('../catalog/published_catalog.ts');
  const previous = await resolvePreviousRelease({ originUrl: options.originUrl });
  if (!previous) {
    throw new Error(
      `--merge-origin ${options.originUrl} publishes no release pointer, so there is ` +
        'nothing to carry and this checkout cannot produce a complete seed. Refusing to ' +
        'write a seed that would drop every asset this checkout does not carry.',
    );
  }
  const localTags = new Set(options.rows.map((row) => row.t));
  let carried = 0;
  for (const entry of previous.entries) {
    if (localTags.has(entry.tag)) {
      continue;
    }
    options.rows.push({
      t: entry.tag,
      h: entry.hash,
      s: entry.sizeBytes,
      c: entry.category,
      e: entry.ext,
      l: [...entry.licenses],
    });
    carried += 1;
  }
  if (carried > 0) {
    log.info(`🔗 carried ${carried} already-published seed row(s) from ${options.originUrl}`);
  }
};

/** Builds the seed document for `--write`, plus the manifest it came from. */
const buildSeedForWrite = async (values: {
  manifest?: string | undefined;
  hashes?: string | undefined;
  'merge-origin'?: string | undefined;
  origin?: string | undefined;
}): Promise<{ seed: CompactSeedDocument; manifest: AssetManifest }> => {
  const { rows, manifest } = await buildLocalRows({
    manifestPath: resolve(values.manifest ?? join(GAME_DATA_DIR, 'manifest.json')),
    hashesPath: resolve(values.hashes ?? join(GAME_DATA_DIR, 'asset_hashes.json')),
  });
  if (values['merge-origin']) {
    await mergePublishedRows({ rows, originUrl: String(values['merge-origin']) });
  }
  return {
    seed: buildSeedDocument({ rows, scannedAt: manifest.scannedAt, origin: values.origin ?? '' }),
    manifest,
  };
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'merge-origin': {
        type: 'string',
        description:
          'Union the entries already published at this catalog origin into the seed. Required when this checkout does not hold the complete asset library (C-435), or the seed would carry only the local scan subset.',
      },
      write: { type: 'boolean', default: false },
      manifest: { type: 'string' },
      hashes: { type: 'string' },
      out: {
        type: 'string',
        description: `Where to write the seed. Defaults to ${SEED_PATH}.`,
      },
      origin: {
        type: 'string',
        description:
          "Value for the seed's `o` field. Defaults to empty: a promotable candidate must not embed a mode-specific origin.",
      },
    },
    strict: true,
  });

  const built = values.write
    ? await buildSeedForWrite(values)
    : { seed: await readJson<CompactSeedDocument>(SEED_PATH), manifest: undefined };
  const { seed, manifest } = built;

  const core = await readJson<OfflineCoreDeclaration>(OFFLINE_CORE_PATH);

  const problems = [
    ...validatePathDerivation({ rows: seed.r, manifest }),
    ...(await validateOfflineCore({ rows: seed.r, core })),
  ];

  if (problems.length > 0) {
    log.error(`asset seed validation failed — ${problems.length} problem(s):`);
    for (const problem of problems.slice(0, 25)) {
      log.error(`  ${problem}`);
    }
    if (problems.length > 25) {
      log.error(`  …and ${problems.length - 25} more`);
    }
    process.exit(1);
  }

  if (values.write) {
    // Compact form, no pretty-printing — this ships to every client.
    const outPath = resolve(values.out ?? SEED_PATH);
    await writeFile(outPath, JSON.stringify(seed));
    log.info(`Wrote ${outPath} — ${seed.r.length} rows`);
  }

  log.info(
    `✓ asset seed OK — ${seed.r.length} rows, ${core.tags.length} offline-core tags bundled`,
  );
};

if (import.meta.main) {
  await main();
}
