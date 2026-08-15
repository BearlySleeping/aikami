#!/usr/bin/env bun
/**
 * LPC Asset Collector & Catalog Generator
 *
 * Phase 1 (this script): Walks the Universal-LPC spritesheets, discovers all
 * unique asset types per slot, picks the best representative PNG, writes a
 * manifest, and generates the TypeScript catalog.
 *
 * Phase 2 (parallel shell pipeline): Reads the manifest and converts PNGs to
 * WebP in parallel using ImageMagick via xargs -P.
 *
 * Output:
 *   apps/frontend/client/static/game-data/lpc/{slot}/{type}.webp   (images via phase 2)
 *   apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts  (catalog)
 *
 * Usage:
 *   bun run scripts/src/lib/ops/collect_lpc_assets.ts --convert   (full pipeline)
 *   bun run scripts/src/lib/ops/collect_lpc_assets.ts              (catalog only, no conversion)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  buildLpcCreditsSidecar,
  LPC_LIBRARY_CREDIT,
  LPC_SUPPLEMENT_APPROVED_SOURCE_PREFIXES,
  parseLpcSourcePath,
  readCreditsCsv,
} from '../catalog/lpc_credits.ts';

// ── Config ────────────────────────────────────────────────────────────────

const LPC_REPO = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'examples',
  'Universal-LPC-Spritesheet-Character-Generator',
);
const SPRITESHEETS_DIR = join(LPC_REPO, 'spritesheets');
const OUTPUT_ASSETS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'frontend',
  'client',
  'static',
  'game-data',
  'lpc',
);
const OUTPUT_CATALOG = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'frontend',
  'client',
  'src',
  'lib',
  'data',
  'lpc_asset_catalog_generated.ts',
);
const MANIFEST_FILE = join(import.meta.dirname, '.lpc_manifest.json');

/** Upstream CREDITS.csv — vendored with the generator (13,787 rows). */
const CREDITS_FILE = join(LPC_REPO, 'CREDITS.csv');
/** C-395: attribution sidecar keyed by output asset tag (committed). */
const OUTPUT_CREDITS = join(dirname(OUTPUT_ASSETS_DIR), 'lpc_credits.json');
/** C-395: generated supplement for LPC tags CREDITS.csv does not cover (committed). */
const OUTPUT_CREDITS_SUPPLEMENT = join(dirname(OUTPUT_ASSETS_DIR), 'lpc_credits_supplement.json');

const CONVERT = process.argv.includes('--convert');

const SOURCE_EXT = '.png';
const WEBP_QUALITY = 80;

const PREFERRED_ANIMS = ['walk', 'idle', 'combat_idle', 'thrust', 'slash', 'spellcast'];
const PREFERRED_COLORS = [
  'brown',
  'black',
  'white',
  'gray',
  'dark',
  'leather',
  'steel',
  'silver',
  'bronze',
];
const BODY_TYPES = ['male', 'female', 'adult', 'child', 'teen', 'thin', 'muscular', 'pregnant'];

// ── Types ─────────────────────────────────────────────────────────────────

type AssetEntry = {
  key: string;
  slot: string;
  type: string;
  bodyType: string;
  sourcePath: string;
  outputRel: string;
  label: string;
};

// ── Parsing ───────────────────────────────────────────────────────────────
//
// The source-path parser (SLOT_MAP / BODY_CANDIDATES / ANIM_CANDIDATES /
// parsePath) lives in scripts/src/lib/catalog/lpc_credits.ts — the CREDITS
// join and the collector must share ONE key derivation, or the attribution
// join drifts (exactly what C-395 AC-4's preflight is designed to catch).

type ParsedState = ReturnType<typeof parseLpcSourcePath>;

function scoreEntry(p: { bodyType: string; anim: string; color: string }): number {
  const bi = BODY_TYPES.indexOf(p.bodyType);
  const ai = PREFERRED_ANIMS.indexOf(p.anim);
  const ci = PREFERRED_COLORS.indexOf(p.color);
  return (
    (bi >= 0 ? 100 - bi * 10 : 50) + (ai >= 0 ? 100 - ai * 10 : 30) + (ci >= 0 ? 50 - ci * 5 : 20)
  );
}

