// scripts/src/lib/ops/emberwatch_release.ts
//
// The single operator front door for an Emberwatch release.
//
//   bun run emberwatch:release --mode staging --plan
//   bun run emberwatch:release --mode staging --apply
//   bun run emberwatch:release --mode production --plan
//   bun run emberwatch:release --mode production --apply
//
// ── What this file is ─────────────────────────────────────────────────────
//
// A CLI SHELL over typed phases. It parses the invocation, prints, and decides
// process exit codes; every release decision belongs to a typed API that
// returns a result rather than an exit code:
//
//   verifyCandidate()      the sealed candidate still matches the source
//   resolveBaseRelease()   the verified release this target is built on
//   buildReleasePlan()     what WOULD be published — no writes
//   validateReleasePlan()  the plan is internally consistent and safe to apply
//   runCatalogPublish()    upload immutables, then advance the pointer LAST
//   verifyRelease()        re-resolve remotely and compare the planned root
//   buildReceipt()         the durable record of what actually happened
//
// A subprocess is used only for the INDEPENDENT validation suite
// (`bun moon ci`), which is a separate authority by design. No release
// guarantee is read out of a subprocess's stderr.
//
// ── Guarantees ────────────────────────────────────────────────────────────
//
//   • `--plan` performs NO remote write and no local artifact mutation.
//   • `--apply` refuses a dirty worktree unless `--allow-dirty`, refuses a
//     stale brief/prop table, refuses a coverage audit with blockers, and stops
//     before publishing if any upstream step fails.
//   • the previous release pointer is read and recorded before any write, so
//     rollback has a named target.
//   • credentials are never printed. Only the bucket name and origin are.
//   • nothing is ever deleted: the publisher writes immutable content-addressed
//     objects and advances the pointer last.
//   • a machine-readable release report is written under
//     `.local/releases/<mode>/<timestamp>.json`, and a ReleaseReceipt under
//     `.local/releases/receipt-<mode>.json` — including for a degraded
//     post-activation outcome.
//
// Exit codes: 0 ok · 1 a step failed · 2 refused (dirty/stale/blocked) · 4 usage.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CatalogConfig,
  type CatalogTarget,
  resolveCatalogConfig,
  resolveCatalogTarget,
} from '../catalog/config.ts';
import { runCatalogPublish } from '../catalog/pipeline.ts';
import { describeStagingApproval, verifyStagingApproval } from '../catalog/promotion.ts';
import type { PublishReportLike } from '../catalog/release.ts';
import { buildReceipt, receiptPath } from '../catalog/release.ts';
import type { ReleaseTarget } from '../catalog/release_target.ts';
import { createR2Client } from '../catalog/upload.ts';
import { loadSealedCandidate } from './emberwatch_candidate.ts';
import {
  assertCleanForApply,
  assertVersionParity,
  type Invocation,
  type PackIdentity,
  parseInvocation,
  printHeader,
  readPackIdentity,
  USAGE,
} from './emberwatch_release_cli.ts';
import {
  buildReleaseReport,
  createStepRecorder,
  type ReleasePointer,
  readReleasePointer,
  releasePlaneDir,
  type StepRecorder,
  writeReceipt,
  writeReleaseReport,
} from './emberwatch_release_io.ts';
import {
  assertValidationPasses,
  buildPlanPhases,
  printApplyOutcome,
  printPlanFacts,
  recordVerification,
  toReceiptPhase,
  verifyPublishedRelease,
  verifySealedCandidatePhase,
} from './emberwatch_release_phases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const releasePlane = releasePlaneDir();

type TargetContext = {
  /**
   * Read-only target identity — bucket, read origin, safety warnings.
   *
   * Deliberately NOT write credentials. A plan must be reviewable without the
   * ability to execute it, so the target is resolved once here and write
   * credentials are loaded only on the path that actually writes.
   */
  target: CatalogTarget;
  releaseTarget: ReleaseTarget;
};

/** The planned steps a `--plan` run reports without executing. */
const plannedSteps = (mode: string): string[] => [
  'install portraits (pack → game-data + manifest binding)',
  'install authored audio beds (pack → game-data music category)',
  'generate terrain/grid atlas',
  'generate prop atlas pages',
  'regenerate canonical maps',
  'coverage audit',
  'scan manifest + hashes + credits',
  'generate asset seed (deterministic, from the scan outputs)',
  'validate (tests + typecheck + lint + guards)',
  `publish catalog (${mode})`,
  'verify published release',
];

