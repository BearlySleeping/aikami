// packages/shared/lpc/src/lib/named_appearance.ts
//
// C-504 — named appearance identity and legacy migration.
//
// Catalog POSITION is never a durable identity. A character's anatomy/outfit
// is represented by NAMED, namespaced component IDs (slot + assetId + explicit
// layerRole). Numeric handles exist only as session-local engine data, derived
// AFTER named identity is established.
//
// This module is the ONE normalization boundary for:
//   - content-pack NPCs (manifest `appearance` / legacy `appearanceLayers`)
//   - persona `appearance.lpcRecipe` (a named slot→assetId map)
//   - validator/runtime parity (same catalog in, same named identities out)
//
// Legacy numeric arrays are ONLY migrated when they are tied to a DECLARED,
// verified catalog-order snapshot (LEGACY_CATALOG_SNAPSHOT_ID). An unversioned
// legacy array whose provenance is unknown is never guessed or overwritten —
// the original record is preserved and a structured diagnostic is returned.
// Index `0` always means "intentionally empty" and is preserved.
//
// Migration is idempotent: an already-named appearance is returned unchanged
// (status 'named'); re-running over the same input yields the same output.

import { LPC_SLOT_ORDER } from './appearance.ts';
import { LEGACY_CATALOG_SNAPSHOT, LEGACY_CATALOG_SNAPSHOT_ID } from './legacy_catalog_snapshot.ts';
import type { LpcLayerRole } from './slot_model.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One durable base-appearance component: slot + stable asset ID + explicit role. */
/** One durable base-appearance component: slot + stable asset ID + explicit role. */
export type NamedAppearanceComponent = {
  /** Body/clothing slot name (e.g. "body", "hair", "torso"). */
  slot: string;
  /** Stable namespaced asset ID (e.g. "head/heads/human_male"). '' = intentionally empty. */
  assetId: string;
  /** Which side of the body this layer draws on. Missing input normalizes to 'front'. */
  layerRole?: LpcLayerRole;
};

/** Explains a legacy conversion — sufficient to audit why a record changed. */
export type NamedAppearanceProvenance = {
  /** Where the legacy record came from (e.g. 'manifest:appearanceLayers'). */
  source: string;
  /** Catalog-order snapshot the legacy indices were tied to. */
  snapshot: string;
  packId?: string;
  npcId?: string;
};

/** Versioned named appearance representation. */
export type NamedAppearance = {
  formatVersion: 1;
  components: readonly NamedAppearanceComponent[];
  legacyProvenance?: NamedAppearanceProvenance;
};

/**
 * The projection of a catalog the normalizer understands. Both the projected
 * engine catalog (`LpcSlotCatalog[]`) and `buildLpcCatalog().slots` satisfy it.
 */
export type AppearanceCatalogSlot = {
  slot: string;
  variants: readonly { assetId: string }[];
};
export type AppearanceCatalog = readonly AppearanceCatalogSlot[];

export type AppearanceNormalizationStatus =
  | 'named' // input was already named (idempotent no-op)
  | 'migrated' // known legacy input converted once via the verified snapshot
  | 'unknown-provenance' // legacy input with no recognized snapshot — preserved
  | 'invalid'; // a referenced asset is missing / a legacy index is out of range

/** Readable diagnostic naming entity/slot/asset — never whole save contents. */
export type AppearanceDiagnostic = {
  entityId?: string;
  packId?: string;
  npcId?: string;
  slot?: string;
  assetId?: string;
  source?: string;
  detail: string;
};

export type ResolveNpcAppearanceOptions = {
  /** The input appearance: legacy indices, a named appearance, or a persona recipe. */
  input: readonly number[] | NamedAppearance | Readonly<Record<string, string>> | undefined;
  /** The derived catalog the engine resolves against (same on worker + main). */
  catalog: AppearanceCatalog;
  /**
   * Declared catalog-order snapshot for legacy arrays. Only
   * LEGACY_CATALOG_SNAPSHOT_ID is recognized; anything else → unknown-provenance.
   */
  snapshot?: string;
  /** Human label for the source record (observability). */
  source?: string;
  packId?: string;
  npcId?: string;
  entityId?: string;
  /** Whole-character safe preset when resolution fails (never a mixed per-slot recipe). */
  fallbackLayerIds?: readonly number[];
};

