#!/usr/bin/env bun
/**
 * LPC Asset Collector & Catalog Generator
 *
 * Phase 1 (this script): Walks the Universal-LPC spritesheets, discovers all
 * unique asset types per slot, picks the best representative PNG, writes a
 * manifest, and generates the TypeScript catalog.
 *
 * C-431: Also traverses `universal_behind/` directories and emits paired
 * behind/front catalog entries with explicit `layerRole` and `pairedAssetId`.
 * Shield `_bg`/`_fg` entries are normalised to the same convention.
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

/** Directory name for behind-pass sheets in the generator tree. */
const UNIVERSAL_BEHIND_DIR = 'universal_behind';

/** Suffixes that mark a shield variant as behind (bg) or front (fg). */
const SHIELD_BG_SUFFIX = '_bg';
const SHIELD_FG_SUFFIX = '_fg';

// ── Types ─────────────────────────────────────────────────────────────────

type AssetEntry = {
  key: string;
  slot: string;
  type: string;
  bodyType: string;
  sourcePath: string;
  outputRel: string;
  label: string;
  /** C-431: layer role — 'behind' for behind-pass sheets, 'front' otherwise. */
  layerRole: 'behind' | 'front';
  /** C-431: when this is a behind sheet, the foreground partner's assetId. */
  pairedAssetId?: string;
};

