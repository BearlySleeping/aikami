// scripts/src/lib/catalog/carried_set.ts
//
// What a release CARRIES: the verified previous release, or — on a first
// production release — the legacy mutable catalog.
//
// ── Why this is one decision, in one place ─────────────────────────────────
//
// Two phases depend on the carried set: the seed phase carries forward a
// required dependency the checkout no longer holds, and the index phase unions
// the entries the live catalog already carries. This repo no longer holds the
// complete asset library (C-435 de-bundled it), so rebuilding from the local
// scan roots alone would replace the published catalog with the few dozen tags
// this checkout carries.
//
// Resolution is hash-verified through `resolveReleaseGraph` — the same resolver
// the production client boot path uses. A corrupt pointer or any integrity
// mismatch is a REFUSAL: treating an unverifiable previous release as "absent"
// would turn corruption into silent data loss.
//
// It runs BEFORE the first upload, because a refusal must not leave a partial
// release behind — and the first-release migration can refuse.

import type { CatalogAssetEntry, ReleaseDocumentReader } from '@aikami/schemas';
import {
  bootstrapLegacyCatalog,
  describeLegacyBootstrap,
  type LegacyBootstrapPlan,
} from './legacy_bootstrap.ts';
import { type PreviousRelease, resolvePreviousRelease } from './published_catalog.ts';

export type CarriedSet = {
  /** The verified previous release, when one exists. */
  previousRelease: PreviousRelease | undefined;
  /** Entries the new release carries forward. */
  carriedEntries: readonly CatalogAssetEntry[];
  /** Verified dependency bytes, keyed by catalog key. */
  carriedDependencies: ReadonlyMap<string, Uint8Array> | undefined;
  /** The first-release migration, when one ran. */
  legacy: LegacyBootstrapPlan | undefined;
};

export type CarriedSetOutcome =
  | { ok: true; value: CarriedSet }
  | { ok: false; code: string; reason: string };

/**
 * Merges the verified previous release with the legacy library a migration
 * carried. The legacy library is authoritative for the tags it declares; the
 * previous release only supplies dependency bytes the legacy plan lacks.
 */
const mergeCarriedValue = (options: {
  previousRelease: PreviousRelease | undefined;
  bootstrap: LegacyBootstrapPlan;
}): CarriedSet => {
  const byTag = new Map<string, CatalogAssetEntry>();
  for (const entry of options.previousRelease?.entries ?? []) {
    byTag.set(entry.tag, entry);
  }
  for (const entry of options.bootstrap.entries) {
    byTag.set(entry.tag, entry);
  }
  const carriedDependencies = new Map<string, Uint8Array>(options.bootstrap.dependencies);
  for (const [key, bytes] of options.previousRelease?.dependencies ?? []) {
    if (!carriedDependencies.has(key)) {
      carriedDependencies.set(key, bytes);
    }
  }
  return {
    previousRelease: options.previousRelease,
    carriedEntries: [...byTag.values()],
    carriedDependencies,
    legacy: options.bootstrap,
  };
};

/**
 * Resolves the carried set for one target.
 *
 * @param options.mode - The target's mode. The legacy migration is
 *   production-only; staging has no legacy surface to migrate.
 * @param options.currentTags - Tags the candidate produces, used only to
 *   classify carried vs replaced in the migration report.
 * @param options.reader - Document reader. Injectable so tests never hit a
 *   bucket.
 * @param options.log - Progress sink. Defaults to silence.
 */
export const resolveCarriedSet = async (options: {
  originUrl: string;
  mode: string | undefined;
  currentTags: ReadonlySet<string>;
  reader?: ReleaseDocumentReader;
  log?: (line: string) => void;
  /**
   * Origin that hosts the de-bundled LEGACY library when it is NOT the release
   * target (staging points at production). When set, that library is carried
   * into EVERY release of the mode and UNIONed with any previous release: the
   * LPC library is repo-external (C-435), and a client that renders characters
   * needs it present, not only on the target's very first release.
   */
  legacyOriginUrl?: string;
}): Promise<CarriedSetOutcome> => {
  const log = options.log ?? (() => {});
  const readerOption = options.reader === undefined ? {} : { reader: options.reader };

  const previousRelease = await resolvePreviousRelease({
    originUrl: options.originUrl,
    ...readerOption,
  });
  if (previousRelease) {
    log(
      `  🔗 previous release: ${previousRelease.releaseId} (${previousRelease.entries.length} verified entr(ies))`,
    );
  } else {
    log('  🔗 previous release: none published at this origin');
  }

  const carryForward = (): { ok: true; value: CarriedSet } => ({
    ok: true,
    value: previousRelease
      ? {
          previousRelease,
          carriedEntries: previousRelease.entries,
          carriedDependencies: previousRelease.dependencies,
          legacy: undefined,
        }
      : {
          previousRelease: undefined,
          carriedEntries: [],
          carriedDependencies: undefined,
          legacy: undefined,
        },
  });

  // Carry the legacy library when the target hosts no legacy surface of its own
  // (`legacyOriginUrl`, i.e. staging) OR on a first production release (the
  // mutable legacy catalog is live at the target origin).
  const bootstrapLegacy =
    options.legacyOriginUrl !== undefined ||
    (previousRelease === undefined && options.mode === 'production');
  if (!bootstrapLegacy) {
    return carryForward();
  }

  const bootstrap = await bootstrapLegacyCatalog({
    originUrl: options.legacyOriginUrl ?? options.originUrl,
    currentTags: options.currentTags,
    ...readerOption,
  });
  if (!bootstrap.ok) {
    return { ok: false, code: bootstrap.code, reason: bootstrap.reason };
  }
  if (!bootstrap.applied) {
    log(`  🧳 legacy library carry: ${bootstrap.reason}`);
    return carryForward();
  }

  log('  🧳 carrying the de-bundled legacy library:');
  for (const line of describeLegacyBootstrap(bootstrap.plan).split('\n')) {
    log(`     ${line}`);
  }

  return {
    ok: true,
    value: mergeCarriedValue({ previousRelease, bootstrap: bootstrap.plan }),
  };
};
