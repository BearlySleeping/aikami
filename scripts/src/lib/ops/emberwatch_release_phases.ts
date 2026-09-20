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

import { loadCatalogEntries } from '../catalog/catalog_entries.ts';
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
}): Promise<{ ok: true; value: PlanPhases } | { ok: false; phase: string; error: string }> => {
  const candidatePhase = options.candidatePhase;
  if (!candidatePhase.ok) {
    return candidatePhase;
  }
  const sealed = loadSealedCandidate();

  const basePhase = await resolveBaseRelease({ originUrl: options.releaseTarget.originUrl });
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
  const planPhase = buildReleasePlan({
    candidate: sealed,
    target: {
      mode: options.mode,
      bucket: options.releaseTarget.bucket,
      originUrl: options.releaseTarget.originUrl,
    },
    base: basePhase.value,
    entries: entries.map((entry) => ({
      tag: entry.tag,
      hash: entry.hash,
      sizeBytes: entry.sizeBytes,
      category: entry.category,
    })),
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

/** Re-resolves the pointer remotely and compares it with the planned root. */
export const verifyPublishedRelease = async (options: {
  originUrl: string;
  previous: ReleasePointer;
  plannedRootHash: string;
}): Promise<{ after: ReleasePointer; verified: boolean; verificationError: string }> => {
  const after = await readReleasePointer(options.originUrl);
  const advanced = after.status === 200 && after.sha256 !== options.previous.sha256;
  const body = after.body as { rootHash?: string } | undefined;
  const rootMatches = body?.rootHash === options.plannedRootHash;
  if (advanced && rootMatches) {
    return { after, verified: true, verificationError: '' };
  }
  const reason = !advanced
    ? 'the release pointer did not advance'
    : `the published pointer resolves root ${body?.rootHash?.slice(0, 12) ?? 'absent'} but the plan pinned ${options.plannedRootHash.slice(0, 12)}`;
  return { after, verified: false, verificationError: reason };
};

/** Records the remote verification step, naming exactly how it failed. */
export const recordVerification = (
  io: StepRecorder,
  options: {
    originUrl: string;
    previous: ReleasePointer;
    verification: { after: ReleasePointer; verified: boolean; verificationError: string };
  },
): void => {
  const { verification, previous } = options;
  const advanced = `pointer ${previous.sha256?.slice(0, 12) ?? 'absent'} → ${verification.after.sha256?.slice(0, 12)}`;
  io.record({
    name: 'verify published release',
    command: `GET ${options.originUrl}/index/v1/release.json`,
    status: verification.verified ? 'ok' : 'failed',
    exitCode: verification.verified ? 0 : 1,
    durationMs: 0,
    detail: verification.verified ? advanced : verification.verificationError,
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