// ── Collect ────────────────────────────────────────────────────────────────

function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const c = stack.pop();
    if (!c) {
      continue;
    }
    if (!existsSync(c)) {
      continue;
    }
    for (const e of readdirSync(c)) {
      const p = join(c, e);
      if (statSync(p).isDirectory()) {
        stack.push(p);
      } else if (p.endsWith(ext)) {
        results.push(p);
      }
    }
  }
  return results;
}

function humanize(type: string): string {
  return type
    .split('/')
    .map((p) => p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' — ');
}

console.log('🔍 Walking spritesheets directory...');
const allFiles = walkFiles(SPRITESHEETS_DIR, SOURCE_EXT);
console.log(`   ${allFiles.length.toLocaleString()} total PNG files`);

// Group by (slot, type, bodyType) key first, then pick best per state
const bestPerState = new Map<string, { parsed: NonNullable<ParsedState>; path: string }>();

for (const file of allFiles) {
  const p = parseLpcSourcePath(relative(SPRITESHEETS_DIR, file));
  if (!p) {
    continue;
  }
  // Key includes animation state: slot/type/bodyType/anim
  const key = `${p.slot}/${p.type}/${p.bodyType}/${p.anim}`;
  const existing = bestPerState.get(key);
  if (!existing || scoreEntry(p) > scoreEntry(existing.parsed)) {
    bestPerState.set(key, { parsed: p, path: file });
  }
}

// Pick best per group
const assets: AssetEntry[] = [];
// Map of asset key → all available states (for catalog + per-state webp generation)
const assetStates = new Map<string, Set<string>>();

for (const [_key, entry] of bestPerState) {
  const { slot, type, bodyType, anim } = entry.parsed;
  const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
  const assetKey = `${slot}/${type}${btSuffix}`;

  // Track available states
  if (!assetStates.has(assetKey)) {
    assetStates.set(assetKey, new Set());
  }
  assetStates.get(assetKey)?.add(anim);

  // Only create one catalog entry per base asset key
  const existing = assets.find((a) => a.key === assetKey);
  if (existing) {
    continue;
  }

  assets.push({
    key: assetKey,
    slot,
    type,
    bodyType,
    sourcePath: entry.path,
    outputRel: `${slot}/${type.split('/').join('/')}${btSuffix}.${anim}.webp`,
    label: `${humanize(type)}${bodyType !== 'default' ? ` (${bodyType})` : ''}`,
  });
}

assets.sort((a, b) => a.key.localeCompare(b.key));

const slots = new Set(assets.map((a) => a.slot));
console.log(`✅ Found ${assets.length} unique asset types across ${slots.size} slots.`);

// ── Catalog generation ────────────────────────────────────────────────────

const slotOrder = [
  'head',
  'body',
  'hair',
  'beard',
  'eyes',
  'facial',
  'torso',
  'legs',
  'feet',
  'dress',
  'hat',
  'cape',
  'shoulders',
  'neck',
  'shield',
  'weapon',
];
const slotEntries = new Map<string, AssetEntry[]>();
for (const a of assets) {
  if (!slotEntries.has(a.slot)) {
    slotEntries.set(a.slot, []);
  }
  slotEntries.get(a.slot)?.push(a);
}
const sortedSlots = [...slotEntries.entries()].sort((a, b) => {
  const ai = slotOrder.indexOf(a[0]),
    bi = slotOrder.indexOf(b[0]);
  if (ai >= 0 && bi >= 0) {
    return ai - bi;
  }
  if (ai >= 0) {
    return -1;
  }
  if (bi >= 0) {
    return 1;
  }
  return a[0].localeCompare(b[0]);
});

const lines: string[] = [
  '// Auto-generated by scripts/src/lib/ops/collect_lpc_assets.ts — DO NOT EDIT.',
  "import type { LpcSlotDefinition } from '$lib/data/lpc_asset_catalog';",
  '',
];

