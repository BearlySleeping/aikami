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
    return {
      ok: true,
      value: {
        previousRelease,
        carriedEntries: previousRelease.entries,
        carriedDependencies: previousRelease.dependencies,
        legacy: undefined,
      },
    };
  }

  log('  🔗 previous release: none published at this origin');

  // No release pointer means this origin has never published an immutable
  // release. For production that is not the same as "nothing to carry": the
  // legacy mutable catalog and its 12,729-row boot seed are live and are what
  // existing installations resolve.
  //
  // Once a verified release exists, the branch above answers and this is never
  // reached — the ordinary carry-forward path takes over.
  if (options.mode !== 'production') {
    return {
      ok: true,
      value: {
        previousRelease: undefined,
        carriedEntries: [],
        carriedDependencies: undefined,
        legacy: undefined,
      },
    };
  }

  const bootstrap = await bootstrapLegacyCatalog({
    originUrl: options.originUrl,
    currentTags: options.currentTags,
    ...readerOption,
  });
  if (!bootstrap.ok) {
    return { ok: false, code: bootstrap.code, reason: bootstrap.reason };
  }
  if (!bootstrap.applied) {
    log(`  🧳 first-release migration: ${bootstrap.reason}`);
    return {
      ok: true,
      value: {
        previousRelease: undefined,
        carriedEntries: [],
        carriedDependencies: undefined,
        legacy: undefined,
      },
    };
  }

  log('  🧳 first-release migration from the legacy mutable catalog:');
  for (const line of describeLegacyBootstrap(bootstrap.plan).split('\n')) {
    log(`     ${line}`);
  }
  return {
    ok: true,
    value: {
      previousRelease: undefined,
      carriedEntries: bootstrap.plan.entries,
      carriedDependencies: bootstrap.plan.dependencies,
      legacy: bootstrap.plan,
    },
  };
};
