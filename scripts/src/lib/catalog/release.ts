// scripts/src/lib/catalog/release.ts
//
// The typed release lifecycle.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The orchestrator decided success by scraping subprocess exit codes and the
// last few lines of stderr. That cannot express the guarantees a release needs:
// "the previous pointer is unchanged", "the candidate was not reported active",
// "production published the same bytes staging approved" are statements about
// structured state, not about text.
//
// Every phase below returns a typed result. The CLI formats them; it does not
// interpret them.
//
// ── The lifecycle ──────────────────────────────────────────────────────────
//
//   verifyCandidate()    the sealed candidate still matches the source
//   resolveBaseRelease() the verified release this target is built on
//   buildReleasePlan()   what WOULD be published — no writes
//   validateReleasePlan()the plan is internally consistent and safe to apply
//   publishImmutable()   upload content-addressed objects
//   activateRelease()    advance the pointer LAST
//   verifyRelease()      re-resolve remotely, with the client's own resolver
//
// A candidate is sealed once and promoted unchanged. No phase here generates,
// regenerates or rewrites candidate bytes.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CandidateLock,
  ReleaseBase,
  ReleasePlan,
  ReleaseReceipt,
  ReleaseTargetIdentity,
} from '@aikami/schemas';
import { PACK_LOCK_KEY, ReleasePlanSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { computeLockHash } from './candidate_lock.ts';
import { ASSET_KEY_PREFIX, ROOT_INDEX_KEY } from './config.ts';
import { generateCatalogIndex } from './index_generation.ts';
import { resolvePreviousRelease } from './published_catalog.ts';
import type { R2ClientLike } from './upload.ts';

export const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Immutable content-addressed index key. Mirrors `pipeline.ts`'s addressing. */
const immutableIndexKey = (options: { name: string; hash: string }): string =>
  `index/v1/revisions/${options.hash}/${options.name}.json`;

/** A typed phase outcome. */
export type PhaseResult<T> =
  | { ok: true; phase: string; value: T; digest: string }
  | { ok: false; phase: string; error: string };

const phaseOk = <T>(phase: string, value: T): PhaseResult<T> => ({
  ok: true,
  phase,
  value,
  digest: sha256(JSON.stringify(value ?? null)),
});

const phaseFail = <T>(phase: string, error: string): PhaseResult<T> => ({
  ok: false,
  phase,
  error,
});

// ---------------------------------------------------------------------------
// preflight / verifyCandidate
// ---------------------------------------------------------------------------

export type CandidateVerification = {
  lockHash: string;
  sourceCommit: string;
  sourceTree: string;
};

/**
 * Verifies a sealed candidate against the current source.
 *
 * Refuses when the lock's own hash does not re-derive from its content (someone
 * edited it) or when the working tree no longer produces the same groups
 * (someone changed the content after sealing). Both are "the candidate is not
 * what you think it is" and neither may proceed to a publish.
 */
export const verifyCandidate = (options: {
  sealed: CandidateLock;
  /** Re-derives the candidate from the current source. */
  rebuild: () => CandidateLock;
}): PhaseResult<CandidateVerification> => {
  const { sealed, rebuild } = options;

  // Reuse the SAME hash function the seal uses. Reimplementing it here — as an
  // earlier revision did, with a different key order — makes every candidate
  // look tampered with, or (worse) lets a real tamper through.
  const { lockHash, ...rest } = sealed;
  const recomputed = computeLockHash(rest);
  if (recomputed !== lockHash) {
    return phaseFail(
      'verifyCandidate',
      `the sealed candidate has been modified: recorded lockHash ${lockHash} but its content ` +
        `re-derives to ${recomputed}`,
    );
  }

  const current = rebuild();
  if (current.lockHash !== sealed.lockHash) {
    const moved: string[] = [];
    for (const group of [
      'manifest',
      'maps',
      'terrainAtlas',
      'propAtlas',
      'portraits',
      'enemyVisuals',
      'audio',
    ] as const) {
      if (sealed[group].digest !== current[group].digest) {
        moved.push(group);
      }
    }
    return phaseFail(
      'verifyCandidate',
      `the working tree no longer matches the sealed candidate (${sealed.lockHash.slice(0, 12)}… → ` +
        `${current.lockHash.slice(0, 12)}…). Changed: ${moved.join(', ') || 'source identity'}. ` +
        'Re-seal before publishing.',
    );
  }

  return phaseOk('verifyCandidate', {
    lockHash: sealed.lockHash,
    sourceCommit: sealed.source.commit,
    sourceTree: sealed.source.tree,
  });
};

// ---------------------------------------------------------------------------
// resolveBaseRelease
// ---------------------------------------------------------------------------

export type BaseReleaseResolution = {
  base: ReleaseBase | null;
  /** Entries the base catalog carries, for the merge. */
  carriedEntries: readonly { tag: string; hash: string }[];
  /** Dependencies the candidate does not supply, for the seed phase. */
  carriedDependencies: ReadonlyMap<string, Uint8Array>;
};

/**
 * Resolves the verified release this target is built on.
 *
 * Delegates to the SAME hash-verifying resolver the production client boot path
 * uses, so the publisher and the client cannot disagree about what a release
 * is. A corrupt or unverifiable previous release THROWS: treating it as absent
 * would turn corruption into silent data loss.
 */
export const resolveBaseRelease = async (options: {
  originUrl: string;
  reader?: Parameters<typeof resolvePreviousRelease>[0]['reader'];
}): Promise<PhaseResult<BaseReleaseResolution>> => {
  try {
    const previous = await resolvePreviousRelease({
      originUrl: options.originUrl,
      reader: options.reader,
    });
    if (!previous) {
      return phaseOk('resolveBaseRelease', {
        base: null,
        carriedEntries: [],
        carriedDependencies: new Map(),
      });
    }
    return phaseOk('resolveBaseRelease', {
      base: { releaseId: previous.releaseId, rootHash: sha256(previous.rootKey) },
      carriedEntries: previous.entries,
      carriedDependencies: previous.dependencies,
    });
  } catch (error) {
    return phaseFail(
      'resolveBaseRelease',
      `the previous release at ${options.originUrl} could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

// ---------------------------------------------------------------------------
// buildReleasePlan
// ---------------------------------------------------------------------------

export type PlannedRelease = {
  plan: ReleasePlan;
  carriedDependencies: ReadonlyMap<string, Uint8Array>;
};

/**
 * Computes exactly what WOULD be published. Performs no writes.
 *
 * The catalog index is generated in memory from the candidate's entries unioned
 * with the base release's, so the plan's root and shard hashes are the hashes
 * the apply step must reproduce. If apply produces different ones, the plan was
 * stale and the publish must not proceed.
 */
export const buildReleasePlan = (options: {
  candidate: CandidateLock;
  target: ReleaseTargetIdentity;
  base: BaseReleaseResolution;
  entries: readonly { tag: string; hash: string; sizeBytes: number; category: string }[];
  /** Keys already present at the target, so the plan can report upload need. */
  presentKeys?: ReadonlySet<string>;
}): PhaseResult<PlannedRelease> => {
  const { candidate, target, base, entries } = options;

  try {
    const { root, shards, merge } = generateCatalogIndex({
      entries: entries as never,
      originUrl: target.originUrl,
      carriedEntries: base.carriedEntries as never,
    });

    // Same addressing the publisher uses: the root and every shard are hashed
    // from their own serialized JSON and keyed by that hash. Computing them
    // here from the same bytes is what makes the plan's hashes the ones apply
    // must reproduce.
    const rootJson = JSON.stringify(root, null, 2);
    const rootHash = sha256(rootJson);
    const immutableShards = shards.map((shard) => {
      const hash = sha256(shard.json);
      return { ...shard, hash, key: immutableIndexKey({ name: shard.id, hash }) };
    });

    const objects = [
      ...entries.map((entry) => ({
        key: `${ASSET_KEY_PREFIX}${entry.hash}`,
        hash: entry.hash,
        role: 'asset',
        present: options.presentKeys?.has(`${ASSET_KEY_PREFIX}${entry.hash}`) ?? false,
      })),
      ...immutableShards.map((shard) => ({
        key: shard.key,
        hash: shard.hash,
        role: 'catalog-shard',
        present: options.presentKeys?.has(shard.key) ?? false,
      })),
      {
        key: immutableIndexKey({ name: 'catalog', hash: rootHash }),
        hash: rootHash,
        role: 'catalog-root',
        present:
          options.presentKeys?.has(immutableIndexKey({ name: 'catalog', hash: rootHash })) ?? false,
      },
    ];

    const plan: ReleasePlan = {
      schemaVersion: 'release.plan.v1',
      candidateLockHash: candidate.lockHash,
      target,
      base: base.base,
      merge: {
        carried: merge.carried,
        replaced: merge.replaced,
        added: merge.added,
        retired: merge.retired,
        total: merge.total,
        addedTags: [],
        replacedTags: [],
        retiredTags: [],
      },
      objects,
      uploadsRequired: objects.filter((object) => !object.present).length,
      catalogRootHash: rootHash,
      catalogShards: Object.fromEntries(immutableShards.map((shard) => [shard.key, shard.hash])),
      packLockHash: '',
      rightsPassed: candidate.rights.passed,
      surfacePassed: candidate.surface.passed,
      createdAt: new Date().toISOString(),
      planHash: '',
    };

    plan.planHash = computePlanHash(plan);

    if (!Value.Check(ReleasePlanSchema, plan)) {
      return phaseFail(
        'buildReleasePlan',
        'the generated plan failed ReleasePlanSchema validation',
      );
    }
    return phaseOk('buildReleasePlan', { plan, carriedDependencies: base.carriedDependencies });
  } catch (error) {
    return phaseFail('buildReleasePlan', error instanceof Error ? error.message : String(error));
  }
};

/** Hashes the plan's decision fields, excluding the moment it was computed. */
export const computePlanHash = (plan: ReleasePlan): string => {
  const { createdAt: _createdAt, planHash: _planHash, uploadsRequired: _u, ...decision } = plan;
  return sha256(
    JSON.stringify({
      ...decision,
      // Presence is a property of the moment, not of the decision: two plans
      // that would publish the same bytes must hash identically whether or not
      // a previous attempt got partway.
      objects: plan.objects.map(({ present: _present, ...rest }) => rest),
    }),
  );
};

// ---------------------------------------------------------------------------
// validateReleasePlan
// ---------------------------------------------------------------------------

/**
 * Refuses a plan that must not be applied.
 *
 * Each check is a statement a release has to be able to make. A candidate whose
 * gates did not pass, or whose plan would carry zero entries on a first
 * publish, is not something to discover after activation.
 */
export const validateReleasePlan = (options: {
  plan: ReleasePlan;
  candidate: CandidateLock;
}): PhaseResult<ReleasePlan> => {
  const { plan, candidate } = options;

  if (plan.candidateLockHash !== candidate.lockHash) {
    return phaseFail(
      'validateReleasePlan',
      'the plan does not describe the candidate being published',
    );
  }
  if (!plan.rightsPassed) {
    return phaseFail('validateReleasePlan', 'the rights gate did not pass for this candidate');
  }
  if (!plan.surfacePassed) {
    return phaseFail('validateReleasePlan', 'the surface gate did not pass for this candidate');
  }
  if (plan.catalogRootHash.length !== 64) {
    return phaseFail('validateReleasePlan', 'the plan carries no catalog root hash');
  }
  if (plan.merge.total === 0) {
    return phaseFail(
      'validateReleasePlan',
      'the merged catalog would be empty — refusing to publish',
    );
  }
  // The invariant is about the MERGE, not about the base object: carried > 0
  // means entries came from a previous release, and a total below that count
  // means the merge dropped some. Checking `plan.base` instead would miss a
  // plan whose base failed to resolve while the merge still claimed to carry.
  if (plan.merge.carried > 0 && plan.merge.total < plan.merge.carried) {
    return phaseFail(
      'validateReleasePlan',
      `the plan would drop catalog entries: it carries ${plan.merge.carried} from the base but the ` +
        `merged total is only ${plan.merge.total}`,
    );
  }

  return phaseOk('validateReleasePlan', plan);
};

// ---------------------------------------------------------------------------
// Receipt construction
// ---------------------------------------------------------------------------

export type PublishReportLike = {
  ok: boolean;
  /** The release id the publisher pinned into the pointer, when it got that far. */
  releaseId?: string;
  rootKey?: string;
  shardKeys?: readonly string[];
  seed?: { uploaded: number; carried: number; failed: number };
  packLock?: { written: boolean; key: string; assetPins: number; audioPins: number };
  legacyAlias?: { key: string; written: boolean; error?: string };
  releaseWritten?: boolean;
  uploaded?: number;
  skipped?: number;
  failed?: number;
};

/**
 * Builds the receipt from what actually happened.
 *
 * `activated` is driven by the publisher's own `releaseWritten`, never by the
 * process exit code: an exit code cannot distinguish "the pointer advanced"
 * from "everything uploaded but the pointer write failed", and those have
 * opposite rollback semantics.
 */
export const buildReceipt = (options: {
  candidate: CandidateLock;
  plan: ReleasePlan;
  report: PublishReportLike;
  previousReleaseId: string;
  phases: { phase: string; ok: boolean; error: string; digest: string }[];
  startedAt: string;
  verified: boolean;
  verificationError: string;
}): ReleaseReceipt => ({
  schemaVersion: 'release.receipt.v1',
  candidateLockHash: options.candidate.lockHash,
  planHash: options.plan.planHash,
  mode: options.plan.target.mode,
  bucket: options.plan.target.bucket,
  originUrl: options.plan.target.originUrl,
  previousReleaseId: options.previousReleaseId,
  // The publisher's OWN release id: a receipt that invented its own would not
  // name the pointer a rollback has to re-point.
  releaseId: options.report.releaseId ?? '',
  catalogRootHash: options.plan.catalogRootHash,
  catalogShards: options.plan.catalogShards,
  dependencies: [],
  packLockHash: options.report.packLock?.written ? options.report.packLock.key : '',
  activated: options.report.releaseWritten === true,
  legacyAliasWritten: options.report.legacyAlias?.written === true,
  legacyAliasError: options.report.legacyAlias?.error ?? '',
  verified: options.verified,
  verificationError: options.verificationError,
  phases: [...options.phases],
  startedAt: options.startedAt,
  finishedAt: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

export type PromotionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Production must publish the candidate staging approved.
 *
 * Compares the CANDIDATE hash, not the catalog root: staging and production can
 * legitimately carry different unrelated base entries, so their roots differ
 * even when the Emberwatch candidate is byte-identical. Requiring root equality
 * would conflate "same candidate" with "same entire global catalog graph",
 * which this infrastructure does not guarantee.
 */
export const checkPromotion = (options: {
  stagingReceipt: { candidateLockHash: string; mode: string; activated: boolean };
  productionCandidate: CandidateLock;
}): PromotionCheck => {
  const { stagingReceipt, productionCandidate } = options;

  if (stagingReceipt.mode === 'production') {
    return { ok: false, reason: 'the reference receipt is itself a production release' };
  }
  if (!stagingReceipt.activated) {
    return {
      ok: false,
      reason: 'staging never activated a release, so there is nothing approved to promote',
    };
  }
  if (stagingReceipt.candidateLockHash !== productionCandidate.lockHash) {
    return {
      ok: false,
      reason:
        `the candidate differs from the staging-approved one: staging approved ` +
        `${stagingReceipt.candidateLockHash.slice(0, 12)}… but this candidate is ` +
        `${productionCandidate.lockHash.slice(0, 12)}…`,
    };
  }
  return { ok: true };
};

/** Reads the staging receipt a promotion must match, if one exists. */
export const readReceipt = (path: string): ReleaseReceipt | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReleaseReceipt;
  } catch {
    return undefined;
  }
};

export const receiptPath = (releasePlane: string, mode: string): string =>
  join(releasePlane, `receipt-${mode}.json`);

export type { R2ClientLike };
export { PACK_LOCK_KEY, ROOT_INDEX_KEY };