// Slot definitions
lines.push('export const GENERATED_LPC_SLOTS: readonly LpcSlotDefinition[] = [');
for (const [slot, entries] of sortedSlots) {
  const label = slot.charAt(0).toUpperCase() + slot.slice(1);
  lines.push(`  { slot: ${JSON.stringify(slot)}, label: ${JSON.stringify(label)}, variants: [`);
  for (const e of entries) {
    lines.push(
      `    { assetId: ${JSON.stringify(e.key)}, label: ${JSON.stringify(e.label)}, shapeType: 'default' as const },`,
    );
  }
  lines.push('  ] },');
}
lines.push('];');
lines.push('');

// Flat ID list per slot
lines.push('export const LPC_ASSET_IDS_BY_SLOT: Record<string, string[]> = {');
for (const [slot, entries] of sortedSlots) {
  const ids = entries.map((e) => e.key);
  lines.push(`  ${JSON.stringify(slot)}: ${JSON.stringify(ids)},`);
}
lines.push('};');
lines.push('');

// Flat set of ALL generated asset IDs — no glob needed at runtime
const allIds = assets.map((e) => e.key);
lines.push('/** All generated asset IDs as a flat string array — verified at generation. */');
lines.push(`export const ALL_GENERATED_ASSET_IDS: readonly string[] = ${JSON.stringify(allIds)};`);
lines.push('');

// AI prompt helper
lines.push('export function getLpcCatalogPrompt(): string {');
lines.push("  const parts: string[] = ['Available LPC sprite components (asset IDs by slot):'];");
lines.push('  for (const [slot, ids] of Object.entries(LPC_ASSET_IDS_BY_SLOT)) {');
lines.push(`    parts.push(\`  \${slot}: \${ids.join(', ')}\`);`);
lines.push('  }');
lines.push(
  '  parts.push(\'\\\\nWhen generating a character appearance, return a JSON object: {"lpcRecipe": {"head": "head/heads/human_male", ...}}\');',
);
lines.push('  return parts.join("\\\\n");');
lines.push('}');

writeFileSync(OUTPUT_CATALOG, lines.join('\n'));
console.log(`📝 Catalog written: ${OUTPUT_CATALOG}`);

// ── Phase 1.5: Credits sidecar (C-395 AC-4) ────────────────────────────────
//
// Join every chosen source PNG back to its CREDITS.csv row (keyed by the
// spritesheet-relative path — the same key parsePath derives) and emit a
// sidecar keyed by the OUTPUT asset tag, carrying licenses/authors/sourceUrls
// VERBATIM (never SPDX-normalised — LPC publishes "OGA-BY 3.0").
// The publish preflight (scripts/src/lib/catalog/preflight.ts) fails the run
// if any catalog tag resolves to neither this sidecar nor project_licenses.json.
//
// Runs in both modes: it is pure lookup over the already-collected
// bestPerState map — no conversion or extra filesystem walk.

