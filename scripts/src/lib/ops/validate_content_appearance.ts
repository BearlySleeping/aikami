#!/usr/bin/env bun
/**
 * scripts/src/lib/ops/validate_content_appearance.ts
 *
 * C-400 AC-5 — build-time content validator for NPC appearance indices.
 *
 * Walks every content pack under `apps/frontend/client/static/content-packs/*`
 * and validates each NPC's `appearanceLayers` against the generated LPC
 * catalog (derived at runtime via `buildLpcCatalog` from `@aikami/lpc`):
 *
 *   - each 1-indexed layer value must be within its slot's variant range
 *   - head-slot indices must resolve to a `head/heads/*` asset (the old
 *     render-time `effectiveIdx = 94` override is gone — validity is a
 *     content-load-time concern now)
 *   - packs may declare FEWER than six layers (some packs declare 4);
 *     only the indices present are validated, missing trailing slots
 *     (feet, head) are treated as absent → runtime fallback
 *
 * Exits non-zero naming the pack id, NPC id, slot, offending index, and the
 * valid range. Wired into the `validate:*` family (see package.json
 * `validate:content`) and the `scripts:validate-content` moon task
 * (`runInCI: true`), so `moon ci` fails on invalid appearance data.
 *
 * Usage: bun run validate:content
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const CONTENT_PACKS_ROOT = join(REPO_ROOT, 'apps/frontend/client/static/content-packs');
// Catalog is now derived at runtime via buildLpcCatalog from @aikami/lpc.
// The old GENERATED_CATALOG path (lpc_asset_catalog_generated.ts) is removed.

/** Engine slot order — the same six slots the resolver iterates. */
const ENGINE_SLOTS = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

/** A slot's catalog: slot name + variant asset IDs. */
type CatalogSlot = {
  slot: string;
  variants: readonly string[];
};

/**
 * Parses the generated LPC catalog TypeScript file textually.
 *
 * The file is machine-generated with a stable shape:
 *
 * ```ts
 * export const GENERATED_LPC_SLOTS: readonly LpcSlotDefinition[] = [
 *   {
 *     slot: 'head',
 *     ...
 *     variants: [
 *       { assetId: 'head/ears/avyon_adult', ... },
 *       ...
 *     ],
 *   },
 *   ...
 * ];
 * ```
 *
 * We extract `slot: '<name>'` blocks and count/collect their `assetId`
 * values. Parsing text (like validate_wgsl) avoids importing a module that
 * carries client `$lib` aliases into the scripts package.
 */
export const parseGeneratedCatalog = (source: string): CatalogSlot[] => {
  const slots: CatalogSlot[] = [];

  // Collect all slot declaration offsets first, then slice blocks between
  // consecutive slot declarations.
  const slotOffsets: Array<{ name: string; index: number }> = [];
  const slotPattern = /slot:\s*['"]([^'"]+)['"]/g;
  while (true) {
    const slotMatch = slotPattern.exec(source);
    if (slotMatch === null) {
      break;
    }
    const slotName = slotMatch[1];
    if (slotName) {
      slotOffsets.push({ name: slotName, index: slotMatch.index });
    }
  }

  for (let i = 0; i < slotOffsets.length; i++) {
    const slotName = slotOffsets[i]?.name ?? '';
    const start = slotOffsets[i]?.index ?? 0;
    const end = slotOffsets[i + 1]?.index ?? source.length;
    const block = source.slice(start, end);

    const variants: string[] = [];
    const assetPattern = /assetId:\s*['"]([^'"]+)['"]/g;
    while (true) {
      const assetMatch = assetPattern.exec(block);
      if (assetMatch === null) {
        break;
      }
      const assetId = assetMatch[1];
      if (assetId) {
        variants.push(assetId);
      }
    }

    slots.push({ slot: slotName, variants });
  }

  return slots;
};

/**
 * Loads the LPC catalog from the legacy fixture.
 * The catalog is now derived at runtime via buildLpcCatalog in @aikami/lpc.
 * For build-time validation, we use the legacy fixture snapshot.
 */
export const loadCatalog = (): CatalogSlot[] => {
  const fixturePath = join(
    REPO_ROOT,
    'packages/shared/lpc/tests/__fixtures__/legacy_catalog_order.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
    slots: Array<{ slot: string; label: string; assetIds: string[] }>;
  };
  return fixture.slots.map((s) => ({
    slot: s.slot,
    variants: s.assetIds,
  }));
};

/** A content-pack manifest subset carrying NPC appearance data. */
type ManifestJson = {
  id?: string;
  npcs?: Record<string, { appearanceLayers?: number[] } | undefined>;
};

