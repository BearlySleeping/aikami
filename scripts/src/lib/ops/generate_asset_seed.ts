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
//     --manifest <path> --hashes <path>
//
// Regeneration reads the manifest + hash sidecar that `scan_assets.ts` emits.
// Those are produced wherever the raw assets live — after de-bundling that is
// no longer this repo, so the paths are arguments rather than assumptions.
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
  CompactSeedDocument,
  CompactSeedRow,
  OfflineCoreDeclaration,
} from '@aikami/types';

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
const buildRows = (options: {
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
      l: options.credits.credits[tag]?.licenses ?? [],
    });
  }

  rows.sort((a, b) => a.t.localeCompare(b.t));
  return { rows, skipped };
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Checks the invariant the whole de-bundled boot path rests on: a seed row
 * carries only a tag and an extension, so `tagToAssetPath` must reproduce the
 * asset's real relative path exactly. If it cannot, bundled URLs are wrong and
 * the offline core silently 404s.
 */
const validatePathDerivation = (options: {
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
  },
  strict: true,
});

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

let seed: CompactSeedDocument;
let manifest: AssetManifest | undefined;

if (values.write) {
  const manifestPath = resolve(values.manifest ?? join(GAME_DATA_DIR, 'manifest.json'));
  const hashesPath = resolve(values.hashes ?? join(GAME_DATA_DIR, 'asset_hashes.json'));

  manifest = await readJson<AssetManifest>(manifestPath);
  const hashes = await readJson<AssetHashesFile>(hashesPath);
  const credits = await readJson<AssetCreditsFile>(
    join(resolve(manifestPath, '..'), 'asset_credits.json'),
  );

  const { rows, skipped } = buildRows({ manifest, hashes, credits });
  if (skipped.length > 0) {
    log.warn(
      `⚠ Skipped ${skipped.length} tag(s) with no hash entry, e.g. ${skipped.slice(0, 3).join(', ')}`,
    );
  }

  // Also load content-pack tags so offline-core tags (emberwatch:*) resolve
  const contentPacksManifestPath = join(CONTENT_PACKS_DIR, 'manifest.json');
  const contentPacksHashesPath = join(CONTENT_PACKS_DIR, 'asset_hashes.json');
  try {
    const cpManifest = await readJson<AssetManifest>(contentPacksManifestPath);
    const cpHashes = await readJson<AssetHashesFile>(contentPacksHashesPath);
    const cpCredits = await readJson<AssetCreditsFile>(
      join(CONTENT_PACKS_DIR, 'asset_credits.json'),
    );
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
  } catch {
    log.warn('⚠ Content-packs manifest not found — skipping content-pack tags in seed');
  }

  // C-435: this checkout no longer holds the complete asset library, so the
  // locally-built rows alone are a FRACTION of the catalog. Writing that as the
  // boot seed would ship a client that cannot resolve every LPC sheet, legacy
  // portrait and audio bed it previously could. `--merge-origin` unions the
  // already-published entries back in; a local row always wins for its tag.
  if (values['merge-origin']) {
    const { resolvePreviousRelease } = await import('../catalog/published_catalog.ts');
    const previous = await resolvePreviousRelease({
      originUrl: String(values['merge-origin']),
    });
    if (!previous) {
      throw new Error(
        `--merge-origin ${values['merge-origin']} publishes no release pointer, so there is ` +
          'nothing to carry and this checkout cannot produce a complete seed. Refusing to ' +
          'write a seed that would drop every asset this checkout does not carry.',
      );
    }
    const published = previous.entries;
    const localTags = new Set(rows.map((row) => row.t));
    let carried = 0;
    for (const entry of published) {
      if (localTags.has(entry.tag)) {
        continue;
      }
      rows.push({
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
      log.info(
        `🔗 carried ${carried} already-published seed row(s) from ${values['merge-origin']}`,
      );
    }
  }

  rows.sort((a, b) => a.t.localeCompare(b.t));

  seed = {
    sv: 1,
    g: manifest.scannedAt,
    o: process.env.PUBLIC_ASSETS_BASE_URL ?? '',
    r: rows,
  };
} else {
  seed = await readJson<CompactSeedDocument>(SEED_PATH);
}

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
  await writeFile(SEED_PATH, JSON.stringify(seed));
  log.info(`Wrote ${SEED_PATH} — ${seed.r.length} rows`);
}

log.info(`✓ asset seed OK — ${seed.r.length} rows, ${core.tags.length} offline-core tags bundled`);