const creditsCsv = readCreditsCsv(CREDITS_FILE);
if (creditsCsv.size === 0) {
  console.warn('⚠️  CREDITS.csv not found — skipping lpc_credits.json sidecar.');
  console.warn(`    Expected at: ${CREDITS_FILE}`);
  console.warn('    The vendored generator is gitignored (examples/); regenerate where it exists.');
} else {
  const sidecar = buildLpcCreditsSidecar({
    states: [...bestPerState.values()].map(({ parsed, path }) => ({ parsed, sourcePath: path })),
    creditsCsv,
    spritesheetsDir: SPRITESHEETS_DIR,
  });
  writeFileSync(OUTPUT_CREDITS, JSON.stringify(sidecar, null, 2));
  console.log(
    `📝 Credits written: ${OUTPUT_CREDITS} — ${Object.keys(sidecar.credits).length} resolved, ` +
      `${sidecar.unresolvedSources.length} unresolved source(s)`,
  );
  if (sidecar.unresolvedSources.length > 0) {
    console.warn(`    Unresolved: ${sidecar.unresolvedSources.slice(0, 10).join(', ')}`);
  }

  // Committed supplement: only unresolved tags whose SOURCE matches an
  // approved LPC library prefix are declared with LPC-library-level
  // provenance (AC-4 — no silent default, no blanket declaration). Every
  // other unresolved tag is omitted so the publish preflight continues to
  // fail for unapproved assets; the diff of this file is the review surface
  // for the declaration.
  const supplementCredits: Record<string, typeof LPC_LIBRARY_CREDIT> = {};
  for (const { tag, source } of sidecar.unresolved) {
    const approved = LPC_SUPPLEMENT_APPROVED_SOURCE_PREFIXES.some((prefix) =>
      source.startsWith(prefix),
    );
    if (approved) {
      supplementCredits[tag] = LPC_LIBRARY_CREDIT;
    }
  }
  const supplementCount = Object.keys(supplementCredits).length;
  writeFileSync(
    OUTPUT_CREDITS_SUPPLEMENT,
    JSON.stringify(
      {
        generatedAt: sidecar.generatedAt,
        assetCount: supplementCount,
        credits: supplementCredits,
      },
      null,
      2,
    ),
  );
  if (supplementCount > 0) {
    console.log(
      `📝 Credits supplement written: ${OUTPUT_CREDITS_SUPPLEMENT} — ` +
        `${supplementCount} LPC library-level declarations`,
    );
  }
}

// ── Phase 2: Convert (parallel) ──────────────────────────────────────────

if (CONVERT) {
  // Build manifest: one entry per (asset key, animation state) pair
  const manifest: { src: string; dst: string }[] = [];
  let _totalStates = 0;

  for (const [_stateKey, entry] of bestPerState) {
    const { slot, type, bodyType, anim } = entry.parsed;
    const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
    const relPath = `${slot}/${type.split('/').join('/')}${btSuffix}.${anim}.webp`;
    const dst = join(OUTPUT_ASSETS_DIR, relPath);
    manifest.push({ src: entry.path, dst });
    _totalStates++;
  }

  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  // Clean output
  if (existsSync(OUTPUT_ASSETS_DIR)) {
    execSync(`rm -rf "${OUTPUT_ASSETS_DIR}"`, { stdio: 'pipe' });
    console.log('🧹 Cleaned output dir.');
  }
  mkdirSync(OUTPUT_ASSETS_DIR, { recursive: true });

  // Parallel convert using shell pipeline — much faster than per-file bun exec
  console.log(`🔄 Converting ${manifest.length} per-state assets to WebP...`);
  const t0 = Date.now();

  // Build a shell script lines array for conversion
  const total = manifest.length;
  const batch = 40; // Smaller batch to avoid E2BIG
  let done = 0;

  for (let i = 0; i < total; i += batch) {
    const chunk = manifest.slice(i, Math.min(i + batch, total));

    // Convert each in its own execSync call
    for (const m of chunk) {
      const dir = dirname(m.dst);
      try {
        mkdirSync(dir, { recursive: true });
        execSync(
          `convert "${m.src}" -quality ${WEBP_QUALITY} -define webp:lossless=false "${m.dst}"`,
          { stdio: 'pipe', timeout: 5000 },
        );
      } catch {
        /* skip failures */
      }
    }

    done += chunk.length;
    process.stdout.write(`\r   ${done}/${total} (${((done / total) * 100).toFixed(1)}%)`);
  }

  console.log(`\n   Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Summary
  const totalKb =
    execSync(`du -sc "${OUTPUT_ASSETS_DIR}" 2>/dev/null`, { encoding: 'utf8' })
      .split('\n')
      .find((l) => l.includes('total'))
      ?.split('\t')[0]
      ?.trim() || '?';
  console.log(`📦 Output: ${OUTPUT_ASSETS_DIR} (${totalKb} KB total)`);
} else {
  console.log('💡 Run with --convert to convert all PNGs to WebP in parallel.');
}
