// scripts/src/lib/ops/emberwatch_release_phases.ts
//
// The typed phases of an Emberwatch release, and the formatting of their
// outcomes.
//
// `emberwatch_release.ts` is the CLI shell: it parses an invocation, prints,
// and decides exit codes. Every release decision lives here, expressed against
// the typed release APIs in `catalog/release.ts` — a phase returns a result,
// never an exit code, and never a parsed line of subprocess output.
//
// The one subprocess left is the INDEPENDENT validation suite (`bun moon ci`),
// which is a separate authority by design.

import type { ReleaseDocumentReader } from '@aikami/schemas';
import { ReleasePointerSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { loadCatalogEntries } from '../catalog/catalog_entries.ts';
import { bootstrapLegacyCatalog } from '../catalog/legacy_bootstrap.ts';
import { resolvePreviousRelease } from '../catalog/published_catalog.ts';
import type {
  BaseReleaseResolution,
  CandidateVerification,
  PhaseResult,
  PlannedRelease,
} from '../catalog/release.ts';
import {
  buildReleasePlan,
  resolveBaseRelease,
  validateReleasePlan,
  verifyCandidate,
} from '../catalog/release.ts';
import type { ReleaseTarget } from '../catalog/release_target.ts';
import { legacyLibraryOriginFor } from '../catalog/release_target.ts';
import { buildCandidateLock, loadSealedCandidate } from './emberwatch_candidate.ts';
import type { ReleasePointer, StepRecorder } from './emberwatch_release_io.ts';
import { readReleasePointer } from './emberwatch_release_io.ts';

/**
 * `verifyCandidate` against the sealed lock, in process.
 *
 * The sealed candidate is what a publish ships; if the working tree no longer
 * produces it, publishing would ship bytes nobody reviewed.
 */
export const verifySealedCandidatePhase = (): PhaseResult<CandidateVerification> => {
  try {
    const sealed = loadSealedCandidate();
    return verifyCandidate({ sealed, rebuild: () => buildCandidateLock().lock });
  } catch (error) {
    return {
      ok: false,
      phase: 'verifyCandidate',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export type PlanPhases = {
  candidate: CandidateVerification;
  base: BaseReleaseResolution;
  plan: PlannedRelease['plan'];
  phases: PhaseResult<unknown>[];
};

/**
 * A first production release migrates the legacy mutable catalog.
 *
 * The PLAN has to see that too: if only the publisher carried the legacy
 * entries, the plan's root would describe a truncated catalog and apply would
 * write a different one — the exact "plan and apply disagree" failure the plan
 * exists to make impossible.
 */
const applyFirstReleaseMigration = async (options: {
  mode: string;
  releaseTarget: ReleaseTarget;
  base: BaseReleaseResolution;
  currentTags: ReadonlySet<string>;
  reader?: ReleaseDocumentReader;
  /** Canonical origin of the de-bundled legacy library when it is not the target (staging). */
  legacyOriginUrl?: string;
}): Promise<
  { ok: true; base: BaseReleaseResolution } | { ok: false; phase: string; error: string }
> => {
  const bootstrapLegacy =
    options.legacyOriginUrl !== undefined ||
    (options.base.base === null && options.mode === 'production');
  if (!bootstrapLegacy) {
    return { ok: true, base: options.base };
  }
  const bootstrap = await bootstrapLegacyCatalog({
    originUrl: options.legacyOriginUrl ?? options.releaseTarget.originUrl,
    ...(options.reader === undefined ? {} : { reader: options.reader }),
    currentTags: options.currentTags,
  });
  if (!bootstrap.ok) {
    return { ok: false, phase: 'legacyBootstrap', error: `${bootstrap.code}: ${bootstrap.reason}` };
  }
  if (!bootstrap.applied) {
    return { ok: true, base: options.base };
  }
  // Union by tag, legacy authoritative for the tags it declares. Mirrors
  // `resolveCarriedSet` so the plan's index root equals what apply publishes.
  const byTag = new Map(options.base.carriedEntries.map((entry) => [entry.tag, entry]));
  for (const entry of bootstrap.plan.entries) {
    byTag.set(entry.tag, entry);
  }
  return { ok: true, base: { ...options.base, carriedEntries: [...byTag.values()] } };
};

/**
 * Resolves the base release and computes the plan. Performs NO writes.
 *
 * The plan's root and shard hashes are computed from the same bytes the publish
 * step will produce, which is what makes "apply produced a different root than
 * the plan" a detectable failure instead of an invisible one.
 */
export const buildPlanPhases = async (options: {
  mode: string;
  releaseTarget: ReleaseTarget;
  candidatePhase: PhaseResult<CandidateVerification>;
  /** Reader for the target's release graph. Injectable so tests need no network. */
  reader?: ReleaseDocumentReader;
}): Promise<{ ok: true; value: PlanPhases } | { ok: false; phase: string; error: string }> => {
  const candidatePhase = options.candidatePhase;
  if (!candidatePhase.ok) {
    return candidatePhase;
  }
  const sealed = loadSealedCandidate();

  const basePhase = await resolveBaseRelease({
    originUrl: options.releaseTarget.originUrl,
    ...(options.reader === undefined ? {} : { reader: options.reader }),
  });
  if (!basePhase.ok) {
    return basePhase;
  }

  let entries: ReturnType<typeof loadCatalogEntries>;
  try {
    entries = loadCatalogEntries({});
  } catch (error) {
    return {
      ok: false,
      phase: 'loadCatalogEntries',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // A first production release migrates the legacy mutable catalog.
  const migrated = await applyFirstReleaseMigration({
    mode: options.mode,
    releaseTarget: options.releaseTarget,
    base: basePhase.value,
    currentTags: new Set(entries.map((entry) => entry.tag)),
    ...(options.reader === undefined ? {} : { reader: options.reader }),
    ...(() => {
      const legacyOriginUrl = legacyLibraryOriginFor(options.mode);
      return legacyOriginUrl === undefined ? {} : { legacyOriginUrl };
    })(),
  });
  if (!migrated.ok) {
    return migrated;
  }

  const planPhase = buildReleasePlan({
    candidate: sealed,
    target: {
      mode: options.mode,
      bucket: options.releaseTarget.bucket,
      originUrl: options.releaseTarget.originUrl,
    },
    base: migrated.base,
    // Pass the FULL catalog entries: `generateCatalogIndex` projects every
    // entry through `entryToShardEntry`, which spreads `licenses`, `authors`
    // and `sourceUrls` and reads `ext`/`subcategory`. Stripping the entries to
    // the four merge fields made `--plan` throw before it could build, so no
    // release could ever be planned.
    entries,
  });
  if (!planPhase.ok) {
    return planPhase;
  }

  const validatePhase = validateReleasePlan({ plan: planPhase.value.plan, candidate: sealed });
  if (!validatePhase.ok) {
    return validatePhase;
  }

  return {
    ok: true,
    value: {
      candidate: candidatePhase.value,
      base: basePhase.value,
      plan: planPhase.value.plan,
      phases: [candidatePhase, basePhase, planPhase, validatePhase],
    },
  };
};

export const toReceiptPhase = (
  result: PhaseResult<unknown>,
): { phase: string; ok: boolean; error: string; digest: string } =>
  result.ok
    ? { phase: result.phase, ok: true, error: '', digest: result.digest }
    : { phase: result.phase, ok: false, error: result.error, digest: '' };

/** Prints the plan's decision facts, so `--plan` is useful without applying. */
export const printPlanFacts = (phases: PlanPhases): void => {
  console.log('');
  console.log(`  candidate lock: ${phases.candidate.lockHash}`);
  console.log(`  base release:   ${phases.base.base?.releaseId ?? 'none (first publish)'}`);
  console.log(
    `  catalog root:   ${phases.plan.catalogRootHash.slice(0, 12)}… (${phases.plan.objects.length} object(s), ${phases.plan.uploadsRequired} to upload)`,
  );
  console.log(
    `  merge:          ${phases.plan.merge.carried} carried, ${phases.plan.merge.replaced} replaced, ${phases.plan.merge.added} added, ${phases.plan.merge.total} total`,
  );
};

/** The independent validation suite. A separate authority by design. */
export const assertValidationPasses = (io: StepRecorder, skipTests: boolean): void => {
  if (skipTests) {
    io.skipped('validate (moon affected)', '(skipped)');
    return;
  }
  const validate = io.run('validate (moon affected)', 'bun', ['moon', 'ci', '--base=origin/main']);
  if (validate.status === 'failed') {
    console.error('❌ validation failed — refusing to publish.');
    process.exit(1);
  }
};

/**
 * The distinguishable states a post-publish verification can be in.
 *
 * These are not variations on "pass/fail". Each one has a different remedy,
 * and collapsing them is how a retry gets mistaken for a failure and a stale
 * pointer gets mistaken for a success.
 */
export const PUBLICATION_VERIFICATION_OUTCOMES = [
  /** The pointer now names the planned root, and it did not before this run. */
  'newly-activated',
  /** The pointer already named the planned root before this run. A verified no-op. */
  'already-active',
  /** No release pointer is published at the origin. */
  'never-activated',
  /** A pointer is published, but it names a different root than the plan pinned. */
  'wrong-root-active',
  /** The pointer names the planned root, but the graph behind it does not verify. */
  'active-graph-invalid',
  /** The immutable release is active and valid; the mutable alias did not move. */
  'alias-degraded',
  /** The origin could not be read at all. */
  'remote-verification-failure',
] as const;

export type PublicationVerificationOutcome = (typeof PUBLICATION_VERIFICATION_OUTCOMES)[number];

export type PublicationVerification = {
  outcome: PublicationVerificationOutcome;
  /** True when the release the plan pinned is active and its graph verifies. */
  verified: boolean;
  after: ReleasePointer;
  verificationError: string;
  /** The root the pointer named BEFORE this run, when it named one. */
  previousRootHash: string | undefined;
};

/** The root hash a pointer body names, when it names one. */
const rootHashOf = (pointer: ReleasePointer): string | undefined => {
  const body = pointer.body as { rootHash?: unknown } | undefined;
  return typeof body?.rootHash === 'string' ? body.rootHash : undefined;
};

/**
 * Re-resolves the whole release graph and confirms it names the planned root.
 *
 * A matching root is necessary but not sufficient: the pointer could name the
 * right root while a shard or a pinned dependency is missing or corrupt. This
 * goes through the client's own hash-verifying resolver, so "verified" means
 * the same thing here as it does at boot.
 */
const assertActiveGraphValid = async (options: {
  originUrl: string;
  plannedRootHash: string;
  reader?: ReleaseDocumentReader;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  try {
    const graph = await resolvePreviousRelease({
      originUrl: options.originUrl,
      ...(options.reader === undefined ? {} : { reader: options.reader }),
    });
    if (!graph) {
      return {
        ok: false,
        reason: `the pointer at ${options.originUrl} names the planned root but no release graph resolves.`,
      };
    }
    if (graph.rootHash !== options.plannedRootHash) {
      return {
        ok: false,
        reason:
          `the resolved release graph names root ${graph.rootHash.slice(0, 12)}… but the plan ` +
          `pinned ${options.plannedRootHash.slice(0, 12)}…`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        `the active release at ${options.originUrl} failed graph verification: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Reads the published pointer and validates it, or classifies why it cannot be
 * used.
 *
 * A transport failure, an absent pointer and a malformed pointer are three
 * different states with three different remedies, and none of them is "the
 * release is fine".
 */
const readPublishedPointer = async (options: {
  originUrl: string;
  readPointer: (originUrl: string) => Promise<ReleasePointer>;
}): Promise<
  | { ok: true; after: ReleasePointer; pointer: { rootHash: string } }
  | { ok: false; after: ReleasePointer; outcome: PublicationVerificationOutcome; reason: string }
> => {
  const after = await options.readPointer(options.originUrl);

  if (after.status !== 200 && after.status !== 404 && after.status !== 410) {
    return {
      ok: false,
      after,
      outcome: 'remote-verification-failure',
      reason:
        `the release pointer at ${options.originUrl} could not be read (HTTP ${after.status}): ` +
        `${(after.body as { error?: string } | undefined)?.error ?? 'unreadable pointer'}`,
    };
  }
  if (after.status === 404 || after.status === 410) {
    return {
      ok: false,
      after,
      outcome: 'never-activated',
      reason:
        `no release pointer is published at ${options.originUrl} (HTTP ${after.status}) — ` +
        'the release was never activated.',
    };
  }
  if (!Value.Check(ReleasePointerSchema, after.body)) {
    return {
      ok: false,
      after,
      outcome: 'active-graph-invalid',
      reason: `the published pointer at ${options.originUrl} is malformed; refusing to treat it as a release.`,
    };
  }
  return { ok: true, after, pointer: after.body as { rootHash: string } };
};

/** Classifies an active, graph-valid release. */
const classifyActiveRelease = (options: {
  after: ReleasePointer;
  previousRootHash: string | undefined;
  plannedRootHash: string;
  aliasDegraded: boolean;
}): PublicationVerification => {
  if (options.aliasDegraded) {
    return {
      outcome: 'alias-degraded',
      verified: true,
      after: options.after,
      verificationError:
        'the immutable release is active and verified; the mutable compatibility alias did not move',
      previousRootHash: options.previousRootHash,
    };
  }
  return {
    outcome:
      options.previousRootHash === options.plannedRootHash ? 'already-active' : 'newly-activated',
    verified: true,
    after: options.after,
    verificationError: '',
    previousRootHash: options.previousRootHash,
  };
};

/**
 * Re-resolves the pointer remotely and decides what actually happened.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * Verification used to require `after.sha256 !== previous.sha256` AND a root
 * match. The sha-inequality test made an already-correct release a FAILURE:
 * a retry — or any run where the pointer already named the planned root —
 * reported "the release pointer did not advance" and exited 1, even though the
 * release was active and every byte behind it verified. The only way to make
 * such a run "pass" was to write a different pointer, which is fabricating a
 * change to satisfy a check.
 *
 * The root is the identity. Advancement is a CLASSIFICATION, not a pass/fail
 * criterion: the pointer naming the planned root and the graph behind it
 * verifying is success, whether that happened just now or before this run.
 *
 * Nothing here writes. Verification never fabricates a pointer change, and it
 * never rewrites prior activation evidence — the receipt's `activated` still
 * comes from the publisher's own pointer write.
 */
export const verifyPublishedRelease = async (options: {
  originUrl: string;
  previous: ReleasePointer;
  plannedRootHash: string;
  /** True when activation succeeded but the mutable alias did not move. */
  aliasDegraded?: boolean;
  /** Reader for the graph re-resolution. Injectable so tests never hit a bucket. */
  reader?: ReleaseDocumentReader;
  /** Pointer reader. Injectable so tests never hit a bucket. */
  readPointer?: (originUrl: string) => Promise<ReleasePointer>;
}): Promise<PublicationVerification> => {
  const previousRootHash = rootHashOf(options.previous);
  const readPointer = options.readPointer ?? readReleasePointer;

  const read = await readPublishedPointer({ originUrl: options.originUrl, readPointer });
  if (!read.ok) {
    return {
      outcome: read.outcome,
      verified: false,
      after: read.after,
      verificationError: read.reason,
      previousRootHash,
    };
  }
  const { after, pointer } = read;

  const failure = (
    outcome: PublicationVerificationOutcome,
    verificationError: string,
  ): PublicationVerification => ({
    outcome,
    verified: false,
    after,
    verificationError,
    previousRootHash,
  });

  if (pointer.rootHash !== options.plannedRootHash) {
    return failure(
      'wrong-root-active',
      `the published pointer resolves root ${pointer.rootHash.slice(0, 12)}… but the plan pinned ` +
        `${options.plannedRootHash.slice(0, 12)}…`,
    );
  }

  // The root matches. That is necessary but not sufficient — see
  // `assertActiveGraphValid`.
  const graphCheck = await assertActiveGraphValid({
    originUrl: options.originUrl,
    plannedRootHash: options.plannedRootHash,
    ...(options.reader === undefined ? {} : { reader: options.reader }),
  });
  if (!graphCheck.ok) {
    return failure('active-graph-invalid', graphCheck.reason);
  }

  // Active and valid. Classify how it got there.
  return classifyActiveRelease({
    after,
    previousRootHash,
    plannedRootHash: options.plannedRootHash,
    aliasDegraded: options.aliasDegraded === true,
  });
};

/** Records the remote verification step, naming exactly how it failed. */
export const recordVerification = (
  io: StepRecorder,
  options: {
    originUrl: string;
    previous: ReleasePointer;
    verification: PublicationVerification;
  },
): void => {
  const { verification, previous } = options;
  const advanced = `pointer ${previous.sha256?.slice(0, 12) ?? 'absent'} → ${verification.after.sha256?.slice(0, 12)}`;
  const detail = verification.verified
    ? `${verification.outcome} — ${advanced}`
    : `${verification.outcome} — ${verification.verificationError}`;
  io.record({
    name: 'verify published release',
    command: `GET ${options.originUrl}/index/v1/release.json`,
    status: verification.verified ? 'ok' : 'failed',
    exitCode: verification.verified ? 0 : 1,
    durationMs: 0,
    detail,
  });
};

/** The closing summary: what moved, what degraded, and how to roll back. */
export const printApplyOutcome = (options: {
  reportFile: string;
  receiptFile: string;
  activated: boolean;
  legacyAliasWritten: boolean;
  legacyAliasError: string;
  previous: ReleasePointer;
}): void => {
  const alias = options.legacyAliasWritten
    ? 'updated'
    : `not updated${options.legacyAliasError ? ` — ${options.legacyAliasError}` : ''}`;
  const rollback =
    options.previous.status === 200 ? options.previous.sha256 : '(no previous release)';
  console.log('');
  console.log(`Release report: ${options.reportFile}`);
  console.log(`Release receipt: ${options.receiptFile}`);
  console.log(
    `Activation: pointer ${options.activated ? 'advanced' : 'NOT advanced'} · legacy alias ${alias}`,
  );
  console.log(`Rollback: re-point index/v1/release.json at ${rollback}`);
};
