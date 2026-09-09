#!/usr/bin/env bun
/**
 * scripts/src/lib/ops/validate_content_appearance.ts
 *
 * C-504 AC-4 — build-time content validator for NPC appearance.
 *
 * Walks every content pack under `content/packs/*` and validates each NPC's
 * appearance against the SAME catalog and normalization the runtime uses:
 *
 *   - the derived LPC catalog is built via `buildLpcCatalog` from the verified
 *     legacy snapshot — the exact shape `/game` resolves against;
 *   - a named `appearance` (slot + assetId + layerRole) is validated against
 *     that catalog (missing asset → diagnostic, never a positional substitute);
 *   - legacy `appearanceLayers` are migrated through the shared normalization
 *     boundary tied to the verified snapshot — never a raw positional read.
 *
 * The old fixture-only validator approved the LEGACY interpretation that the
 * runtime rejects; this one exercises the runtime interpretation so the two
 * cannot drift. Readable diagnostics name the pack, NPC, slot and source
 * snapshot.
 *
 * Exits non-zero on the first error. Wired into the `validate:*` family (see
 * package.json `validate:content`) and the `scripts:validate-content` moon task
 * (`runInCI: true`).
 *
 * Usage: bun run validate:content
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import {
  type AppearanceCatalog,
  buildLpcCatalog,
  LEGACY_CATALOG_SNAPSHOT,
  LEGACY_CATALOG_SNAPSHOT_ID,
  type NamedAppearance,
  namedToLayerIds,
  resolveNpcAppearance,
} from '@aikami/lpc';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const CONTENT_PACKS_ROOT = join(REPO_ROOT, 'content/packs');

/**
 * Loads the DERIVED LPC catalog the runtime resolves against, built from the
 * verified legacy snapshot. This is the same catalog shape `/game` uses — not
 * the raw legacy ordering (AC-4 parity).
 */
export const loadCatalog = (): AppearanceCatalog => {
  const entries: { tag: string; category: string; ext: string }[] = [];
  for (const [, assetIds] of Object.entries(LEGACY_CATALOG_SNAPSHOT)) {
    for (const assetId of assetIds) {
      const tagPath = assetId.replace(/\//g, ':');
      entries.push({ tag: `lpc:${tagPath}:walk`, category: 'lpc', ext: 'webp' });
    }
  }
  return buildLpcCatalog({ entries }).slots;
};

/** A content-pack manifest subset carrying NPC appearance data. */
type ManifestJson = {
  id?: string;
  npcs?: Record<string, { appearanceLayers?: number[]; appearance?: NamedAppearance } | undefined>;
};

/** One validation error, rendered as an actionable message. */
export type AppearanceValidationError = {
  packId: string;
  npcId: string;
  slot?: string;
  assetId?: string;
  source?: string;
  snapshot?: string;
  detail: string;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

/**
 * Validates one NPC's appearance (named `appearance` preferred, legacy
 * `appearanceLayers` migrated) against the runtime catalog via the shared
 * normalization boundary. Empty appearance → no errors.
 */
export const validateNpcAppearance = (options: {
  packId: string;
  npcId: string;
  appearance?: NamedAppearance;
  appearanceLayers?: readonly number[];
  catalog: AppearanceCatalog;
}): AppearanceValidationError[] => {
  const { packId, npcId, appearance, appearanceLayers, catalog } = options;
  const named = appearance;
  const legacy = appearanceLayers;

  // C-504: when the manifest retains BOTH the named appearance and the legacy
  // array, assert they describe the SAME identity — they cannot drift.
  const crossCheckErrors: AppearanceValidationError[] = [];
  if (named && legacy && legacy.length > 0) {
    const namedIds = namedToLayerIds(named, catalog).layerIds;
    const legacyMigrated = resolveNpcAppearance({
      input: legacy,
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
      source: 'manifest:appearanceLayers',
      packId,
      npcId,
    });
    if (legacyMigrated.layerIds) {
      for (let i = 0; i < namedIds.length; i++) {
        if ((namedIds[i] ?? 0) !== (legacyMigrated.layerIds[i] ?? 0)) {
          crossCheckErrors.push({
            packId,
            npcId,
            slot: ['body', 'hair', 'torso', 'legs', 'feet', 'head'][i],
            source: 'manifest:appearance-vs-appearanceLayers',
            snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
            detail:
              'Named `appearance` and legacy `appearanceLayers` resolve to different layer IDs — the two representations have drifted.',
          });
        }
      }
    }
  }

  const result = resolveNpcAppearance({
    input: named ?? legacy,
    catalog,
    snapshot: named ? undefined : LEGACY_CATALOG_SNAPSHOT_ID,
    source: named ? 'manifest:appearance' : 'manifest:appearanceLayers',
    packId,
    npcId,
  });

  if (result.status === 'empty') {
    return crossCheckErrors;
  }
  if (result.status === 'migrated' || result.status === 'named') {
    // Migrated/named with zero diagnostics = runtime-valid.
    return [
      ...crossCheckErrors,
      ...result.diagnostics.map((d) => ({
        packId,
        npcId,
        slot: d.slot,
        assetId: d.assetId,
        source: named ? 'manifest:appearance' : 'manifest:appearanceLayers',
        snapshot: named ? undefined : LEGACY_CATALOG_SNAPSHOT_ID,
        detail: d.detail,
      })),
    ];
  }
  // unknown-provenance / invalid — every diagnostic is a hard error.
  return [
    ...crossCheckErrors,
    ...result.diagnostics.map((d) => ({
      packId,
      npcId,
      slot: d.slot,
      assetId: d.assetId,
      source: named ? 'manifest:appearance' : 'manifest:appearanceLayers',
      snapshot: named ? undefined : LEGACY_CATALOG_SNAPSHOT_ID,
      detail: d.detail,
    })),
  ];
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
      const appearance = entry?.appearance;
      const appearanceLayers = entry?.appearanceLayers;
      if (!appearance && (!appearanceLayers || appearanceLayers.length === 0)) {
        continue; // No declared appearance — nothing to validate.
      }
      errors.push(
        ...validateNpcAppearance({ packId, npcId, appearance, appearanceLayers, catalog }),
      );
    }
  }

  return errors;
};

function main(): void {
  console.log('Validating content-pack NPC appearance (runtime parity)...');
  let errors: AppearanceValidationError[];
  try {
    errors = validateContentAppearance();
  } catch (error) {
    console.error(`✗ Validator crashed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} appearance error(s) found:`);
    for (const err of errors) {
      const scope = err.slot ? ` slot="${err.slot}"` : '';
      const asset = err.assetId ? ` asset="${err.assetId}"` : '';
      const source = err.source ? ` source="${err.source}"` : '';
      const snapshot = err.snapshot ? ` snapshot="${err.snapshot}"` : '';
      console.error(
        `  - pack="${err.packId}" npc="${err.npcId}"${scope}${asset}${source}${snapshot} — ${err.detail}`,
      );
    }
    console.error('  Fix the manifest NPC appearance (named `appearance` preferred).');
    process.exit(1);
  }

  console.log('✓ All content-pack NPC appearances are valid and agree with the runtime catalog.');
}

// CLI entry — run only when executed directly so importing this module
// (e.g. from its unit test) stays side-effect free.
if (import.meta.main) {
  main();
}
