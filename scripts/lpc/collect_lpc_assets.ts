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
 *   apps/frontend/client/src/lib/assets/lpc/{slot}/{type}.webp   (images via phase 2)
 *   apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts  (catalog)
 *
 * Usage:
 *   bun run scripts/lpc/collect_lpc_assets.ts --convert   (full pipeline)
 *   bun run scripts/lpc/collect_lpc_assets.ts              (catalog only, no conversion)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────

const LPC_REPO = join(import.meta.dirname, '..', '..', 'examples', 'Universal-LPC-Spritesheet-Character-Generator');
const SPRITESHEETS_DIR = join(LPC_REPO, 'spritesheets');
const OUTPUT_ASSETS_DIR = join(import.meta.dirname, '..', '..', 'apps', 'frontend', 'client', 'src', 'lib', 'assets', 'lpc');
const OUTPUT_CATALOG = join(import.meta.dirname, '..', '..', 'apps', 'frontend', 'client', 'src', 'lib', 'data', 'lpc_asset_catalog_generated.ts');
const MANIFEST_FILE = join(import.meta.dirname, '.lpc_manifest.json');

const CONVERT = process.argv.includes('--convert');

const SLOT_MAP: Record<string, string> = {
  body: 'body', head: 'head', hair: 'hair', torso: 'torso', legs: 'legs', feet: 'feet',
  hat: 'hat', shoulders: 'shoulders', shield: 'shield', weapon: 'weapon',
  cape: 'cape', eyes: 'eyes', facial: 'facial', neck: 'neck',
  beards: 'beard', dress: 'dress',
};

const SOURCE_EXT = '.png';
const WEBP_QUALITY = 80;

const PREFERRED_ANIMS = ['walk', 'idle', 'combat_idle', 'thrust', 'slash', 'spellcast'];
const PREFERRED_COLORS = ['brown', 'black', 'white', 'gray', 'dark', 'leather', 'steel', 'silver', 'bronze'];
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

const BODY_CANDIDATES = new Set([
  'male','female','adult','child','teen','thin','muscular','pregnant',
  'bg','fg','foreground','background','universal','mask',
]);
const ANIM_CANDIDATES = new Set([
  'walk','idle','combat_idle','run','jump','sit','climb','emote',
  'thrust','slash','halfslash','backslash','shoot','hurt','spellcast','die',
]);

function parsePath(fullPath: string): {
  slot: string; type: string; bodyType: string; anim: string; color: string;
} | null {
  const rel = relative(SPRITESHEETS_DIR, fullPath);
  const parts = rel.split('/');
  if (parts.length < 2) return null;

  const slot = parts[0];
  if (!SLOT_MAP[slot]) return null;

  // Find body type boundary
  let bodyIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (BODY_CANDIDATES.has(parts[i])) { bodyIdx = i; break; }
  }

  let animIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (ANIM_CANDIDATES.has(parts[i])) { animIdx = i; break; }
  }

  const fileBase = basename(parts[parts.length - 1], SOURCE_EXT);
  const isAnimFile = ANIM_CANDIDATES.has(fileBase);

  if (isAnimFile) {
    // File IS the animation state: e.g. shield/round/thrust.png
    const typeParts = parts.slice(1, -1);
    let bodyType = 'default';
    if (bodyIdx > 0) {
      bodyType = parts[bodyIdx];
      // Remove body type from type parts (bodyIdx is index in parts, index in typeParts = bodyIdx - 1)
      typeParts.splice(bodyIdx - 1, 1);
    } else {
      const maybeBody = typeParts[typeParts.length - 1];
      if (BODY_CANDIDATES.has(maybeBody)) {
        bodyType = maybeBody;
        typeParts.pop();
      }
    }
    return { slot: SLOT_MAP[slot], type: typeParts.join('/'), bodyType, anim: fileBase, color: 'default' };
  }

  if (bodyIdx > 0) {
    const typeParts = parts.slice(1, bodyIdx);
    const bodyType = parts[bodyIdx];
    const rest = parts.slice(bodyIdx + 1);
    const anim = rest.length > 1 && ANIM_CANDIDATES.has(rest[0]) ? rest[0] : 'idle';
    const color = basename(rest[rest.length - 1], SOURCE_EXT);
    return { slot: SLOT_MAP[slot], type: typeParts.join('/'), bodyType, anim, color };
  }

  if (animIdx > 0) {
    const typeParts = parts.slice(1, animIdx);
    const anim = parts[animIdx];
    const color = basename(parts[parts.length - 1], SOURCE_EXT);
    return { slot: SLOT_MAP[slot], type: typeParts.join('/'), bodyType: 'default', anim, color };
  }

  const typeParts = parts.slice(1, -1);
  const color = fileBase;
  return { slot: SLOT_MAP[slot], type: typeParts.join('/'), bodyType: 'default', anim: 'idle', color };
}

