// packages/shared/lpc/src/lib/rig_compat.ts
//
// biome-ignore-all lint/style/useNamingConvention: LPC asset segment names (bodies_female, chainmail_male, …) are literal snake_case catalog identifiers, not code identifiers.
//
// Wearer-aware equipment / clothing resolution.
//
// The LPC catalog ships body-profile-dependent variants of many clothing and
// armour sheets. The catalog's *default* entries for those sheets are the
// male-body variants (e.g. `torso/chainmail_male`, `feet/boots/basic_male`).
// Rendering a female (or teen / child / muscular / pregnant) body with those
// defaults produces the mixed-silhouette bug: a female body wearing male
// chainmail and male boots.
//
// This module is the ONE place that maps a body asset to its "rig" and then
// resolves a default sheet asset to a compatible variant for that rig. The
// mapping is grounded in the upstream Universal-LPC spritesheet generator
// `sheet_definitions` (shipped under examples/) and is **catalog-verified**:
// a candidate is only returned when it actually exists in the injected slot
// catalog. There is deliberately no blind `_male` → `_female` string
// replacement — the female suffix for feet/legs is `_thin`, not `_female`,
// and several sheets (e.g. `hat/helmet/nasal_adult`) are body-agnostic.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The body silhouette a wearer uses. Derived from the `body` slot asset. */
export type LpcRig = 'male' | 'female' | 'child' | 'teen' | 'muscular' | 'pregnant';

/** Body-profile suffixes found at the end of a sheet asset's last segment. */
export type LpcBodySuffix = 'male' | 'female' | 'thin' | 'teen' | 'child' | 'muscular' | 'pregnant';

/** A resolution detail for observability (never whole save contents). */
export type RigCompatDiagnostic = {
  slot: string;
  assetId: string;
  rig: LpcRig;
  detail: string;
};

/** Result of resolving one sheet asset against a wearer rig. */
export type RigCompatibleAssetResult = {
  /** The resolved asset — the compatible variant when found, else the original. */
  assetId: string;
  /** `compatible` = a rig-matching asset is used; `fallback` = original kept. */
  status: 'compatible' | 'fallback';
  diagnostics: readonly RigCompatDiagnostic[];
};

// ---------------------------------------------------------------------------
// Body asset → rig
// ---------------------------------------------------------------------------

/** Flat catalog body segments (e.g. `body/bodies_female`). */
const RIG_BY_BODY_SEGMENT = {
  bodies_male: 'male',
  bodies_female: 'female',
  bodies_child: 'child',
  bodies_teen: 'teen',
  bodies_muscular: 'muscular',
  bodies_pregnant: 'pregnant',
} as const satisfies Readonly<Record<string, LpcRig>>;

/** Nested body segments (e.g. `body/bodies/male/light`). */
const RIG_BY_NESTED_SEGMENT = {
  male: 'male',
  female: 'female',
  child: 'child',
  teen: 'teen',
  muscular: 'muscular',
  pregnant: 'pregnant',
  // `thin`/`thick` are legacy spellings of the female/male silhouettes.
  thin: 'female',
  thick: 'male',
} as const satisfies Readonly<Record<string, LpcRig>>;

/** Narrows a dynamic segment to a catalog-verified flat body key. */
const isFlatBodySegment = (segment: string): segment is keyof typeof RIG_BY_BODY_SEGMENT =>
  Object.hasOwn(RIG_BY_BODY_SEGMENT, segment);

/** Narrows a dynamic segment to a catalog-verified nested body key. */
const isNestedBodySegment = (segment: string): segment is keyof typeof RIG_BY_NESTED_SEGMENT =>
  Object.hasOwn(RIG_BY_NESTED_SEGMENT, segment);

/**
 * Maps a body-slot asset ID to its rig. Unknown or missing bodies default to
 * `male` — the catalog's own default — so a malformed body never crashes
 * resolution.
 */
export const resolveBodyRig = (bodyAssetId: string | null | undefined): LpcRig => {
  if (!bodyAssetId) {
    return 'male';
  }
  const segments = bodyAssetId.split('/');
  for (const segment of segments) {
    if (isFlatBodySegment(segment)) {
      return RIG_BY_BODY_SEGMENT[segment];
    }
  }
  for (const segment of segments) {
    if (isNestedBodySegment(segment)) {
      return RIG_BY_NESTED_SEGMENT[segment];
    }
  }
  return 'male';
};

// ---------------------------------------------------------------------------
// Suffix resolution
// ---------------------------------------------------------------------------

const BODY_SUFFIXES = [
  'male',
  'female',
  'thin',
  'teen',
  'child',
  'muscular',
  'pregnant',
] as const satisfies readonly LpcBodySuffix[];