export type ResolveNpcAppearanceResult = {
  /** Derived engine layer IDs (0 = intentionally empty), when resolvable. */
  layerIds?: readonly number[];
  /** The normalized named appearance, when established. */
  appearance?: NamedAppearance;
  status: AppearanceNormalizationStatus | 'empty';
  diagnostics: readonly AppearanceDiagnostic[];
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Normalizes a layer role to 'front' when omitted or unrecognized. */
export const normalizeLayerRole = (role: string | null | undefined): LpcLayerRole =>
  role === 'behind' ? 'behind' : 'front';

/** Type guard for a parsed named appearance record. */
export const isNamedAppearance = (value: unknown): value is NamedAppearance => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { formatVersion?: unknown; components?: unknown };
  return (
    record.formatVersion === 1 &&
    Array.isArray(record.components) &&
    record.components.every(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as { slot?: unknown }).slot === 'string' &&
        typeof (c as { assetId?: unknown }).assetId === 'string',
    )
  );
};

// ---------------------------------------------------------------------------
// Legacy → named migration (verified snapshot only)
// ---------------------------------------------------------------------------

/**
 * Converts a legacy 1-indexed layer array to a named appearance using the
 * verified catalog-order snapshot. Index `0` = intentionally empty.
 *
 * Refuses (status 'invalid') rather than partially converting when any index
 * is out of the snapshot's range — a partially-converted character with
 * unrelated per-slot defaults is never manufactured.
 */
export const legacyToNamed = (
  layerIds: readonly number[],
  options: {
    snapshot: string;
    source?: string;
    packId?: string;
    npcId?: string;
    entityId?: string;
  },
): {
  status: AppearanceNormalizationStatus;
  appearance?: NamedAppearance;
  diagnostics: AppearanceDiagnostic[];
} => {
  const diagnostics: AppearanceDiagnostic[] = [];

  if (options.snapshot !== LEGACY_CATALOG_SNAPSHOT_ID) {
    diagnostics.push({
      entityId: options.entityId,
      packId: options.packId,
      npcId: options.npcId,
      source: options.source,
      detail:
        `Legacy appearance array has unrecognized provenance (snapshot "${options.snapshot ?? '(none)'}"). ` +
        'Record preserved untouched; it is NOT safe to guess an index mapping.',
    });
    return { status: 'unknown-provenance', diagnostics };
  }

  const components: NamedAppearanceComponent[] = [];
  for (let i = 0; i < LPC_SLOT_ORDER.length; i++) {
    const slot = LPC_SLOT_ORDER[i];
    const raw = layerIds[i];
    // A MISSING trailing slot (short array) is absent → intentionally empty.
    if (raw === undefined) {
      components.push({ slot, assetId: '', layerRole: 'front' });
      continue;
    }
    // Raw JSON may carry strings / null / fractions — never coerce them into a
    // "valid" index ("1" - 1 === 0 would silently pick the first variant;
    // null ?? 0 would silently treat a null as intentionally-empty).
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
      diagnostics.push({
        entityId: options.entityId,
        packId: options.packId,
        npcId: options.npcId,
        slot,
        source: options.source,
        detail: `Legacy value ${String(raw)} for slot "${slot}" is not a non-negative integer. Refusing partial migration.`,
      });
      return { status: 'invalid', diagnostics };
    }
    if (raw === 0) {
      components.push({ slot, assetId: '', layerRole: 'front' });
      continue;
    }
    const assetId = LEGACY_CATALOG_SNAPSHOT[slot]?.[raw - 1];
    if (!assetId) {
      diagnostics.push({
        entityId: options.entityId,
        packId: options.packId,
        npcId: options.npcId,
        slot,
        source: options.source,
        detail:
          `Legacy index ${raw} for slot "${slot}" is outside the verified snapshot range ` +
          `(${LEGACY_CATALOG_SNAPSHOT[slot]?.length ?? 0} variants). Refusing partial migration.`,
      });
      return { status: 'invalid', diagnostics };
    }
    components.push({ slot, assetId, layerRole: 'front' });
  }

  return {
    status: 'migrated',
    appearance: {
      formatVersion: 1,
      components,
      legacyProvenance: {
        source: options.source ?? 'appearanceLayers',
        snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
        packId: options.packId,
        npcId: options.npcId,
      },
    },
    diagnostics,
  };
};