function scoreEntry(p: { bodyType: string; anim: string; color: string }): number {
  const bi = BODY_TYPES.indexOf(p.bodyType);
  const ai = PREFERRED_ANIMS.indexOf(p.anim);
  const ci = PREFERRED_COLORS.indexOf(p.color);
  return (bi >= 0 ? 100 - bi * 10 : 50)
    + (ai >= 0 ? 100 - ai * 10 : 30)
    + (ci >= 0 ? 50 - ci * 5 : 20);
}

// ── Collect ────────────────────────────────────────────────────────────────

function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const c = stack.pop()!;
    if (!existsSync(c)) continue;
    for (const e of readdirSync(c)) {
      const p = join(c, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (p.endsWith(ext)) results.push(p);
    }
  }
  return results;
}

function humanize(type: string): string {
  return type.split('/').map(p => p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' — ');
}

console.log('🔍 Walking spritesheets directory...');
const allFiles = walkFiles(SPRITESHEETS_DIR, SOURCE_EXT);
console.log(`   ${allFiles.length.toLocaleString()} total PNG files`);

// Group by (slot, type, bodyType) key first, then pick best per state
const bestPerState = new Map<string, { parsed: ReturnType<typeof parsePath>; path: string }>();

for (const file of allFiles) {
  const p = parsePath(file);
  if (!p) continue;
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

for (const [key, entry] of bestPerState) {
  const { slot, type, bodyType, anim } = entry.parsed;
  const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
  const assetKey = `${slot}/${type}${btSuffix}`;

  // Track available states
  if (!assetStates.has(assetKey)) assetStates.set(assetKey, new Set());
  assetStates.get(assetKey)!.add(anim);

  // Only create one catalog entry per base asset key
  const existing = assets.find((a) => a.key === assetKey);
  if (existing) continue;

  assets.push({
    key: assetKey,
    slot, type, bodyType,
    sourcePath: entry.path,
    outputRel: `${slot}/${type.split('/').join('/')}${btSuffix}.${anim}.webp`,
    label: `${humanize(type)}${bodyType !== 'default' ? ` (${bodyType})` : ''}`,
  });
}

assets.sort((a, b) => a.key.localeCompare(b.key));

const slots = new Set(assets.map(a => a.slot));
console.log(`✅ Found ${assets.length} unique asset types across ${slots.size} slots.`);

// ── Catalog generation ────────────────────────────────────────────────────

const slotOrder = ['head','body','hair','beard','eyes','facial','torso','legs','feet','dress','hat','cape','shoulders','neck','shield','weapon'];
const slotEntries = new Map<string, AssetEntry[]>();
for (const a of assets) {
  if (!slotEntries.has(a.slot)) slotEntries.set(a.slot, []);
  slotEntries.get(a.slot)!.push(a);
}
const sortedSlots = [...slotEntries.entries()].sort((a, b) => {
  const ai = slotOrder.indexOf(a[0]), bi = slotOrder.indexOf(b[0]);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a[0].localeCompare(b[0]);
});

const lines: string[] = [
  '// Auto-generated by scripts/lpc/collect_lpc_assets.ts — DO NOT EDIT.',
  "import type { LpcSlotDefinition } from '$lib/data/lpc_asset_catalog';",
  '',
];

// Slot definitions
lines.push('export const GENERATED_LPC_SLOTS: readonly LpcSlotDefinition[] = [');
for (const [slot, entries] of sortedSlots) {
  const label = slot.charAt(0).toUpperCase() + slot.slice(1);
  lines.push(`  { slot: ${JSON.stringify(slot)}, label: ${JSON.stringify(label)}, variants: [`);
  for (const e of entries) {
    lines.push(`    { assetId: ${JSON.stringify(e.key)}, label: ${JSON.stringify(e.label)}, shapeType: 'default' as const },`);
  }
  lines.push('  ] },');
}
lines.push('];');
lines.push('');

// Flat ID list per slot
lines.push('export const LPC_ASSET_IDS_BY_SLOT: Record<string, string[]> = {');
for (const [slot, entries] of sortedSlots) {
  const ids = entries.map(e => e.key);
  lines.push(`  ${JSON.stringify(slot)}: ${JSON.stringify(ids)},`);
}
lines.push('};');
lines.push('');

// Flat set of ALL generated asset IDs — no glob needed at runtime
const allIds = assets.map(e => e.key);
lines.push('/** All generated asset IDs as a flat string array — verified at generation. */');
lines.push(`export const ALL_GENERATED_ASSET_IDS: readonly string[] = ${JSON.stringify(allIds)};`);
lines.push('');

// AI prompt helper
lines.push('export function getLpcCatalogPrompt(): string {');
lines.push('  const parts: string[] = [\'Available LPC sprite components (asset IDs by slot):\'];');
lines.push('  for (const [slot, ids] of Object.entries(LPC_ASSET_IDS_BY_SLOT)) {');
lines.push("    parts.push(`  ${slot}: ${ids.join(', ')}`);");
lines.push('  }');
lines.push("  parts.push('\\\\nWhen generating a character appearance, return a JSON object: {\"lpcRecipe\": {\"head\": \"head/heads/human_male\", ...}}');");
lines.push('  return parts.join(\"\\\\n\");');
lines.push('}');

writeFileSync(OUTPUT_CATALOG, lines.join('\n'));
console.log(`📝 Catalog written: ${OUTPUT_CATALOG}`);

// ── Phase 2: Convert (parallel) ──────────────────────────────────────────

if (CONVERT) {
  // Build manifest: one entry per (asset key, animation state) pair
  const manifest: { src: string; dst: string }[] = [];
  let totalStates = 0;

  for (const [stateKey, entry] of bestPerState) {
    const { slot, type, bodyType, anim } = entry.parsed;
    const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
    const relPath = `${slot}/${type.split('/').join('/')}${btSuffix}.${anim}.webp`;
    const dst = join(OUTPUT_ASSETS_DIR, relPath);
    manifest.push({ src: entry.path, dst });
    totalStates++;
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
        execSync(`convert "${m.src}" -quality ${WEBP_QUALITY} -define webp:lossless=false "${m.dst}"`, { stdio: 'pipe', timeout: 5000 });
      } catch { /* skip failures */ }
    }

    done += chunk.length;
    process.stdout.write(`\r   ${done}/${total} (${((done / total) * 100).toFixed(1)}%)`);
  }

  console.log(`\n   Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Summary
  const totalKb = execSync(`du -sc "${OUTPUT_ASSETS_DIR}" 2>/dev/null`, { encoding: 'utf8' })
    .split('\n').find(l => l.includes('total'))?.split('\t')[0]?.trim() || '?';
  console.log(`📦 Output: ${OUTPUT_ASSETS_DIR} (${totalKb} KB total)`);
} else {
  console.log('💡 Run with --convert to convert all PNGs to WebP in parallel.');
}