/**
 * The release-target preflight: BEFORE any write.
 *
 * `resolveCatalogConfig` runs the fail-closed release-target gate
 * (`catalog/release_target.ts`): a remote mode accepts only the bucket and
 * origin it declares, so a `CATALOG_BUCKET` override — as `scripts/.env.staging`
 * used to carry, pointing at the PRODUCTION bucket — cannot retarget the run.
 * The gate throws before this process can write.
 */
const preflightTarget = (mode: string): TargetContext => {
  let target: CatalogTarget;
  try {
    target = resolveCatalogTarget(mode);
  } catch (error) {
    console.error('');
    console.error('❌ release target refused — nothing was written.');
    console.error(`   ${(error as Error).message}`);
    console.error('');
    console.error(
      '   A staging release needs its OWN bucket and read origin. Verifying a staging\n' +
        '   write by reading the production origin proves nothing about staging.',
    );
    process.exit(2);
  }
  return { target, releaseTarget: target.releaseTarget };
};

const printTarget = (options: {
  mode: string;
  target: TargetContext;
  previous: ReleasePointer;
}): void => {
  const { target, releaseTarget } = options.target;
  const targetMatchesConfig =
    target.bucket === releaseTarget.bucket && target.originUrl === releaseTarget.originUrl;
  console.log(
    `  bucket:        ${target.bucket}${releaseTarget.viaTestSeam ? ' (test seam)' : ''}`,
  );
  console.log(`  origin:        ${target.originUrl}`);
  for (const warning of releaseTarget.warnings) {
    console.warn(`  warning:       ${warning}`);
  }
  console.log(
    releaseTarget.viaTestSeam || !targetMatchesConfig
      ? '  target check:  rehearsal or mismatched target — not reported as ok'
      : `  target check:  ok (bucket and origin match mode ${options.mode})`,
  );
  console.log('');
  console.log(
    `  previous release pointer: ${
      options.previous.status === 200
        ? `${options.previous.sha256?.slice(0, 12)} (${options.previous.key})`
        : `absent (HTTP ${options.previous.status})`
    }`,
  );
  console.log('');
};

/** The two staleness gates that must pass before anything is built or published. */
const assertReadOnlyChecks = (io: StepRecorder): void => {
  const briefCheck = io.bun(
    'brief rebase check',
    'scripts/src/lib/ops/rebase_emberwatch_brief.ts',
    ['--check'],
  );
  if (briefCheck.status === 'failed') {
    console.error(
      '❌ brief is not rebased — run: bun scripts/src/lib/ops/rebase_emberwatch_brief.ts',
    );
    process.exit(2);
  }
  const propsCheck = io.bun('prop table check', 'scripts/src/lib/ops/sync_emberwatch_props.ts', [
    '--check',
  ]);
  if (propsCheck.status === 'failed') {
    console.error(
      '❌ prop table out of sync — run: bun scripts/src/lib/ops/sync_emberwatch_props.ts',
    );
    process.exit(2);
  }
};

/** Candidate acceptance — only when an operator names a run. */
const maybeAcceptRun = (io: StepRecorder, invocation: Invocation): void => {
  if (invocation.acceptRun === undefined) {
    io.skipped(
      'accept candidates',
      "(none — pass --accept-run <runId> to install a run's accepted candidates)",
    );
    return;
  }
  const acceptArgs = ['--run', invocation.acceptRun, ...(invocation.apply ? ['--apply'] : [])];
  const accepted = io.bun(
    'accept candidates',
    'scripts/src/lib/ops/emberwatch_accept.ts',
    acceptArgs,
  );
  if (accepted.status === 'failed') {
    process.exit(1);
  }
};

/**
 * The deterministic content build, then the seal.
 *
 * These steps install authored portraits and audio into the runtime game-data
 * plane, regenerate the terrain atlas, prop-atlas pages and canonical maps, and
 * rescan the manifest. They must NOT run during `--apply`: a release promotes a
 * candidate that was sealed once, and rebuilding during publication is exactly
 * how staging and production end up publishing different bytes while both
 * report success.
 */