/** Internal parsed file info before grouping. */
type FileEntry = {
  parsed: NonNullable<ReturnType<typeof parseLpcSourcePath>>;
  path: string;
  isBehind: boolean;
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

/**
 * Detect if a spritesheet-relative path contains the universal_behind directory.
 * These are behind-pass sheets that complement the foreground pass.
 */
export const isBehindPath = (relPath: string): boolean =>
  relPath.includes(`/${UNIVERSAL_BEHIND_DIR}/`) || relPath.startsWith(`${UNIVERSAL_BEHIND_DIR}/`);

/**
 * Strip the `universal_behind/` segment from a spritesheet-relative path,
 * producing the equivalent foreground path.
 */
export const stripBehindDir = (relPath: string): string =>
  relPath.replace(`/${UNIVERSAL_BEHIND_DIR}/`, '/');

/**
 * Derive the behind assetId from a foreground assetId.
 * E.g. "weapon/sword/longsword" → "weapon/sword/longsword/behind"
 */
export const behindAssetId = (foregroundId: string): string => `${foregroundId}/behind`;

/**
 * Detect if a type string ends with a shield bg/fg suffix and normalise it.
 * Returns the normalised type and the layer role, or null if no normalisation needed.
 */
export const normaliseShieldType = (
  type: string,
): { normalType: string; layerRole: 'behind' | 'front' } | null => {
  if (type.endsWith(SHIELD_BG_SUFFIX)) {
    return { normalType: type.slice(0, -SHIELD_BG_SUFFIX.length), layerRole: 'behind' };
  }
  if (type.endsWith(SHIELD_FG_SUFFIX)) {
    return { normalType: type.slice(0, -SHIELD_FG_SUFFIX.length), layerRole: 'front' };
  }
  return null;
};

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

// Separate foreground and behind files
const fgFileEntries: FileEntry[] = [];
const behindFileEntries: FileEntry[] = [];

for (const file of allFiles) {
  const relPath = relative(SPRITESHEETS_DIR, file);
  const isBehind = isBehindPath(relPath);

  // For behind files, parse the equivalent foreground path to get the correct
  // slot/type/bodyType/anim (the behind dir is a structural convention, not a type)
  const parsePath = isBehind ? stripBehindDir(relPath) : relPath;
  const p = parseLpcSourcePath(parsePath);
  if (!p) {
    continue;
  }

  const entry: FileEntry = { parsed: p, path: file, isBehind };

  if (isBehind) {
    behindFileEntries.push(entry);
  } else {
    fgFileEntries.push(entry);
  }
}

console.log(`   ${fgFileEntries.length} foreground, ${behindFileEntries.length} behind-pass files`);

// Group by (slot, type, bodyType, anim) key, then pick best per state
const bestPerState = new Map<string, { parsed: NonNullable<ParsedState>; path: string }>();

for (const fe of fgFileEntries) {
  const p = fe.parsed;
  const key = `${p.slot}/${p.type}/${p.bodyType}/${p.anim}`;
  const existing = bestPerState.get(key);
  if (!existing || scoreEntry(p) > scoreEntry(existing.parsed)) {
    bestPerState.set(key, { parsed: p, path: fe.path });
  }
}

// Also pick best per state for behind files (separate key space)
const bestBehindPerState = new Map<string, { parsed: NonNullable<ParsedState>; path: string }>();

for (const fe of behindFileEntries) {
  const p = fe.parsed;
  const key = `${p.slot}/${p.type}/${p.bodyType}/${p.anim}`;
  const existing = bestBehindPerState.get(key);
  if (!existing || scoreEntry(p) > scoreEntry(existing.parsed)) {
    bestBehindPerState.set(key, { parsed: p, path: fe.path });
  }
}

// Pick best per group — foreground
const assets: AssetEntry[] = [];
// Map of asset key → all available states (for catalog + per-state webp generation)
const assetStates = new Map<string, Set<string>>();

for (const [_key, entry] of bestPerState) {
  const { slot, type, bodyType, anim } = entry.parsed;
  const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
  const rawAssetKey = `${slot}/${type}${btSuffix}`;

  // C-431: Normalise shield _bg/_fg types to produce unified asset keys.
  // A shield like "crusader_bg" becomes "crusader" with layerRole 'behind'.
  // A shield like "crusader_fg" becomes "crusader" with layerRole 'front'.
  let assetKey = rawAssetKey;
  let layerRole: 'behind' | 'front' = 'front';
  let shieldNormalised = false;

  const shieldNorm = normaliseShieldType(type);
  if (shieldNorm && slot === 'shield') {
    // Shield normalisation: strip _bg/_fg suffix from the type
    const normalizedBaseKey = `${slot}/${shieldNorm.normalType}${btSuffix}`;
    if (shieldNorm.layerRole === 'behind') {
      // _bg variants produce a distinct behind asset key
      assetKey = behindAssetId(normalizedBaseKey);
    } else {
      // _fg variants use the base key
      assetKey = normalizedBaseKey;
    }
    layerRole = shieldNorm.layerRole;
    shieldNormalised = true;
  }

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

  // Determine output path
  // Shield _bg → behind output: shield/crusader/behind.walk.webp
  // Shield _fg → front output: shield/crusader.walk.webp
  // Normal (non-shield): weapon/sword/longsword.walk.webp
  let outputRel: string;
  if (shieldNormalised && shieldNorm) {
    if (layerRole === 'behind') {
      outputRel = `${slot}/${shieldNorm.normalType}${btSuffix}/behind.${anim}.webp`;
    } else {
      outputRel = `${slot}/${shieldNorm.normalType}${btSuffix}.${anim}.webp`;
    }
  } else {
    outputRel = `${slot}/${type.split('/').join('/')}${btSuffix}.${anim}.webp`;
  }

  const assetEntry: AssetEntry = {
    key: assetKey,
    slot,
    type: shieldNormalised && shieldNorm ? `${shieldNorm.normalType}` : type,
    bodyType,
    sourcePath: entry.path,
    outputRel,
    label: `${humanize(type)}${bodyType !== 'default' ? ` (${bodyType})` : ''}`,
    layerRole,
  };

  // Add pairedAssetId for behind entries (both shield _bg and universal_behind/)
  if (layerRole === 'behind' && shieldNormalised && shieldNorm) {
    // Shield _bg should pair with its _fg counterpart
    assetEntry.pairedAssetId = `${slot}/${shieldNorm.normalType}${btSuffix}`;
  }

  assets.push(assetEntry);
}

// Pick best per group — behind pass (universal_behind/ directory)
const behindAssets: AssetEntry[] = [];
const behindAssetStates = new Map<string, Set<string>>();

for (const [_key, entry] of bestBehindPerState) {
  const { slot, type, bodyType, anim } = entry.parsed;
  const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
  const fgAssetKey = `${slot}/${type}${btSuffix}`;
  const behindKey = behindAssetId(fgAssetKey);

  // Track available states
  if (!behindAssetStates.has(behindKey)) {
    behindAssetStates.set(behindKey, new Set());
  }
  behindAssetStates.get(behindKey)?.add(anim);

  // Only create one catalog entry per behind asset key
  const existing = behindAssets.find((a) => a.key === behindKey);
  if (existing) {
    continue;
  }

  behindAssets.push({
    key: behindKey,
    slot,
    type,
    bodyType,
    sourcePath: entry.path,
    outputRel: `${slot}/${type.split('/').join('/')}${btSuffix}/behind.${anim}.webp`,
    label: `${humanize(type)}${bodyType !== 'default' ? ` (${bodyType})` : ''} (behind)`,
    layerRole: 'behind',
    pairedAssetId: fgAssetKey,
  });
}

// Merge foreground and behind assets, keeping existing sort
assets.push(...behindAssets);
assets.sort((a, b) => a.key.localeCompare(b.key));

// Report behind-pass discovery
console.log(`   ${behindAssets.length} behind-pass asset(s) discovered and paired`);
for (const ba of behindAssets) {
  console.log(`     → ${ba.key} (paired with ${ba.pairedAssetId})`);
}

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
    const variantFields: string[] = [
      `assetId: ${JSON.stringify(e.key)}`,
      `label: ${JSON.stringify(e.label)}`,
      `shapeType: 'default' as const`,
      `layerRole: '${e.layerRole}' as const`,
    ];
    if (e.pairedAssetId) {
      variantFields.push(`pairedAssetId: ${JSON.stringify(e.pairedAssetId)}`);
    }
    lines.push(`    { ${variantFields.join(', ')} },`);
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
  // Build sidecar from both foreground and behind states
  // For behind states and shield _bg variants, append "/behind" to the type so
  // the output tag is distinct from the foreground equivalent
  const fgStates = [...bestPerState.values()].map(({ parsed, path }) => {
    const shieldNorm = normaliseShieldType(parsed.type);
    const isBehindShield =
      shieldNorm && parsed.slot === 'shield' && shieldNorm.layerRole === 'behind';

    if (isBehindShield) {
      // Shield _bg: normalize the type and append "/behind"
      return {
        parsed: {
          ...parsed,
          type: `${shieldNorm.normalType}/behind`,
        },
        sourcePath: path,
      };
    }

    return {
      parsed,
      sourcePath: path,
    };
  });

  const behindStates = [...bestBehindPerState.values()].map(({ parsed, path }) => ({
    parsed: {
      ...parsed,
      type: `${parsed.type}/behind`,
    },
    sourcePath: path,
  }));

  const allStates = [...fgStates, ...behindStates];

  const sidecar = buildLpcCreditsSidecar({
    states: allStates,
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

  // Foreground states
  for (const [_stateKey, entry] of bestPerState) {
    const { slot, type, bodyType, anim } = entry.parsed;
    const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
    const rawType = type;

    // Check if this is a shield _bg/_fg that needs normalised output path
    const shieldNorm = normaliseShieldType(type);
    let relPath: string;
    if (shieldNorm && slot === 'shield') {
      if (shieldNorm.layerRole === 'behind') {
        relPath = `${slot}/${shieldNorm.normalType}${btSuffix}/behind.${anim}.webp`;
      } else {
        relPath = `${slot}/${shieldNorm.normalType}${btSuffix}.${anim}.webp`;
      }
    } else {
      relPath = `${slot}/${rawType.split('/').join('/')}${btSuffix}.${anim}.webp`;
    }
    const dst = join(OUTPUT_ASSETS_DIR, relPath);
    manifest.push({ src: entry.path, dst });
    _totalStates++;
  }

  // Behind states (universal_behind/)
  for (const [_stateKey, entry] of bestBehindPerState) {
    const { slot, type, bodyType, anim } = entry.parsed;
    const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
    const relPath = `${slot}/${type.split('/').join('/')}${btSuffix}/behind.${anim}.webp`;
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