/** One validation error, rendered as an actionable message. */
export type AppearanceValidationError = {
  packId: string;
  npcId: string;
  slot: string;
  index: number;
  validRange: string;
  detail: string;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

/**
 * Validates one NPC's appearanceLayers against the catalog.
 *
 * Only the indices present are validated (packs may declare fewer than six
 * layers). Head-slot indices must resolve to a `head/heads/*` asset.
 */
export const validateNpcAppearance = (options: {
  packId: string;
  npcId: string;
  appearanceLayers: readonly number[];
  catalog: readonly CatalogSlot[];
}): AppearanceValidationError[] => {
  const { packId, npcId, appearanceLayers, catalog } = options;
  const errors: AppearanceValidationError[] = [];

  for (let i = 0; i < appearanceLayers.length; i++) {
    const slot = ENGINE_SLOTS[i];
    if (!slot) {
      break; // More than six layers — engine ignores extras; do not fail.
    }
    // Raw JSON — validate the actual runtime value before any arithmetic:
    // reject strings, null, and fractional numbers (e.g. "1", null, 1.5).
    // A missing trailing slot (undefined) stays absent → runtime fallback.
    const rawIndex = appearanceLayers[i];
    if (rawIndex === undefined) {
      continue;
    }
    if (typeof rawIndex !== 'number' || !Number.isSafeInteger(rawIndex) || rawIndex < 0) {
      errors.push({
        packId,
        npcId,
        slot,
        index: typeof rawIndex === 'number' ? rawIndex : Number.NaN,
        validRange: 'a non-negative integer (0 = intentionally empty)',
        detail: `Index ${String(rawIndex)} is not a non-negative integer.`,
      });
      continue;
    }
    if (rawIndex === 0) {
      continue; // 0 = intentionally empty (torso/feet equipment slots).
    }
    const index = rawIndex;

    const slotDef = catalog.find((s) => s.slot === slot);
    if (!slotDef) {
      errors.push({
        packId,
        npcId,
        slot,
        index,
        validRange: 'n/a',
        detail: `Catalog has no slot "${slot}".`,
      });
      continue;
    }

    // 1-indexed layer values → 0-indexed variant lookup.
    const effectiveIdx = index - 1;
    if (effectiveIdx < 0 || effectiveIdx >= slotDef.variants.length) {
      errors.push({
        packId,
        npcId,
        slot,
        index,
        validRange: `1..${slotDef.variants.length}`,
        detail: `Index ${index} is outside slot "${slot}" (${slotDef.variants.length} variants).`,
      });
      continue;
    }

    const assetId = slotDef.variants[effectiveIdx] ?? '';
    if (slot === 'head' && !assetId.startsWith('head/heads/')) {
      errors.push({
        packId,
        npcId,
        slot,
        index,
        validRange: 'a head/heads/* asset index',
        detail: `Head index ${index} resolves to "${assetId}" which is not a head/heads/* asset.`,
      });
    }
  }

  return errors;
};

/**
 * Validates every content pack under the packs root.
 *
 * @returns Array of validation errors (empty = all packs valid).
 */
export const validateContentAppearance = (): AppearanceValidationError[] => {
  const catalog = loadCatalog();
  const errors: AppearanceValidationError[] = [];

  if (!statSync(CONTENT_PACKS_ROOT).isDirectory()) {
    throw new Error(`Content packs root not found: ${CONTENT_PACKS_ROOT}`);
  }

  const packDirs = readdirSync(CONTENT_PACKS_ROOT).filter((entry) => {
    const full = join(CONTENT_PACKS_ROOT, entry);
    return statSync(full).isDirectory() && !entry.startsWith('.');
  });

  for (const packDir of packDirs) {
    const manifestPath = join(CONTENT_PACKS_ROOT, packDir, 'manifest.json');
    let manifest: ManifestJson;
    try {
      manifest = readJson<ManifestJson>(manifestPath);
    } catch {
      // Not a content pack (no manifest) — skip.
      continue;
    }

    const packId = manifest.id ?? packDir;
    for (const [npcId, entry] of Object.entries(manifest.npcs ?? {})) {
      const layers = entry?.appearanceLayers;
      if (!layers || layers.length === 0) {
        continue; // No declared appearance — nothing to validate.
      }
      errors.push(...validateNpcAppearance({ packId, npcId, appearanceLayers: layers, catalog }));
    }
  }

  return errors;
};

function main(): void {
  console.log('Validating content-pack NPC appearance indices...');
  let errors: AppearanceValidationError[];
  try {
    errors = validateContentAppearance();
  } catch (error) {
    console.error(`✗ Validator crashed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} appearance index error(s) found:`);
    for (const err of errors) {
      console.error(
        `  - pack="${err.packId}" npc="${err.npcId}" slot="${err.slot}" index=${err.index} ` +
          `(valid: ${err.validRange}) — ${err.detail}`,
      );
    }
    console.error('  Fix the manifest appearanceLayers or regenerate the LPC catalog.');
    process.exit(1);
  }

  console.log('✓ All content-pack NPC appearance indices are valid.');
}

// CLI entry — run only when executed directly so importing this module
// (e.g. from its unit test) stays side-effect free.
if (import.meta.main) {
  main();
}