// ---------------------------------------------------------------------------
// Named validation + normalization
// ---------------------------------------------------------------------------

/** Per-slot asset ID lookup against a catalog (both projected and wide shapes). */
const assetIdsForSlot = (catalog: AppearanceCatalog, slot: string): readonly string[] | undefined =>
  catalog.find((s) => s.slot === slot)?.variants.map((v) => v.assetId);

/**
 * Validates + normalizes a named appearance. Missing `layerRole` defaults to
 * 'front'. Missing referenced assets produce a diagnostic (record preserved —
 * never a positional substitute). When `catalog` is omitted, only shape and
 * role normalization run (no asset-existence check).
 */
export const normalizeNamed = (
  input: NamedAppearance,
  options: { catalog?: AppearanceCatalog; entityId?: string } = {},
): {
  status: AppearanceNormalizationStatus;
  appearance: NamedAppearance;
  diagnostics: AppearanceDiagnostic[];
} => {
  const diagnostics: AppearanceDiagnostic[] = [];
  const components: NamedAppearanceComponent[] = input.components.map((c) => ({
    slot: c.slot,
    assetId: c.assetId,
    layerRole: normalizeLayerRole(c.layerRole),
  }));

  if (options.catalog) {
    for (const c of components) {
      if (c.assetId === '') {
        continue; // intentionally empty
      }
      const slotAssetIds = assetIdsForSlot(options.catalog, c.slot);
      if (!slotAssetIds?.includes(c.assetId)) {
        diagnostics.push({
          entityId: options.entityId,
          slot: c.slot,
          assetId: c.assetId,
          detail:
            `Named appearance references "${c.assetId}" for slot "${c.slot}" which is not in the catalog. ` +
            'Record preserved; resolution will use the whole-character safe preset (never a positional substitute).',
        });
      }
    }
  }

  const status: AppearanceNormalizationStatus = diagnostics.length > 0 ? 'invalid' : 'named';
  return {
    status,
    appearance: {
      formatVersion: 1,
      components,
      ...(input.legacyProvenance ? { legacyProvenance: input.legacyProvenance } : {}),
    },
    diagnostics,
  };
};

/**
 * Converts a persona `lpcRecipe` (slot → assetId map) to a named appearance.
 * Existing named persona recipes remain supported unchanged.
 */
export const normalizePersonaRecipe = (
  recipe: Readonly<Record<string, string>>,
  options: { catalog?: AppearanceCatalog; entityId?: string } = {},
): {
  status: AppearanceNormalizationStatus;
  appearance: NamedAppearance;
  diagnostics: AppearanceDiagnostic[];
} => {
  const input: NamedAppearance = {
    formatVersion: 1,
    components: Object.entries(recipe).map(([slot, assetId]) => ({
      slot,
      assetId,
      layerRole: 'front',
    })),
  };
  return normalizeNamed(input, options);
};

// ---------------------------------------------------------------------------
// Named → session-local engine layer IDs
// ---------------------------------------------------------------------------

/**
 * Maps a named appearance to the six engine layer IDs in LPC_SLOT_ORDER
 * (1-indexed variant numbers; 0 = intentionally empty), derived from the
 * catalog the engine actually resolves against. Deterministic and
 * position-independent: a catalog reorder/insertion cannot change the output.
 *
 * `missing` lists slots whose named assetId is absent from the catalog — the
 * caller decides the safe whole-character fallback (never per-slot mixing).
 */