const buildAndSealCandidate = (io: StepRecorder, mode: string): void => {
  const buildSteps: [string, string, string[]?][] = [
    ['install portraits', 'scripts/src/lib/ops/install_emberwatch_portraits.ts'],
    ['install authored audio beds', 'scripts/src/lib/ops/install_emberwatch_audio.ts'],
    ['generate terrain/grid atlas', 'scripts/src/lib/ops/generate_emberwatch_atlas.ts'],
    ['generate prop atlas pages', 'scripts/src/lib/ops/generate_emberwatch_props_atlas.ts'],
    ['regenerate canonical maps', 'scripts/src/lib/ops/generate_emberwatch_maps.ts'],
    ['scan manifest + hashes + credits', 'scripts/src/lib/ops/scan_assets.ts'],
    // The seed is a DERIVED artifact of the scan above, exactly like the atlas
    // and the maps, and it must exist before the seal: the candidate lock has a
    // `seed` group, and `runSeedPublish` refuses to publish a release whose
    // seed is absent from both the candidate and the previous release. Leaving
    // it out of this list is what made `asset_seed.json` a file that only
    // existed in whoever's working tree had run the generator by hand.
    //
    // No `--merge-origin`: this step is mode-independent and must be
    // reproducible from the source tree alone. Carrying the published catalog's
    // rows in happens at PUBLISH time, against the target's verified release.
    ['generate asset seed', 'scripts/src/lib/ops/generate_asset_seed.ts', ['--write']],
  ];
  const treeBefore = io.git(['status', '--porcelain']);
  for (const [label, script, args] of buildSteps) {
    if (io.bun(label, script, args ?? []).status === 'failed') {
      process.exit(1);
    }
  }

  // A seal is only meaningful against a tree the operator has seen. If the
  // build changed tracked artifacts, the candidate would be sealed from a
  // source state that exists nowhere in git — `sourceCommit` would name a
  // commit that does not reproduce the sealed bytes, and the next rebuild
  // would differ. Stop here and hand the diff back for review instead.
  //
  // The build is idempotent by construction, so on a clean tree this is a
  // no-op; it fires exactly when a content change produced new artifacts.
  const treeAfter = io.git(['status', '--porcelain']);
  if (treeAfter !== treeBefore) {
    console.error('');
    console.error('❌ candidate source changed during build — refusing to seal.');
    console.error('   The generated artifacts now differ from the committed source, so a');
    console.error('   seal would name a commit that does not reproduce these bytes.');
    console.error('');
    console.error('   Review and commit the generated artifacts, then rerun:');
    console.error('     bun run emberwatch:build-candidate');
    console.error('');
    console.error('   Changed paths:');
    for (const line of treeAfter.split('\n').filter((entry) => entry.trim().length > 0)) {
      console.error(`     ${line}`);
    }
    process.exit(2);
  }

  const audit = io.bun('coverage audit', 'scripts/src/lib/ops/emberwatch_coverage_audit.ts');
  if (audit.status === 'failed') {
    console.error('❌ coverage audit reports blockers — refusing to seal.');
    process.exit(2);
  }
  const seal = io.bun('seal candidate', 'scripts/src/lib/ops/emberwatch_candidate.ts', ['--seal']);
  if (seal.status === 'failed') {
    console.error('❌ candidate sealing failed.');
    process.exit(1);
  }
  console.log('');
  console.log('Candidate built and sealed. Review it, then:');
  console.log(`  bun run emberwatch:release --mode ${mode} --plan`);
};

/**
 * Loads write credentials and proves they target the identity the plan used.
 *
 * The plan is built from a read-only target; this is the only place that needs
 * the ability to write. Re-resolving the target here (rather than trusting the
 * credential environment) means a credential set that names a different bucket
 * or origin is refused instead of silently publishing somewhere the operator
 * never reviewed.
 *
 * @param mode - AIKAMI mode whose `scripts/.env.{mode}` holds the credentials.
 * @param planned - The read-only target the plan was built from.
 */
const resolveWriteConfig = (mode: string, planned: CatalogTarget): CatalogConfig => {
  let config: CatalogConfig;
  try {
    config = resolveCatalogConfig(mode);
  } catch (error) {
    console.error('');
    console.error('❌ write credentials unavailable — nothing was written.');
    console.error(`   ${(error as Error).message}`);
    console.error('');
    console.error(
      '   The plan above is read-only and was produced without credentials. Applying\n' +
        '   it needs R2 write access for the target it named.',
    );
    process.exit(2);
  }

  // The credential environment must resolve to the SAME target the plan used.
  // `resolveCatalogConfig` re-runs the full safety gate, so this also re-proves
  // canonical origin identity rather than assuming the earlier check still holds.
  if (config.bucket !== planned.bucket || config.originUrl !== planned.originUrl) {
    console.error('');
    console.error(
      '❌ write configuration does not match the planned target — nothing was written.',
    );
    console.error(`   planned: bucket ${planned.bucket}, origin ${planned.originUrl}`);
    console.error(`   write:   bucket ${config.bucket}, origin ${config.originUrl}`);
    console.error('');
    console.error('   Refusing to publish to a target the plan did not describe.');
    process.exit(2);
  }

  return config;
};

