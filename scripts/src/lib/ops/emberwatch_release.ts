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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCatalogConfig } from '../catalog/config.ts';
import { runCatalogPublish } from '../catalog/pipeline.ts';
import type { PublishReportLike } from '../catalog/release.ts';
import { buildReceipt } from '../catalog/release.ts';
import type { ReleaseTarget } from '../catalog/release_target.ts';
import { createR2Client } from '../catalog/upload.ts';
import { loadSealedCandidate } from './emberwatch_candidate.ts';
import {
  buildReleaseReport,
  createStepRecorder,
  type ReleasePointer,
  readReleasePointer,
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
const releasePlane = join(repository, '.local/releases');

const USAGE = `Emberwatch release orchestrator

  bun run emberwatch:release --mode staging|production [--plan|--apply] [options]

Options:
  --mode <staging|production>   Required. The release target.
  --build-candidate             Run the deterministic content build (install
                              portraits/audio, regenerate atlas + maps, rescan)
                              and SEAL a candidate. Mutates local artifacts and
                              performs no remote write. Run this BEFORE --plan.
--plan                        Read-only: checks + the intended step list. Default.
  --apply                       Execute every step, including the remote publish.
  --accept-run <runId>          Install the machine-passing candidates of a
                                generate:batch run before rebuilding artifacts.
  --skip-tests                  Skip the validation step (not recommended).
  --allow-dirty                 Allow a dirty worktree (recorded in the report).
  --help                        Print this message.
`;

type Invocation = {
  mode: 'staging' | 'production';
  apply: boolean;
  skipTests: boolean;
  allowDirty: boolean;
  buildCandidate: boolean;
  acceptRun?: string;
};

type PackIdentity = { manifestVersion: string; indexVersion: string | undefined };

type TargetContext = {
  config: Awaited<ReturnType<typeof resolveCatalogConfig>>;
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
  'validate (tests + typecheck + lint + guards)',
  `publish catalog (${mode})`,
  'verify published release',
];

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const parseInvocation = (args: string[]): Invocation => {
  const buildCandidate = args.includes('--build-candidate');
  const acceptRun = flagValue(args, '--accept-run');
  const mode = flagValue(args, '--mode');
  if (mode !== 'staging' && mode !== 'production') {
    // A candidate build is LOCAL and mode-independent: it performs no remote
    // write, so requiring a target mode would be a fiction. `staging` is used
    // only for the "review it, then run …" hint it prints.
    if (buildCandidate) {
      return {
        mode: 'staging',
        apply: false,
        skipTests: false,
        allowDirty: false,
        buildCandidate: true,
        ...(acceptRun === undefined ? {} : { acceptRun }),
      };
    }
    console.error('❌ --mode must be staging or production.');
    console.error(USAGE);
    process.exit(4);
  }
  return {
    mode,
    apply: args.includes('--apply'),
    skipTests: args.includes('--skip-tests'),
    allowDirty: args.includes('--allow-dirty'),
    buildCandidate,
    ...(acceptRun === undefined ? {} : { acceptRun }),
  };
};

const readPackIdentity = (): PackIdentity => {
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as { version: string };
  const index = JSON.parse(readFileSync(join(repository, 'content/packs/index.json'), 'utf8')) as {
    packs: { id: string; version: string }[];
  };
  return {
    manifestVersion: manifest.version,
    indexVersion: index.packs.find((pack) => pack.id === 'emberwatch')?.version,
  };
};

const printHeader = (options: {
  mode: string;
  apply: boolean;
  sourceCommit: string;
  pack: PackIdentity;
  dirty: boolean;
}): void => {
  console.log(`Emberwatch release — mode ${options.mode} — ${options.apply ? 'APPLY' : 'PLAN'}`);
  console.log(`  source commit: ${options.sourceCommit}`);
  console.log(
    `  pack version:  ${options.pack.manifestVersion} (index: ${options.pack.indexVersion ?? 'absent'})`,
  );
  console.log(`  worktree:      ${options.dirty ? 'dirty' : 'clean'}`);
  console.log('');
};

/** Refuses a publish whose manifest and index disagree about the pack version. */
const assertVersionParity = (pack: PackIdentity): void => {
  if (pack.manifestVersion === pack.indexVersion) {
    return;
  }
  console.error('❌ manifest/index version drift — refusing. Fix before releasing.');
  process.exit(2);
};

const assertCleanForApply = (options: {
  dirty: boolean;
  apply: boolean;
  allowDirty: boolean;
}): void => {
  if (!options.dirty || !options.apply || options.allowDirty) {
    return;
  }
  console.error('❌ worktree is dirty — refusing --apply. Commit, or pass --allow-dirty.');
  process.exit(2);
};

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
  let config: ReturnType<typeof resolveCatalogConfig>;
  try {
    config = resolveCatalogConfig(mode);
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
  const releaseTarget = config.releaseTarget;
  if (releaseTarget === undefined) {
    throw new Error('resolveCatalogConfig returned no validated release target');
  }
  return { config, releaseTarget };
};

const printTarget = (options: {
  mode: string;
  target: TargetContext;
  previous: ReleasePointer;
}): void => {
  const { config, releaseTarget } = options.target;
  const targetMatchesConfig =
    config.bucket === releaseTarget.bucket && config.originUrl === releaseTarget.originUrl;
  console.log(
    `  bucket:        ${config.bucket}${releaseTarget.viaTestSeam ? ' (test seam)' : ''}`,
  );
  console.log(`  origin:        ${config.originUrl}`);
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
  const buildSteps: [string, string][] = [
    ['install portraits', 'scripts/src/lib/ops/install_emberwatch_portraits.ts'],
    ['install authored audio beds', 'scripts/src/lib/ops/install_emberwatch_audio.ts'],
    ['generate terrain/grid atlas', 'scripts/src/lib/ops/generate_emberwatch_atlas.ts'],
    ['generate prop atlas pages', 'scripts/src/lib/ops/generate_emberwatch_props_atlas.ts'],
    ['regenerate canonical maps', 'scripts/src/lib/ops/generate_emberwatch_maps.ts'],
    ['scan manifest + hashes + credits', 'scripts/src/lib/ops/scan_assets.ts'],
  ];
  for (const [label, script] of buildSteps) {
    if (io.bun(label, script).status === 'failed') {
      process.exit(1);
    }
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
  for (const name of plannedSteps(options.invocation.mode)) {
    options.io.skipped(name, '(planned — run with --apply)');
  }
  const audit = options.io.bun(
    'coverage audit (read-only)',
    'scripts/src/lib/ops/emberwatch_coverage_audit.ts',
  );

  // Best-effort typed preflight: the plan is more useful when it names the
  // candidate, the base release and the root hash it would publish. A failure
  // here is reported, not fatal — plan mode already gates on the audit.
  const candidatePhase = verifySealedCandidatePhase();
  let planFields: { candidateLockHash?: string; releasePlanHash?: string } = {};
  if (candidatePhase.ok) {
    const planPhases = await buildPlanPhases({
      mode: options.invocation.mode,
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
      console.warn(`  ⚠ ${planPhases.phase}: ${planPhases.error}`);
    }
  } else {
    console.warn(`  ⚠ ${candidatePhase.phase}: ${candidatePhase.error}`);
  }

  writeReleaseReport({
    repository,
    mode: options.invocation.mode,
    report: buildReleaseReport({
      repository,
      sourceCommit: options.sourceCommit,
      packVersion: options.pack.manifestVersion,
      mode: options.invocation.mode,
      apply: false,
      dirtyWorktree: options.dirty,
      dirtyWorktreeAllowed: options.invocation.allowDirty,
      config: options.target.config,
      previous: options.previous,
      steps: options.io.steps,
      ...planFields,
    }),
  });
  console.log('');
  console.log(
    `Plan complete. Coverage audit exit ${audit.exitCode}. No remote write was performed.`,
  );
  process.exit(audit.exitCode === 0 ? 0 : 2);
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

  assertValidationPasses(options.io, options.invocation.skipTests);

  // ── Publish: the typed pipeline, in process ────────────────────────────
  let publishReport: PublishReportLike;
  try {
    publishReport = (await runCatalogPublish({
      config: options.target.config,
      client: createR2Client(options.target.config),
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
    originUrl: options.target.config.originUrl,
    previous: options.previous,
    plannedRootHash: plan.catalogRootHash,
  });
  recordVerification(options.io, {
    originUrl: options.target.config.originUrl,
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
    repository,
    mode: options.invocation.mode,
    report: buildReleaseReport({
      repository,
      sourceCommit: options.sourceCommit,
      packVersion: options.pack.manifestVersion,
      mode: options.invocation.mode,
      apply: true,
      dirtyWorktree: options.dirty,
      dirtyWorktreeAllowed: options.invocation.allowDirty,
      config: options.target.config,
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
  const pack = readPackIdentity();

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
  const previous = await readReleasePointer(target.config.originUrl);
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
