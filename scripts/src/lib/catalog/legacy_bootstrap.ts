// scripts/src/lib/catalog/legacy_bootstrap.ts
//
// First-release migration from the legacy MUTABLE catalog to the immutable
// release graph.
//
// ── The situation this exists for ──────────────────────────────────────────
//
// Production has never published an immutable release: `index/v1/release.json`
// is a legitimate 404. What it DOES serve is the pre-C-496 mutable surface:
//
//   index/v1/catalog.json     root index, 108 entries across 6 categories
//   index/v1/<category>.json  one mutable shard per category
//   seed/asset_seed.json      the COMPACT BOOT SEED — 12,729 rows
//   seed/offline_core.json    the prefetch/pin tag set
//   index/v1/pack_lock.json   the mutable installed-lock alias
//
// The boot seed carries the complete asset inventory. The root index carries
// only the 108 entries the publishing checkout happened to hold. The local
// checkout holds fewer still (C-435 de-bundled the raw library).
//
// So the FIRST immutable release is not an ordinary publish. Rebuilding the
// graph from the local scan alone would replace a 12,729-row boot seed and a
// 108-entry index with the local subset — every LPC sheet, legacy portrait and
// audio bed an existing installation resolves would vanish, and the publish log
// would read "74 uploaded, 0 failed".
//
// ── What this is NOT ───────────────────────────────────────────────────────
//
// It is not a second catalog architecture, and it is not permanent. It reads
// the legacy objects, validates them, and converts them into the SAME
// `CatalogAssetEntry[]` + carried-dependency map the ordinary verified-release
// carry-forward path produces. Everything downstream — merge, shard, root,
// pointer — is the normal pipeline, unchanged.
//
// It runs ONLY when the target publishes no release pointer. The moment a
// verified immutable release exists, `resolvePreviousRelease` answers and this
// module is not consulted at all. That is asserted by a test.
//
// ── Fail closed ────────────────────────────────────────────────────────────
//
// A legacy object that cannot be read, parsed or schema-validated is a
// REFUSAL, not a skip: silently dropping a category is exactly the truncation
// this module exists to prevent. And if the legacy index and the legacy seed
// disagree about a tag's hash, the legacy state is internally inconsistent and
// there is no correct answer to guess — so it refuses and names the tags.

import type { CatalogAssetEntry, ReleaseDocumentReader } from '@aikami/schemas';
import {
  CatalogIndexRootSchema,
  CatalogIndexShardSchema,
  InstalledPackLockSchema,
  OfflineCoreDeclarationSchema,
} from '@aikami/schemas';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { type CompactSeedDocument, parseCompactSeed } from './compact_seed.ts';
import { httpReleaseReader } from './published_catalog.ts';

/** The legacy mutable root index. */
export const LEGACY_ROOT_KEY = 'index/v1/catalog.json';
/** The legacy compact boot seed — the complete inventory. */
export const LEGACY_SEED_KEY = 'seed/asset_seed.json';
/** The legacy offline-core declaration. */
export const LEGACY_OFFLINE_CORE_KEY = 'seed/offline_core.json';
/** The legacy mutable installed-lock alias. */
export const LEGACY_PACK_LOCK_KEY = 'index/v1/pack_lock.json';

/** The mutable shard key for a legacy category id. */
export const legacyShardKey = (categoryId: string): string => `index/v1/${categoryId}.json`;

export type LegacyBootstrapFailureCode =
  | 'legacy-root-unreadable'
  | 'legacy-root-invalid'
  | 'legacy-shard-unreadable'
  | 'legacy-shard-invalid'
  | 'legacy-shard-count-mismatch'
  | 'legacy-seed-unreadable'
  | 'legacy-seed-invalid'
  | 'legacy-identity-conflict';

/** What a first-release migration would carry, replace, drop or reject. */
export type LegacyBootstrapPlan = {
  /** Legacy entries the new release will carry forward, in shard order. */
  entries: CatalogAssetEntry[];
  /**
   * Legacy objects keyed by their legacy catalog key, in the shape the
   * ordinary carry-forward path uses. Plugs straight into `carriedDependencies`.
   */
  dependencies: Map<string, Uint8Array>;
  /** Legacy tags the current candidate does not produce. */
  carriedTags: string[];
  /** Legacy tags the current candidate replaces with its own bytes. */
  replacedTags: string[];
  /** Legacy seed rows the current candidate does not produce. */
  carriedSeedRows: number;
  /** Legacy objects that were read but deliberately not used, and why. */
  rejected: { key: string; reason: string }[];
};