export const namedToLayerIds = (
  appearance: NamedAppearance,
  catalog: AppearanceCatalog,
): { layerIds: readonly number[]; missing: readonly string[] } => {
  const bySlot = new Map<string, NamedAppearanceComponent>();
  for (const c of appearance.components) {
    // Base representation keeps ONE component per slot; the first wins.
    if (!bySlot.has(c.slot)) {
      bySlot.set(c.slot, c);
    }
  }

  const layerIds: number[] = [];
  const missing: string[] = [];
  for (const slot of LPC_SLOT_ORDER) {
    const component = bySlot.get(slot);
    if (!component || component.assetId === '') {
      layerIds.push(0);
      continue;
    }
    const slotAssetIds = assetIdsForSlot(catalog, slot);
    const idx = slotAssetIds?.indexOf(component.assetId) ?? -1;
    if (idx >= 0) {
      layerIds.push(idx + 1);
    } else {
      missing.push(slot);
      layerIds.push(0);
    }
  }
  return { layerIds, missing };
};

// ---------------------------------------------------------------------------
// Unified entry — one normalization function for all readers/writers
// ---------------------------------------------------------------------------

/**
 * The single normalization boundary for NPC appearance: accepts a legacy
 * array, a named appearance, a persona recipe, or nothing; returns derived
 * engine layer IDs (with a named appearance + diagnostics) or a clearly
 * identified failure the caller maps to a whole-character safe preset.
 *
 * Idempotent: named input passes through unchanged (status 'named').
 */
export const resolveNpcAppearance = (
  options: ResolveNpcAppearanceOptions,
): ResolveNpcAppearanceResult => {
  const { input, catalog, snapshot, source, packId, npcId, entityId, fallbackLayerIds } = options;

  // Nothing declared → empty.
  if (input === undefined) {
    return {
      status: 'empty',
      ...(fallbackLayerIds ? { layerIds: fallbackLayerIds } : {}),
      diagnostics: [],
    };
  }

  // Legacy numeric array.
  if (Array.isArray(input)) {
    const migrated = legacyToNamed(input, {
      snapshot: snapshot ?? '',
      source,
      packId,
      npcId,
      entityId,
    });
    if (migrated.status === 'unknown-provenance' || migrated.status === 'invalid') {
      return {
        status: migrated.status,
        ...(fallbackLayerIds ? { layerIds: fallbackLayerIds } : {}),
        diagnostics: migrated.diagnostics,
      };
    }
    if (!migrated.appearance) {
      return { status: 'invalid', diagnostics: migrated.diagnostics };
    }
    const { layerIds, missing } = namedToLayerIds(migrated.appearance, catalog);
    if (missing.length > 0) {
      return {
        status: 'invalid',
        ...(fallbackLayerIds ? { layerIds: fallbackLayerIds } : {}),
        diagnostics: [
          ...migrated.diagnostics,
          {
            entityId,
            packId,
            npcId,
            source,
            detail: `Migrated assets missing from catalog: ${missing.join(', ')}.`,
          },
        ],
      };
    }
    return {
      status: 'migrated',
      layerIds,
      appearance: migrated.appearance,
      diagnostics: migrated.diagnostics,
    };
  }

  // Persona recipe (slot → assetId map).
  if (typeof input === 'object' && !Array.isArray(input) && !isNamedAppearance(input)) {
    const recipe = input as Readonly<Record<string, string>>;
    const normalized = normalizePersonaRecipe(recipe, { catalog, entityId });
    const { layerIds, missing } = namedToLayerIds(normalized.appearance, catalog);
    if (normalized.status === 'invalid' || missing.length > 0) {
      return {
        status: 'invalid',
        ...(fallbackLayerIds ? { layerIds: fallbackLayerIds } : {}),
        diagnostics: [...normalized.diagnostics],
      };
    }
    return {
      status: 'named',
      layerIds,
      appearance: normalized.appearance,
      diagnostics: normalized.diagnostics,
    };
  }

  // Named appearance.
  const normalized = normalizeNamed(input as NamedAppearance, { catalog, entityId });
  const { layerIds, missing } = namedToLayerIds(normalized.appearance, catalog);
  if (normalized.status === 'invalid' || missing.length > 0) {
    return {
      status: 'invalid',
      ...(fallbackLayerIds ? { layerIds: fallbackLayerIds } : {}),
      diagnostics: normalized.diagnostics,
    };
  }
  return {
    status: 'named',
    layerIds,
    appearance: normalized.appearance,
    diagnostics: normalized.diagnostics,
  };
};