/**
 * The production promotion gate, recorded as a plan/apply step.
 *
 * Production publishes the candidate STAGING approved. It belongs in `--plan`
 * too: an operator reviewing a production plan must be told there is no
 * approval to promote, not discover it at `--apply`.
 *
 * @returns A failure message, or `undefined` when the gate passed or does not
 *   apply to this mode.
 */
const runStagingApprovalGate = async (options: {
  io: StepRecorder;
  mode: string;
  candidateLockHash: string;
}): Promise<string | undefined> => {
  if (options.mode !== 'production') {
    return undefined;
  }
  const path = receiptPath(releasePlane, 'staging');
  const approval = await verifyStagingApproval({
    receiptPath: path,
    candidateLockHash: options.candidateLockHash,
  });
  if (approval.ok) {
    options.io.record({
      name: 'staging approval',
      command: `read ${path}`,
      status: 'ok',
      exitCode: 0,
      durationMs: 0,
      detail: describeStagingApproval(approval).replace(/\n/g, ' · '),
    });
    return undefined;
  }
  options.io.record({
    name: 'staging approval',
    command: `read ${path}`,
    status: 'failed',
    exitCode: 1,
    durationMs: 0,
    detail: `${approval.code}: ${approval.reason}`,
  });
  return `staging approval (${approval.code}): ${approval.reason}`;
};

/** `--plan`: report the intended steps, touching nothing. */
const runPlanMode = async (options: {
  io: StepRecorder;
  invocation: Invocation;
  target: TargetContext;
  previous: ReleasePointer;
  sourceCommit: string;
  pack: PackIdentity;
  dirty: boolean;
}): Promise<never> => {
  const { io, invocation } = options;
  for (const name of plannedSteps(invocation.mode)) {
    io.skipped(name, '(planned — run with --apply)');
  }

  // ── Every mandatory planning phase, and its outcome ─────────────────────
  //
  // A plan is a claim that this release WOULD succeed. It used to be decided
  // by the coverage audit alone: candidate verification and plan construction
  // were "best-effort" and their failures were printed as warnings, so a run
  // whose candidate did not verify — or whose plan could not be built at all —
  // still exited 0 whenever the audit passed. That is a plan reporting success
  // for a release that cannot happen.
  //
  // Each phase below is now recorded in the step ledger and, on failure, makes
  // the run exit non-zero. Nothing here writes: the audit is read-only, the
  // candidate is re-derived locally, and base-release resolution is a GET.
  const failures: string[] = [];

  const audit = io.bun(
    'coverage audit (read-only)',
    'scripts/src/lib/ops/emberwatch_coverage_audit.ts',
  );
  if (audit.status === 'failed') {
    failures.push(`coverage audit reported blockers (exit ${audit.exitCode})`);
  }

  const candidatePhase = verifySealedCandidatePhase();
  if (candidatePhase.ok) {
    io.record({
      name: 'verify sealed candidate',
      command: 'verifyCandidate()',
      status: 'ok',
      exitCode: 0,
      durationMs: 0,
      detail: candidatePhase.value.lockHash,
    });
  } else {
    io.record({
      name: 'verify sealed candidate',
      command: 'verifyCandidate()',
      status: 'failed',
      exitCode: 1,
      durationMs: 0,
      detail: candidatePhase.error,
    });
    failures.push(`${candidatePhase.phase}: ${candidatePhase.error}`);
  }

  // Production promotes a candidate STAGING approved.
  if (candidatePhase.ok) {
    const approvalFailure = await runStagingApprovalGate({
      io,
      mode: invocation.mode,
      candidateLockHash: candidatePhase.value.lockHash,
    });
    if (approvalFailure !== undefined) {
      failures.push(approvalFailure);
    }
  }

  let planFields: { candidateLockHash?: string; releasePlanHash?: string } = {};
  if (candidatePhase.ok) {
    const planPhases = await buildPlanPhases({
      mode: invocation.mode,
      releaseTarget: options.target.releaseTarget,
      candidatePhase,
    });
    if (planPhases.ok) {
      printPlanFacts(planPhases.value);
      planFields = {
        candidateLockHash: planPhases.value.candidate.lockHash,
        releasePlanHash: planPhases.value.plan.planHash,
      };
    } else {
      io.record({
        name: 'build + validate release plan',
        command: 'buildReleasePlan() → validateReleasePlan()',
        status: 'failed',
        exitCode: 1,
        durationMs: 0,
        detail: planPhases.error,
      });
      failures.push(`${planPhases.phase}: ${planPhases.error}`);
    }
  }

  writeReleaseReport({
    mode: invocation.mode,
    report: buildReleaseReport({
      repository,
      sourceCommit: options.sourceCommit,
      packVersion: options.pack.manifestVersion,
      mode: invocation.mode,
      apply: false,
      dirtyWorktree: options.dirty,
      dirtyWorktreeAllowed: invocation.allowDirty,
      config: options.target.target,
      previous: options.previous,
      steps: io.steps,
      ...planFields,
    }),
  });

  console.log('');
  if (failures.length > 0) {
    console.error(`❌ plan FAILED — ${failures.length} mandatory phase(s) did not pass:`);
    for (const failure of failures) {
      console.error(`     ${failure}`);
    }
    console.error('');
    console.error('   No remote write was performed. Fix the above and re-run --plan.');
    process.exit(2);
  }
  console.log('Plan complete. Coverage audit exit 0. No remote write was performed.');
  process.exit(0);
};

