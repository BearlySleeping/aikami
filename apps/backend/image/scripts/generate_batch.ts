// apps/backend/image/scripts/generate_batch.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
// C-519: the durable asset batch front door.
//
//   bun run --cwd apps/backend/image generate:batch --manifest <path> [--phase slice|expansion]
//     [--plan | --run | --resume <runId> | --status <runId> | --cancel <runId>] …
//
// `--plan` is the default and is side-effect-free: it validates the brief,
// resolves references and providers and derives the job plan without calling an
// engine, downloading a model or writing to any staging root.
//
// `--run` dispatches through the shared `runAssetGeneration` pipeline, with the
// host runner (`@aikami/local-stack/generation`) owning the durable job store,
// the cross-process resource lease and the namespaced staging merge.
//
// stdout is always one JSON document (the plan for `--plan`, the report
// otherwise); human progress goes to stderr. No mode prompts.
//
// Exit codes — see `GENERATION_BATCH_EXIT_CODES`:
//   0 ok · 1 internal error · 2 blocked plan · 3 budget refused
//   4 invalid invocation · 5 job-state conflict (claimed/unknown run)
//
// Contract: C-519 Durable asset jobs and batch execution

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATION_BATCH_EXIT_CODES } from '@aikami/constants';
import {
  buildGenerationPlan,
  buildGenerationRunLock,
  makeRunId,
  requirePreparationProfile,
  resolveBudget,
  sha256Hex,
} from '@aikami/local-ai';
import {
  type BatchExecutionResult,
  buildHostedAvailabilityResolver,
  cancelBatch,
  DEFAULT_AUDIO_IMPORT_ROOT as DEFAULT_AUDIO_IMPORT_ROOT_RELATIVE,
  ensureRun,
  executeBatch,
  type GenerationStorePaths,
  generationStorePaths,
  importLegacyStaging,
  readBatchStatus,
  reconcileJob,
  resolveBriefReference,
  writeRunLockImmutable,
} from '@aikami/local-stack/generation';
import { AssetBriefSchema, GenerationBatchReportSchema } from '@aikami/schemas';
import type {
  AssetBrief,
  GenerationBatchReport,
  GenerationPlanBlocker,
  GenerationPlanWarning,
  GenerationRunRecord,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { buildEngineFactory } from './generate_batch_engines.ts';
import {
  ALLOW_TEST_SEAMS_ENV_VAR,
  hostedEnvFor,
  hostedFixtureTransportFromEnv,
  hostedReservationWarnings,
} from './generate_batch_hosted.ts';
import {
  type CliOptions,
  InvocationError,
  MODE_FLAG,
  parseOptions,
} from './generate_batch_options.ts';
import {
  buildPreparationHook,
  profileWarnings,
  writeMediaValidationFile,
} from './generate_batch_profiles.ts';
import { BATCH_USAGE } from './generate_batch_usage.ts';

/** Builds the report envelope for a runner result. */
const reportFor = (options: {
  kind: GenerationBatchReport['kind'];
  result: BatchExecutionResult;
  runId: string;
  runsDir: string;
  briefId?: string;
  phase?: 'slice' | 'expansion';
  plannedItems?: number;
  blockedItems?: number;
  message?: string;
}): GenerationBatchReport => ({
  schemaVersion: 1,
  kind: options.kind,
  ok: options.result.exitCode === GENERATION_BATCH_EXIT_CODES.OK,
  exitCode: options.result.exitCode,
  ...(options.briefId === undefined ? {} : { briefId: options.briefId }),
  ...(options.phase === undefined ? {} : { phase: options.phase }),
  runId: options.runId,
  runsDir: options.runsDir,
  ...(options.plannedItems === undefined ? {} : { plannedItems: options.plannedItems }),
  ...(options.blockedItems === undefined ? {} : { blockedItems: options.blockedItems }),
  engineRequests: options.result.engineRequests,
  jobs: [...options.result.jobs],
  blockers: [...options.result.blockers],
  warnings: [],
  activeLeases: [...options.result.activeLeases],
  ...(options.message === undefined ? {} : { message: options.message }),
});

/** Every requested item is blocked: pick the documented exit code for why. */
const exitCodeForBlockedRequest = (blockers: readonly GenerationPlanBlocker[]): number =>
  blockers.some((blocker) => blocker.code === 'budget_exceeded')
    ? GENERATION_BATCH_EXIT_CODES.BUDGET_REFUSED
    : GENERATION_BATCH_EXIT_CODES.BLOCKED_PLAN;

/**
 * The exit code for a completed invocation.
 *
 * A runner-level conflict/internal error outranks plan-level blockers; a
 * partially blocked run reports the reason it could not do everything.
 */
const resolveExitCode = (options: {
  dispatched: number;
  blockers: readonly GenerationPlanBlocker[];
}): number => {
  if (options.dispatched !== GENERATION_BATCH_EXIT_CODES.OK) {
    return options.dispatched;
  }
  if (options.blockers.some((blocker) => blocker.code === 'budget_exceeded')) {
    return GENERATION_BATCH_EXIT_CODES.BUDGET_REFUSED;
  }
  return options.blockers.length > 0
    ? GENERATION_BATCH_EXIT_CODES.BLOCKED_PLAN
    : GENERATION_BATCH_EXIT_CODES.OK;
};

/** `--status` hints: a reconciliation_required job is actionable, and says how. */
const statusWarnings = (jobs: BatchExecutionResult['jobs']): readonly GenerationPlanWarning[] =>
  jobs
    .filter((job) => job.status === 'reconciliation_required')
    .map((job) => ({
      code: 'job_reconciliation_required',
      itemId: job.itemId,
      message: `Job ${job.jobId} has an unresolved native handle — run --run --reconcile ${job.itemId}=<provider-completed|provider-cancelled|no-provider-work> before any new attempt. No new attempt is dispatched automatically.`,
    }));

/** Reads and strictly validates the authored brief. */
const readValidatedBrief = (manifestPath: string): AssetBrief => {
  if (!existsSync(manifestPath)) {
    throw new InvocationError(`--manifest file not found: ${manifestPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new InvocationError(`${manifestPath} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Value.Check(AssetBriefSchema, parsed)) {
    const first = [...Value.Errors(AssetBriefSchema, parsed)][0];
    throw new InvocationError(
      `${manifestPath} does not match the asset-brief schema: ${first?.instancePath || '/'} ${
        first?.message ?? 'unknown error'
      }`,
    );
  }
  return parsed;
};

const main = async (): Promise<number> => {
  let options: CliOptions | 'help';
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${(error as Error).message}\n\n${BATCH_USAGE}`);
    return GENERATION_BATCH_EXIT_CODES.INVALID_INVOCATION;
  }
  if (options === 'help') {
    console.error(BATCH_USAGE);
    return GENERATION_BATCH_EXIT_CODES.INVALID_INVOCATION;
  }

  let brief: AssetBrief;
  let briefSha256: string;
  try {
    brief = readValidatedBrief(options.manifestPath);
    briefSha256 = await sha256Hex(new Uint8Array(readFileSync(options.manifestPath)));
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    return GENERATION_BATCH_EXIT_CODES.INVALID_INVOCATION;
  }

  const phase = options.phase ?? brief.execution.defaultPhase;
  const runId = options.runId ?? makeRunId({ briefId: brief.id, phase });
  const paths: GenerationStorePaths = generationStorePaths({ runsDir: options.runsDir, runId });
  const modeFlag = MODE_FLAG[options.mode];

  if (options.mode === 'status' || options.mode === 'cancel') {
    if (!existsSync(paths.runRecordPath)) {
      const report = reportFor({
        kind: options.mode === 'status' ? 'generation-status' : 'generation-cancel',
        result: {
          jobs: [],
          engineRequests: 0,
          blockers: [],
          activeLeases: [],
          exitCode: GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT,
        },
        runId,
        runsDir: options.runsDir,
        briefId: brief.id,
        phase,
        message: `No run record for "${runId}" under ${options.runsDir}.`,
      });
      console.log(JSON.stringify(report, null, 2));
      return GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
    }
    const result =
      options.mode === 'status'
        ? readBatchStatus({
            paths,
            ...(options.itemId === undefined ? {} : { itemIds: [options.itemId] }),
          })
        : cancelBatch({
            paths,
            ...(options.itemId === undefined ? {} : { itemIds: [options.itemId] }),
          });
    const report = reportFor({
      kind: options.mode === 'status' ? 'generation-status' : 'generation-cancel',
      result,
      runId,
      runsDir: options.runsDir,
      briefId: brief.id,
      phase,
    });
    const enriched =
      options.mode === 'status'
        ? {
            ...report,
            // C-524: an unsettled hosted reservation is a live, auditable spend
            // — the run's own status names it and the remedy.
            warnings: [...statusWarnings(report.jobs), ...hostedReservationWarnings({ paths })],
          }
        : report;
    console.log(
      JSON.stringify(
        Value.Check(GenerationBatchReportSchema, enriched) ? enriched : report,
        null,
        2,
      ),
    );
    return result.exitCode;
  }

  if (options.importLegacy) {
    const legacy = importLegacyStaging({ legacyOutDir: options.legacyOutDir });
    if (legacy.error !== undefined) {
      console.error(`✗ --import-legacy found nothing usable: ${legacy.error}`);
      return GENERATION_BATCH_EXIT_CODES.INVALID_INVOCATION;
    }
    console.error(
      `• --import-legacy: ${legacy.tags.length} pre-existing staging tag(s) read from ${options.legacyOutDir} (read-only — nothing moved, rewritten or swept)`,
    );
  }

  // C-524: the host's hosted configuration. The adapter flag comes from the
  // explicit `--hosted-adapter` flag and/or `AIKAMI_HOSTED_ADAPTERS`; the
  // credential stays in the process environment and is never echoed.
  const hostedEnv = hostedEnvFor({ hostedAdapters: options.hostedAdapters, env: process.env });
  const hostedTransport =
    hostedEnv[ALLOW_TEST_SEAMS_ENV_VAR] === '1'
      ? hostedFixtureTransportFromEnv(hostedEnv)
      : undefined;

  const derivedPlan = await buildGenerationPlan({
    brief,
    briefPath: options.manifestPath,
    briefSha256,
    phase,
    resolveReference: (reference) => resolveBriefReference({ reference, rootDir: options.rootDir }),
    budgetOverrides: options.budgetOverrides,
    hostedAvailability: buildHostedAvailabilityResolver({
      env: hostedEnv,
      // The ceiling this invocation actually resolved, so a *declared* zero is
      // reported by the budget authority as `budget_exceeded` naming
      // `hostedBudgetUsd` — the exact number the creator has to raise — rather
      // than as a generic unavailability.
      hostedBudgetUsd: resolveBudget({ brief, overrides: options.budgetOverrides }).hostedBudgetUsd,
    }),
    ...(options.itemId === undefined ? {} : { onlyItemId: options.itemId }),
    ...(options.providerProfileId === undefined
      ? {}
      : { forcedProviderProfileId: options.providerProfileId }),
    ...(options.variation === undefined || options.itemId === undefined
      ? {}
      : { variation: { itemId: options.itemId, attempt: options.variation } }),
  });

  // A client-supplied request key replaces the derived one for the scoped
  // item; the store's request-key index then makes the whole operation
  // idempotent — a second submission of the same key resolves to one job.
  const plan =
    options.requestKey === undefined
      ? derivedPlan
      : {
          ...derivedPlan,
          items: derivedPlan.items.map((item) =>
            item.itemId === options.itemId
              ? { ...item, requestKey: options.requestKey as string }
              : item,
          ),
        };

  const warnings: GenerationPlanWarning[] = [...plan.warnings];
  if (options.importLegacy) {
    const legacy = importLegacyStaging({ legacyOutDir: options.legacyOutDir });
    warnings.push({
      code: 'legacy_staging_imported',
      message: `Read ${legacy.tags.length} pre-existing staging tag(s) from ${options.legacyOutDir} through the explicit --import-legacy opt-in; nothing in that directory was moved, rewritten or swept.`,
    });
  }

  if (options.mode === 'plan') {
    // stdout is the plan itself: sliceItems/expansionItems, every item, and the
    // structured blockers. `--plan` stops here — no engine, no staging write.
    console.log(
      JSON.stringify(
        {
          ...plan,
          ...(options.workflowProfileId === undefined
            ? {}
            : { workflowProfileId: options.workflowProfileId }),
          warnings,
        },
        null,
        2,
      ),
    );
    return plan.blockers.length > 0
      ? exitCodeForBlockedRequest(plan.blockers)
      : GENERATION_BATCH_EXIT_CODES.OK;
  }

  // --run / --resume
  if (options.mode === 'resume' && !existsSync(paths.runRecordPath)) {
    const report = reportFor({
      kind: 'generation-resume',
      result: {
        jobs: [],
        engineRequests: 0,
        blockers: [],
        activeLeases: [],
        exitCode: GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT,
      },
      runId,
      runsDir: options.runsDir,
      briefId: brief.id,
      phase,
      message: `No run record for "${runId}" under ${options.runsDir} — nothing to resume.`,
    });
    console.log(JSON.stringify(report, null, 2));
    return GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
  }

  const now = new Date().toISOString();
  const runRecord: GenerationRunRecord = {
    schemaVersion: 1,
    runId,
    briefId: brief.id,
    briefPath: options.manifestPath,
    briefSha256,
    phase,
    createdAt: now,
    updatedAt: now,
    budget: plan.budget,
    status: 'planned',
    jobIds: [],
  };

  // The run lock is written once and never silently replaced.
  ensureRun({ paths, record: runRecord });
  const lockWrite = writeRunLockImmutable({
    paths,
    lock: buildGenerationRunLock({ plan, runId, createdAt: now }),
  });
  if (lockWrite.conflict) {
    console.error(
      '✗ The run lock stored for this run differs from the one this invocation derived — refusing to overwrite it. Use --run-id to start a separate run.',
    );
    return GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
  }

  let reconciliation: BatchExecutionResult | undefined;
  if (options.reconcile) {
    reconciliation = reconcileJob({
      paths,
      itemId: options.reconcile.itemId,
      resolution: options.reconcile.resolution,
    });
    for (const report of reconciliation.jobs) {
      console.error(`• reconciled ${report.itemId}: ${report.status}`);
    }
  }

  const dispatchable = plan.items.filter((item) => item.dispatchable);
  const requestedItems =
    options.itemId === undefined
      ? dispatchable
      : dispatchable.filter((item) => item.itemId === options.itemId);

  if (requestedItems.length === 0) {
    const planBlockers =
      options.itemId === undefined
        ? plan.blockers
        : plan.blockers.filter((blocker) => blocker.itemId === options.itemId);
    const scopedBlockers = [...(reconciliation?.blockers ?? []), ...planBlockers];
    const report = reportFor({
      kind: options.mode === 'run' ? 'generation-run' : 'generation-resume',
      result: {
        jobs: reconciliation?.jobs ?? [],
        engineRequests: 0,
        blockers: scopedBlockers,
        activeLeases: reconciliation?.activeLeases ?? [],
        exitCode: exitCodeForBlockedRequest(scopedBlockers),
      },
      runId,
      runsDir: options.runsDir,
      briefId: brief.id,
      phase,
      plannedItems: plan.plannedItems,
      blockedItems: plan.blockedItems,
      message: `Nothing is dispatchable for ${modeFlag} — see blockers.`,
    });
    console.log(JSON.stringify({ ...report, warnings }, null, 2));
    return report.exitCode;
  }

  const preparationProfile =
    options.preparationProfileId === undefined
      ? undefined
      : requirePreparationProfile(options.preparationProfileId);

  const result = await executeBatch({
    paths,
    plan,
    engineFactory: buildEngineFactory({
      hostedEnv,
      ...(hostedTransport === undefined ? {} : { hostedTransport }),
      ...(options.engineUrl === undefined ? {} : { engineUrl: options.engineUrl }),
      ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
      repoRoot: options.rootDir,
      ...(options.workflowProfileId === undefined
        ? {}
        : { workflowProfileId: options.workflowProfileId }),
    }),
    // C-521: an owned/licensed recording is read only from inside this root.
    audioImportRoot: join(options.rootDir, DEFAULT_AUDIO_IMPORT_ROOT_RELATIVE),
    ...(hostedTransport === undefined ? {} : { hostedProvenance: 'test-fixture' as const }),
    ...(options.itemId === undefined ? {} : { itemIds: [options.itemId] }),
    ...(options.variation === undefined || options.itemId === undefined
      ? {}
      : { variation: { itemId: options.itemId, attempt: options.variation } }),
    ...(preparationProfile === undefined
      ? {}
      : {
          prepare: buildPreparationHook({
            preparationProfile,
            onRejected: (message) => console.error(message),
          }),
        }),
    onRawPersisted: () => {
      // Test seam only (never documented as a feature): kill the process after
      // the raw bytes are durable, to exercise resume-across-crash.
      if (process.env.AIKAMI_BATCH_TEST_CRASH === 'after-raw') {
        console.error('• test crash hook: exiting after raw persist');
        process.exit(137);
      }
    },
    onStagingWrite: (name) => {
      if (process.env.AIKAMI_BATCH_TEST_CRASH === `after-${name}`) {
        console.error(`• test crash hook: exiting after the ${name} write`);
        process.exit(137);
      }
    },
  });

  // Plan blockers that this invocation did not dispatch are still part of the
  // result: a partially blocked run says so instead of pretending success.
  const scopeBlockers =
    options.itemId === undefined
      ? plan.blockers
      : plan.blockers.filter((blocker) => blocker.itemId === options.itemId);
  const mergedBlockers = [
    ...(reconciliation?.blockers ?? []),
    ...result.blockers,
    ...scopeBlockers,
  ];
  const exitCode = resolveExitCode({
    dispatched: result.exitCode,
    blockers: mergedBlockers,
  });

  const report = reportFor({
    kind: options.mode === 'run' ? 'generation-run' : 'generation-resume',
    result: { ...result, blockers: mergedBlockers, exitCode },
    runId,
    runsDir: options.runsDir,
    briefId: brief.id,
    phase,
    plannedItems: plan.plannedItems,
    blockedItems: plan.blockedItems,
  });

  // C-520: record which versioned profiles this run used, and persist the
  // media-validation reports beside the run. A prepared artifact without its
  // report is an unexplained hash change; the report is the auditable reason.
  // The profile observations describe what the run actually did, so they are
  // emitted after the result is known: a profile selected for a run where
  // nothing was dispatched (or nothing was prepared) is not reported as
  // "applied" — that would be a false claim in the machine-readable report.
  const mediaValidations = result.mediaValidations ?? [];
  warnings.push(
    ...profileWarnings({
      ...(options.workflowProfileId === undefined
        ? {}
        : { workflowProfileId: options.workflowProfileId }),
      ...(options.preparationProfileId === undefined
        ? {}
        : { preparationProfileId: options.preparationProfileId }),
      runsDir: options.runsDir,
      runId,
      engineRequests: result.engineRequests,
      preparedArtifacts: mediaValidations.length,
    }),
  );

  if (mediaValidations.length > 0) {
    writeMediaValidationFile({
      runDir: paths.runDir,
      runId,
      ...(options.preparationProfileId === undefined
        ? {}
        : { preparationProfileId: options.preparationProfileId }),
      validations: mediaValidations,
    });
  }

  console.log(JSON.stringify({ ...report, warnings }, null, 2));
  return exitCode;
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(`\n✗ ${(error as Error).message}`);
    process.exit(GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR);
  });