export type LegacyBootstrapOutcome =
  | { ok: true; applied: false; reason: string }
  | { ok: true; applied: true; plan: LegacyBootstrapPlan }
  | { ok: false; code: LegacyBootstrapFailureCode; reason: string };

type Refusal = { ok: false; code: LegacyBootstrapFailureCode; reason: string };
type ReadResult = { ok: true; bytes: Uint8Array | undefined } | Refusal;

/** Reads one legacy object, turning a transport failure into a refusal. */
const readLegacyObject = async (options: {
  reader: ReleaseDocumentReader;
  key: string;
  code: LegacyBootstrapFailureCode;
}): Promise<ReadResult> => {
  try {
    return { ok: true, bytes: await options.reader(options.key) };
  } catch (error) {
    return {
      ok: false,
      code: options.code,
      reason: `${options.key}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/** Parses bytes and validates them against a schema, or refuses. */
const parseAndValidate = <T>(options: {
  bytes: Uint8Array;
  key: string;
  schema: TSchema;
  code: LegacyBootstrapFailureCode;
  label: string;
}): { ok: true; value: T } | Refusal => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(options.bytes));
  } catch (error) {
    return {
      ok: false,
      code: options.code,
      reason: `${options.key} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!Value.Check(options.schema, parsed)) {
    const first = [...Value.Errors(options.schema, parsed)][0];
    return {
      ok: false,
      code: options.code,
      reason:
        `${options.key} failed ${options.label} validation` +
        (first ? ` (${first.instancePath || '/'}: ${first.message})` : ''),
    };
  }
  return { ok: true, value: parsed as T };
};

/** Every entry the legacy root's shards carry, or a refusal naming the shard. */
const readLegacyShards = async (options: {
  reader: ReleaseDocumentReader;
  categories: readonly { id: string; count: number }[];
}): Promise<{ ok: true; entries: CatalogAssetEntry[] } | Refusal> => {
  const entries: CatalogAssetEntry[] = [];

  for (const category of options.categories) {
    const key = legacyShardKey(category.id);
    const read = await readLegacyObject({
      reader: options.reader,
      key,
      code: 'legacy-shard-unreadable',
    });
    if (!read.ok) {
      return read;
    }
    if (!read.bytes) {
      return {
        ok: false,
        code: 'legacy-shard-unreadable',
        reason:
          `${LEGACY_ROOT_KEY} declares category ${JSON.stringify(category.id)} ` +
          `(${category.count} entries) but ${key} is absent. Migrating without it would ` +
          'drop that category.',
      };
    }
    const parsed = parseAndValidate<{ entries?: CatalogAssetEntry[] }>({
      bytes: read.bytes,
      key,
      schema: CatalogIndexShardSchema,
      code: 'legacy-shard-invalid',
      label: 'CatalogIndexShardSchema',
    });
    if (!parsed.ok) {
      return parsed;
    }
    const shardEntries = parsed.value.entries ?? [];
    if (shardEntries.length !== category.count) {
      return {
        ok: false,
        code: 'legacy-shard-count-mismatch',
        reason:
          `${key} holds ${shardEntries.length} entries but ${LEGACY_ROOT_KEY} declares ` +
          `${category.count}. The legacy catalog is internally inconsistent; refusing to ` +
          'migrate a partial category.',
      };
    }
    entries.push(...shardEntries);
  }

  return { ok: true, entries };
};

/**
 * Tags the legacy index and the legacy seed disagree about.
 *
 * The two surfaces describe the same assets. If they disagree about a tag's
 * bytes, the legacy state has no single answer and picking one would be a guess
 * about which bytes an existing installation resolves.
 */
const findIdentityConflicts = (
  entries: readonly CatalogAssetEntry[],
  seed: CompactSeedDocument,
): string[] => {
  const seedByTag = new Map(seed.r.map((row) => [row.t, row]));
  const conflicts: string[] = [];
  for (const entry of entries) {
    const row = seedByTag.get(entry.tag);
    if (!row) {
      conflicts.push(`${entry.tag}: index=${entry.hash.slice(0, 12)}… seed=missing`);
    } else if (row.h !== entry.hash) {
      conflicts.push(`${entry.tag}: index=${entry.hash.slice(0, 12)}… seed=${row.h.slice(0, 12)}…`);
    }
  }
  return conflicts;
};

/** The optional legacy objects, with the schema each must satisfy. */
const OPTIONAL_LEGACY_OBJECTS = [
  [LEGACY_OFFLINE_CORE_KEY, OfflineCoreDeclarationSchema, 'offline-core declaration'],
  [LEGACY_PACK_LOCK_KEY, InstalledPackLockSchema, 'installed pack lock'],
] as const;

/**
 * Reads one optional legacy object.
 *
 * Absent is fine (it is optional). Unreadable, unparseable or schema-invalid is
 * a REJECTION with a reason — never a silent skip, and never used anyway.
 */
const readOptionalLegacyObject = async (options: {
  reader: ReleaseDocumentReader;
  key: string;
  schema: TSchema | undefined;
  label: string;
}): Promise<{ ok: true; bytes: Uint8Array | undefined } | { ok: false; reason: string }> => {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await options.reader(options.key);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!bytes) {
    return { ok: true, bytes: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return {
      ok: false,
      reason: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (options.schema && !Value.Check(options.schema, parsed)) {
    return { ok: false, reason: `failed ${options.label} schema validation` };
  }
  return { ok: true, bytes };
};

/** Optional legacy objects. A malformed one is rejected and named, never used. */
const readOptionalLegacyObjects = async (
  reader: ReleaseDocumentReader,
): Promise<{
  dependencies: Map<string, Uint8Array>;
  rejected: { key: string; reason: string }[];
}> => {
  const dependencies = new Map<string, Uint8Array>();
  const rejected: { key: string; reason: string }[] = [];

  for (const [key, schema, label] of OPTIONAL_LEGACY_OBJECTS) {
    const result = await readOptionalLegacyObject({ reader, key, schema, label });
    if (!result.ok) {
      rejected.push({ key, reason: result.reason });
      continue;
    }
    if (result.bytes) {
      dependencies.set(key, result.bytes);
    }
  }

  return { dependencies, rejected };
};

/**
 * The legacy boot seed — the complete asset inventory.
 *
 * Absent is a REFUSAL, not a skip: the seed is what tells a client which assets
 * exist, and migrating without it would publish a release whose clients cannot
 * resolve most of the catalog.
 */
const readLegacySeed = async (
  reader: ReleaseDocumentReader,
): Promise<{ ok: true; seed: CompactSeedDocument; bytes: Uint8Array } | Refusal> => {
  const read = await readLegacyObject({
    reader,
    key: LEGACY_SEED_KEY,
    code: 'legacy-seed-unreadable',
  });
  if (!read.ok) {
    return read;
  }
  if (!read.bytes) {
    return {
      ok: false,
      code: 'legacy-seed-unreadable',
      reason:
        `${LEGACY_ROOT_KEY} exists but ${LEGACY_SEED_KEY} is absent. The boot seed is the ` +
        'complete asset inventory; migrating without it would publish a release whose ' +
        'clients cannot resolve most of the catalog.',
    };
  }
  try {
    return { ok: true, seed: parseCompactSeed(read.bytes, LEGACY_SEED_KEY), bytes: read.bytes };
  } catch (error) {
    return {
      ok: false,
      code: 'legacy-seed-invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * The legacy root index, or `undefined` when the origin has no legacy catalog.
 *
 * Absent is NOT a failure: an origin that never published the mutable surface
 * simply has nothing to migrate.
 */
const readLegacyRoot = async (
  reader: ReleaseDocumentReader,
): Promise<
  { ok: true; root: { categories: { id: string; count: number }[] } | undefined } | Refusal
> => {
  const read = await readLegacyObject({
    reader,
    key: LEGACY_ROOT_KEY,
    code: 'legacy-root-unreadable',
  });
  if (!read.ok) {
    return read;
  }
  if (!read.bytes) {
    return { ok: true, root: undefined };
  }
  const parsed = parseAndValidate<{ categories: { id: string; count: number }[] }>({
    bytes: read.bytes,
    key: LEGACY_ROOT_KEY,
    schema: CatalogIndexRootSchema,
    code: 'legacy-root-invalid',
    label: 'CatalogIndexRootSchema',
  });
  return parsed.ok ? { ok: true, root: parsed.value } : parsed;
};

/** A refusal when the legacy index and the legacy seed disagree about a tag. */
const refuseOnIdentityConflicts = (
  entries: readonly CatalogAssetEntry[],
  seed: CompactSeedDocument,
): Refusal | undefined => {
  const conflicts = findIdentityConflicts(entries, seed);
  if (conflicts.length === 0) {
    return undefined;
  }
  return {
    ok: false,
    code: 'legacy-identity-conflict',
    reason:
      `the legacy index and the legacy boot seed disagree about ${conflicts.length} tag(s): ` +
      `${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? ', …' : ''}. ` +
      'There is no correct choice between them, so the migration refuses.',
  };
};

/** Assembles the migration plan from validated legacy objects. */
const assemblePlan = (options: {
  entries: CatalogAssetEntry[];
  seed: CompactSeedDocument;
  seedBytes: Uint8Array;
  optional: { dependencies: Map<string, Uint8Array>; rejected: { key: string; reason: string }[] };
  currentTags: ReadonlySet<string>;
}): LegacyBootstrapPlan => {
  const dependencies = new Map<string, Uint8Array>([[LEGACY_SEED_KEY, options.seedBytes]]);
  for (const [key, bytes] of options.optional.dependencies) {
    dependencies.set(key, bytes);
  }
  const isCarried = (tag: string): boolean => !options.currentTags.has(tag);
  return {
    entries: options.entries,
    dependencies,
    carriedTags: options.entries.filter((entry) => isCarried(entry.tag)).map((e) => e.tag),
    replacedTags: options.entries.filter((entry) => !isCarried(entry.tag)).map((e) => e.tag),
    carriedSeedRows: options.seed.r.filter((row) => isCarried(row.t)).length,
    rejected: options.optional.rejected,
  };
};

/**
 * Reads the legacy mutable catalog and converts it into the immutable
 * pipeline's inputs.
 *
 * PURE with respect to the target: it only ever GETs. There is no dry-run flag
 * because there is nothing to dry-run — the caller decides whether to use the
 * result, and the release `--plan` path uses it exactly as `--apply` does so
 * the two compute the same root.
 *
 * @param options.originUrl - The VALIDATED target origin. Callers must have run
 *   the release-target gate first; this module never resolves a target itself.
 * @param options.reader - Document reader. Injectable so no test touches a real
 *   bucket.
 * @param options.currentTags - Tags the current candidate produces. Used only
 *   to classify carried vs replaced; it never changes what is carried.
 */
export const bootstrapLegacyCatalog = async (options: {
  originUrl: string;
  reader?: ReleaseDocumentReader;
  currentTags?: ReadonlySet<string>;
}): Promise<LegacyBootstrapOutcome> => {
  const reader = options.reader ?? httpReleaseReader({ originUrl: options.originUrl });
  const currentTags = options.currentTags ?? new Set<string>();

  // 1. The legacy root. Absent means there is nothing to migrate.
  const rootRead = await readLegacyRoot(reader);
  if (!rootRead.ok) {
    return rootRead;
  }
  if (!rootRead.root) {
    return {
      ok: true,
      applied: false,
      reason: `${LEGACY_ROOT_KEY} is absent — this origin has no legacy mutable catalog to migrate.`,
    };
  }

  // 2. Every shard the root declares. A missing one is a refusal.
  const shards = await readLegacyShards({ reader, categories: rootRead.root.categories });
  if (!shards.ok) {
    return shards;
  }

  // 3. The legacy boot seed — the complete inventory.
  const seedRead = await readLegacySeed(reader);
  if (!seedRead.ok) {
    return seedRead;
  }
  const { seed, bytes: seedBytes } = seedRead;

  // 4. Identity conflicts, before anything is carried.
  const conflict = refuseOnIdentityConflicts(shards.entries, seed);
  if (conflict) {
    return conflict;
  }

  // 5. Optional legacy objects.
  const optional = await readOptionalLegacyObjects(reader);

  return {
    ok: true,
    applied: true,
    plan: assemblePlan({
      entries: shards.entries,
      seed,
      seedBytes,
      optional,
      currentTags,
    }),
  };
};

/** One-line-per-fact summary of a migration plan, for a plan/dry-run print. */
export const describeLegacyBootstrap = (plan: LegacyBootstrapPlan): string =>
  [
    `legacy entries:   ${plan.entries.length} (${plan.carriedTags.length} carried, ${plan.replacedTags.length} replaced by this candidate)`,
    `legacy seed rows: ${plan.carriedSeedRows} carried forward`,
    `legacy objects:   ${[...plan.dependencies.keys()].join(', ')}`,
    ...(plan.rejected.length > 0
      ? [`rejected:         ${plan.rejected.map((r) => `${r.key} (${r.reason})`).join('; ')}`]
      : []),
  ].join('\n');