/** `--apply`: verify, plan, publish, activate, verify, receipt. */
const applyRelease = async (options: {
  io: StepRecorder;
  invocation: Invocation;
  target: TargetContext;
  previous: ReleasePointer;
  sourceCommit: string;
  pack: PackIdentity;
  dirty: boolean;
}): Promise<never> => {
  const startedAt = new Date().toISOString();
  const candidatePhase = verifySealedCandidatePhase();
  if (!candidatePhase.ok) {
    console.error(
      `❌ ${candidatePhase.phase} refused — ${candidatePhase.error}\n` +
        '   Build and seal a fresh candidate first:\n' +
        '     bun run emberwatch:build-candidate',
    );
    process.exit(2);
  }
  const sealed = loadSealedCandidate();
  options.io.record({
    name: 'verify sealed candidate',
    command: 'verifyCandidate()',
    status: 'ok',
    exitCode: 0,
    durationMs: 0,
    detail: candidatePhase.value.lockHash,
  });

  const planPhases = await buildPlanPhases({
    mode: options.invocation.mode,
    releaseTarget: options.target.releaseTarget,
    candidatePhase,
  });
  if (!planPhases.ok) {
    console.error(`❌ ${planPhases.phase} refused — ${planPhases.error}`);
    process.exit(2);
  }
  const { plan, base } = planPhases.value;
  printPlanFacts(planPhases.value);

  // ── Production promotion gate: BEFORE any write ─────────────────────────
  //
  // Checked on the apply path, before write credentials are loaded and before
  // a single byte is uploaded — so a missing, stale, unverified or mismatched
  // approval cannot leave a partial production release behind.
  const approvalFailure = await runStagingApprovalGate({
    io: options.io,
    mode: options.invocation.mode,
    candidateLockHash: candidatePhase.value.lockHash,
  });
  if (approvalFailure !== undefined) {
    console.error('');
    console.error('❌ production promotion refused — nothing was written.');
    console.error(`   ${approvalFailure}`);
    console.error('');
    console.error('   Production promotes a candidate STAGING published and verified.');
    process.exit(2);
  }

  assertValidationPasses(options.io, options.invocation.skipTests);

  // ── Write credentials: loaded only now, on the path that writes ────────
  //
  // Everything above — target identity, candidate verification, base-release
  // resolution, plan construction and validation — is read-only and ran
  // without credentials. This is the first point that needs the ability to
  // write, and the resolved config is checked against the identity the plan
  // was built from, so a credential set cannot retarget the publish.
  const writeConfig = resolveWriteConfig(options.invocation.mode, options.target.target);

  // ── Publish: the typed pipeline, in process ────────────────────────────
  let publishReport: PublishReportLike;
  try {
    publishReport = (await runCatalogPublish({
      config: writeConfig,
      client: createR2Client(writeConfig),
      // The SAME stamp the plan used. The root document embeds `publishedAt`,
      // so a different value here would write a root whose hash differs from
      // the one the plan pinned — and verification could never match.
      publishedAt: sealed.sealedAt,
    })) as PublishReportLike;
  } catch (error) {
    console.error(`❌ publish threw before reporting — ${(error as Error).message}`);
    publishReport = { ok: false, uploaded: 0, skipped: 0, failed: 1 };
  }
  options.io.record({
    name: `publish catalog (${options.invocation.mode})`,
    command: 'runCatalogPublish()',
    status: publishReport.ok ? 'ok' : 'failed',
    exitCode: publishReport.ok ? 0 : 1,
    durationMs: 0,
    detail: `${publishReport.uploaded ?? 0} uploaded, ${publishReport.skipped ?? 0} skipped, ${publishReport.failed ?? 0} failed`,
  });

  // ── Verify ─────────────────────────────────────────────────────────────
  const verification = await verifyPublishedRelease({
    originUrl: options.target.target.originUrl,
    previous: options.previous,
    plannedRootHash: plan.catalogRootHash,
    // Activation and alias maintenance are separate concerns: the immutable
    // release can be active and valid while the mutable compatibility alias
    // did not move. Reporting that as a release failure would be wrong, and
    // reporting it as a clean success would hide a degraded surface.
    aliasDegraded: publishReport.legacyAlias?.error !== undefined,
  });
  recordVerification(options.io, {
    originUrl: options.target.target.originUrl,
    previous: options.previous,
    verification,
  });

  // ── Receipt: written even for a degraded post-activation outcome ───────
  const receipt = buildReceipt({
    candidate: sealed,
    plan,
    report: publishReport,
    previousReleaseId: base.base?.releaseId ?? '',
    phases: planPhases.value.phases.map(toReceiptPhase),
    startedAt,
    verified: verification.verified,
    verificationError: verification.verificationError,
  });
  const receiptFile = writeReceipt({
    releasePlane,
    mode: options.invocation.mode,
    receipt,
  });

  const reportFile = writeReleaseReport({
    mode: options.invocation.mode,
    report: buildReleaseReport({
      repository,
      sourceCommit: options.sourceCommit,
      packVersion: options.pack.manifestVersion,
      mode: options.invocation.mode,
      apply: true,
      dirtyWorktree: options.dirty,
      dirtyWorktreeAllowed: options.invocation.allowDirty,
      config: options.target.target,
      previous: options.previous,
      after: verification.after,
      steps: options.io.steps,
      candidateLockHash: candidatePhase.value.lockHash,
      releasePlanHash: plan.planHash,
      receiptPath: receiptFile,
    }),
  });

  printApplyOutcome({
    reportFile,
    receiptFile,
    activated: receipt.activated,
    legacyAliasWritten: receipt.legacyAliasWritten,
    legacyAliasError: receipt.legacyAliasError,
    previous: options.previous,
  });
  process.exit(verification.verified ? 0 : 1);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    console.log(USAGE);
    process.exit(args.length === 0 ? 4 : 0);
  }
  const invocation = parseInvocation(args);
  const io = createStepRecorder(repository);
  const sourceCommit = io.git(['rev-parse', 'HEAD']);
  const dirty = io.git(['status', '--porcelain']).length > 0;
  const pack = readPackIdentity(repository);

  printHeader({ mode: invocation.mode, apply: invocation.apply, sourceCommit, pack, dirty });
  assertVersionParity(pack);
  assertCleanForApply({ dirty, apply: invocation.apply, allowDirty: invocation.allowDirty });

  // Building a candidate is an explicitly requested, LOCAL-ONLY operation: it
  // performs no remote write, so it is handled before the release-target
  // preflight (which exists to stop a WRITE from reaching the wrong bucket) and
  // before the read-only plan branch. `bun run emberwatch:build-candidate`
  // passes neither `--mode` nor `--apply`, and must still build.
  if (invocation.buildCandidate) {
    buildAndSealCandidate(io, invocation.mode);
    process.exit(0);
  }

  const target = preflightTarget(invocation.mode);
  const previous = await readReleasePointer(target.target.originUrl);
  printTarget({ mode: invocation.mode, target, previous });

  assertReadOnlyChecks(io);
  maybeAcceptRun(io, invocation);

  const shared = { io, invocation, target, previous, sourceCommit, pack, dirty };
  if (!invocation.apply) {
    await runPlanMode(shared);
  }
  await applyRelease(shared);
};

if (!existsSync(join(repository, 'content/packs/emberwatch/manifest.json'))) {
  console.error('❌ not run from the Aikami repository root.');
  process.exit(4);
}

await main();