/**
 * Ordered, per-rig candidate suffixes.
 *
 * Grounded in the upstream `sheet_definitions`:
 *   - female torso → `_female`, female legs/feet → `_thin` (and `_female` for
 *     the sheets that only ship a `_female` pair, e.g. feet plate armour).
 *   - teen/pregnant/child reuse the `teen` / `_female` / `_thin` variants when
 *     a dedicated suffix does not exist.
 *   - muscular falls back to `_male` (upstream maps muscular → male sheets).
 */
export const RIG_SUFFIXES = {
  male: ['male'],
  female: ['female', 'thin'],
  teen: ['teen', 'female', 'thin'],
  muscular: ['muscular', 'male'],
  pregnant: ['pregnant', 'female', 'thin'],
  child: ['child', 'teen', 'female', 'thin'],
} as const satisfies Readonly<Record<LpcRig, readonly LpcBodySuffix[]>>;

/** Extracts the trailing body suffix of an asset, or `null` when body-agnostic. */
const detectBodySuffix = (assetId: string): LpcBodySuffix | null => {
  const lastSegment = assetId.slice(assetId.lastIndexOf('/') + 1);
  for (const suffix of BODY_SUFFIXES) {
    if (lastSegment.endsWith(`_${suffix}`)) {
      return suffix;
    }
  }
  return null;
};

/**
 * Resolves a sheet asset (equipment or base clothing) to a variant compatible
 * with the wearer's rig.
 *
 * - Body-agnostic assets (no body suffix, e.g. `hat/helmet/nasal_adult` or
 *   weapons) are returned unchanged.
 * - An asset already carrying an acceptable suffix for the rig is preserved
 *   as-is — an explicitly chosen `_thin` pant is never silently re-cut.
 * - Otherwise the trailing suffix is swapped for each candidate in priority
 *   order; the FIRST candidate present in the slot catalog wins. This is what
 *   keeps the mapping grounded: the catalog, not string substitution, decides
 *   whether a variant exists.
 * - When no compatible variant exists the original asset is kept and a
 *   structured diagnostic is returned so the caller can log a warning.
 */
export const resolveRigCompatibleAsset = (options: {
  slot: string;
  assetId: string;
  rig: LpcRig;
  catalogAssetIdsBySlot: Readonly<Record<string, readonly string[]>>;
}): RigCompatibleAssetResult => {
  const { slot, assetId, rig, catalogAssetIdsBySlot } = options;

  const suffix = detectBodySuffix(assetId);
  if (suffix === null) {
    return { assetId, status: 'compatible', diagnostics: [] };
  }

  const priority: readonly LpcBodySuffix[] = RIG_SUFFIXES[rig];
  if (priority.includes(suffix)) {
    // Already acceptable for this rig — never re-cut an explicit choice.
    return { assetId, status: 'compatible', diagnostics: [] };
  }

  const base = assetId.slice(0, -(suffix.length + 1)); // strip `_<suffix>`
  const slotIds = catalogAssetIdsBySlot[slot] ?? [];

  for (const candidateSuffix of priority) {
    const candidate = `${base}_${candidateSuffix}`;
    if (slotIds.includes(candidate)) {
      return { assetId: candidate, status: 'compatible', diagnostics: [] };
    }
  }

  return {
    assetId,
    status: 'fallback',
    diagnostics: [
      {
        slot,
        assetId,
        rig,
        detail:
          `No ${rig}-compatible variant of "${assetId}" exists in the ${slot} catalog. ` +
          'Kept the original asset — review the item definition or catalog.',
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// Base appearance recipe resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the rig-dependent clothing slots (`torso`, `legs`, `feet`) of a
 * base appearance recipe against the recipe's own `body` slot.
 *
 * Used by both `_buildPlayerData` implementations (boot + engine services) so
 * a female persona with only a body override never renders the default male
 * chainmail/boots. The returned `rig` is the wearer context to hand to the
 * equipment service.
 */
export const resolveBaseAppearanceRecipe = (options: {
  recipe: Readonly<Record<string, string>>;
  catalogAssetIdsBySlot: Readonly<Record<string, readonly string[]>>;
}): {
  recipe: Record<string, string>;
  rig: LpcRig;
  diagnostics: readonly RigCompatDiagnostic[];
} => {
  const { recipe, catalogAssetIdsBySlot } = options;
  const rig = resolveBodyRig(recipe.body);
  const resolved: Record<string, string> = { ...recipe };
  const diagnostics: RigCompatDiagnostic[] = [];

  for (const slot of ['torso', 'legs', 'feet'] as const) {
    const assetId = resolved[slot];
    if (!assetId) {
      continue;
    }
    const result = resolveRigCompatibleAsset({ slot, assetId, rig, catalogAssetIdsBySlot });
    resolved[slot] = result.assetId;
    diagnostics.push(...result.diagnostics);
  }

  return { recipe: resolved, rig, diagnostics };
};
