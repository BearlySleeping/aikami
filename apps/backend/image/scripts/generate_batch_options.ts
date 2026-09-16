// apps/backend/image/scripts/generate_batch_options.ts
//
// C-519/C-524: the `generate:batch` invocation parser.
//
// Extracted from `generate_batch.ts` so the CLI's entry point stays about the
// *run* — plan, dispatch, report — rather than about argv. It owns exactly one
// responsibility: turn argv into a validated `CliOptions`, or throw an
// `InvocationError` the entry point maps to the documented exit code.
//
// Contract: C-519 Durable asset jobs and batch execution;
//           C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: CLI flag names and the brief's snake_case budget keys are wire vocabulary, not TypeScript identifiers */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  DEFAULT_BATCH_LEGACY_OUT_DIR_RELATIVE,
  DEFAULT_BATCH_RUNS_DIR_RELATIVE,
} from '@aikami/constants';
import type { GenerationBudget } from '@aikami/types';
import { findRepoRoot } from './generate_batch_engines.ts';

const IMAGE_APP_DIR = resolve(import.meta.dir, '..');

/** The modes the CLI accepts (exactly one). */
export type BatchMode = 'plan' | 'run' | 'resume' | 'status' | 'cancel';

/** How a reconciliation is resolved. */
export type ReconciliationResolution =
  | 'provider-completed'
  | 'provider-cancelled'
  | 'no-provider-work';

/** Parsed invocation. */
export type CliOptions = {
  manifestPath: string;
  phase?: 'slice' | 'expansion';
  mode: BatchMode;
  runId?: string;
  runsDir: string;
  legacyOutDir: string;
  importLegacy: boolean;
  itemId?: string;
  variation?: number;
  providerProfileId?: string;
  requestKey?: string;
  engineUrl?: string;
  /** C-520: pinned image-workflow profile id (ComfyUI only). */
  workflowProfileId?: string;
  /** C-520: deterministic preparation profile id. */
  preparationProfileId?: string;
  rootDir: string;
  timeoutSeconds?: number;
  budgetOverrides: Partial<GenerationBudget>;
  /**
   * C-524: hosted transports this invocation explicitly enables, merged with
   * the `AIKAMI_HOSTED_ADAPTERS` environment value. Absent/empty enables
   * nothing — a hosted dispatch is then a typed unavailability.
   */
  hostedAdapters: readonly string[];
  reconcile?: { itemId: string; resolution: ReconciliationResolution };
};

/** The mode flag each mode is selected by. */
export const MODE_FLAG: Readonly<Record<BatchMode, string>> = {
  plan: '--plan',
  run: '--run',
  resume: '--resume',
  status: '--status',
  cancel: '--cancel',
};

/** The flag that carries each mode's run id (only resume/status/cancel do). */
export const MODE_RUN_ID_FLAG: Readonly<Record<BatchMode, string | undefined>> = {
  plan: undefined,
  run: undefined,
  resume: '--resume',
  status: '--status',
  cancel: '--cancel',
};

/** Flags that take no value. */
export const BOOLEAN_FLAGS = new Set(['--plan', '--run', '--help', '--import-legacy']);

/** Flags that take a value. */
export const VALUE_FLAGS = new Set([
  '--manifest',
  '--phase',
  '--resume',
  '--status',
  '--cancel',
  '--runs-dir',
  '--out',
  '--item',
  '--variation',
  '--provider',
  '--request-key',
  '--run-id',
  '--reconcile',
  '--engine-url',
  '--workflow-profile',
  '--preparation-profile',
  '--root',
  '--timeout',
  '--hosted-budget-usd',
  '--budget-duration',
  '--budget-pixels',
  '--budget-retained-bytes',
  '--hosted-adapter',
]);

/** Thrown for a bad invocation — mapped to the documented exit code. */
/** Thrown for a bad invocation — mapped to the documented exit code. */
export class InvocationError extends Error {}

const readFlag = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new InvocationError(`${flag} requires a value`);
  }
  return value;
};

const readNumberFlag = (args: readonly string[], flag: string): number | undefined => {
  const raw = readFlag(args, flag);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new InvocationError(`${flag} must be a finite number (got "${raw}")`);
  }
  return value;
};

const readPositiveIntegerFlag = (args: readonly string[], flag: string): number | undefined => {
  const value = readNumberFlag(args, flag);
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvocationError(`${flag} must be a positive integer (got "${value}")`);
  }
  return value;
};

export const parseOptions = (argv: readonly string[]): CliOptions | 'help' => {
  if (argv.includes('--help') || argv.length === 0) {
    return 'help';
  }
  for (const arg of argv) {
    if (arg.startsWith('--') && !BOOLEAN_FLAGS.has(arg) && !VALUE_FLAGS.has(arg)) {
      throw new InvocationError(`Unknown flag "${arg}"`);
    }
  }

  const manifestRaw = readFlag(argv, '--manifest');
  if (manifestRaw === undefined) {
    throw new InvocationError('--manifest <path> is required');
  }

  const phaseRaw = readFlag(argv, '--phase');
  if (phaseRaw !== undefined && phaseRaw !== 'slice' && phaseRaw !== 'expansion') {
    throw new InvocationError(`--phase must be "slice" or "expansion" (got "${phaseRaw}")`);
  }

  const modes: readonly { flag: string; mode: BatchMode }[] = [
    { flag: '--plan', mode: 'plan' },
    { flag: '--run', mode: 'run' },
    { flag: '--resume', mode: 'resume' },
    { flag: '--status', mode: 'status' },
    { flag: '--cancel', mode: 'cancel' },
  ];
  const selected = modes.filter((entry) => argv.includes(entry.flag));
  if (selected.length > 1) {
    throw new InvocationError(
      `Exactly one mode flag is allowed (got ${selected.map((entry) => entry.flag).join(', ')})`,
    );
  }
  const mode = selected[0]?.mode ?? 'plan';
  const modeFlag = selected[0]?.flag;
  const runIdFlag = MODE_RUN_ID_FLAG[mode];
  const runId = runIdFlag === undefined ? readFlag(argv, '--run-id') : readFlag(argv, runIdFlag);
  if ((mode === 'resume' || mode === 'status' || mode === 'cancel') && runId === undefined) {
    throw new InvocationError(`${modeFlag ?? '--resume'} requires a run id`);
  }

  const itemId = readFlag(argv, '--item');
  const variation = readPositiveIntegerFlag(argv, '--variation');
  if (variation !== undefined && itemId === undefined) {
    throw new InvocationError(
      '--variation requires --item (a variation belongs to one brief item)',
    );
  }
  if (variation !== undefined && variation < 2) {
    throw new InvocationError('--variation must be at least 2 (attempt 1 is the first submission)');
  }

  const reconcileRaw = readFlag(argv, '--reconcile');
  let reconcile: CliOptions['reconcile'];
  if (reconcileRaw !== undefined) {
    if (mode !== 'run') {
      throw new InvocationError('--reconcile is used with --run');
    }
    const [reconcileItem, resolution] = reconcileRaw.split('=', 2);
    if (
      reconcileItem === undefined ||
      (resolution !== 'provider-completed' &&
        resolution !== 'provider-cancelled' &&
        resolution !== 'no-provider-work')
    ) {
      throw new InvocationError(
        `--reconcile must be <itemId>=<provider-completed|provider-cancelled|no-provider-work> (got "${reconcileRaw}")`,
      );
    }
    reconcile = { itemId: reconcileItem, resolution };
  }

  const timeoutSeconds = readPositiveIntegerFlag(argv, '--timeout');
  const hostedBudgetUsd = readNumberFlag(argv, '--hosted-budget-usd');
  const budgetDuration = readNumberFlag(argv, '--budget-duration');
  const budgetPixels = readNumberFlag(argv, '--budget-pixels');
  const budgetRetainedBytes = readNumberFlag(argv, '--budget-retained-bytes');
  const hostedAdapterRaw = readFlag(argv, '--hosted-adapter');
  const hostedAdapters = (hostedAdapterRaw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const providerProfileId = readFlag(argv, '--provider');
  const requestKey = readFlag(argv, '--request-key');
  if (requestKey !== undefined && itemId === undefined) {
    throw new InvocationError(
      '--request-key requires --item: a client request key identifies one submission',
    );
  }
  const engineUrl = readFlag(argv, '--engine-url');
  const workflowProfileId = readFlag(argv, '--workflow-profile');
  const preparationProfileId = readFlag(argv, '--preparation-profile');
  const rootRaw = readFlag(argv, '--root');
  const runsDirRaw = readFlag(argv, '--runs-dir');
  const legacyOutRaw = readFlag(argv, '--out');

  return {
    manifestPath: resolveInputPath(manifestRaw),
    ...(phaseRaw === undefined ? {} : { phase: phaseRaw }),
    mode,
    ...(runId === undefined ? {} : { runId }),
    runsDir: runsDirRaw
      ? resolve(runsDirRaw)
      : join(IMAGE_APP_DIR, DEFAULT_BATCH_RUNS_DIR_RELATIVE),
    legacyOutDir: legacyOutRaw
      ? resolve(legacyOutRaw)
      : join(IMAGE_APP_DIR, DEFAULT_BATCH_LEGACY_OUT_DIR_RELATIVE),
    importLegacy: argv.includes('--import-legacy'),
    ...(itemId === undefined ? {} : { itemId }),
    ...(variation === undefined ? {} : { variation }),
    ...(providerProfileId === undefined ? {} : { providerProfileId }),
    ...(requestKey === undefined ? {} : { requestKey }),
    ...(engineUrl === undefined ? {} : { engineUrl }),
    ...(workflowProfileId === undefined ? {} : { workflowProfileId }),
    ...(preparationProfileId === undefined ? {} : { preparationProfileId }),
    rootDir: rootRaw ? resolve(rootRaw) : findRepoRoot(resolve(manifestRaw)),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    budgetOverrides: {
      ...(hostedBudgetUsd === undefined ? {} : { hostedBudgetUsd }),
      ...(budgetDuration === undefined ? {} : { maxDurationSeconds: budgetDuration }),
      ...(budgetPixels === undefined ? {} : { maxPixels: budgetPixels }),
      ...(budgetRetainedBytes === undefined ? {} : { maxRetainedBytes: budgetRetainedBytes }),
    },
    hostedAdapters,
    ...(reconcile === undefined ? {} : { reconcile }),
  };
};

/**
 * Resolves a user-supplied file path.
 *
 * A relative `--manifest` is tried against the current directory and then
 * against the repository root, because the documented invocation runs through
 * `bun run --cwd apps/backend/image`, where a repo-relative brief path would
 * otherwise not resolve.
 */
const resolveInputPath = (raw: string, mustExist = true): string => {
  if (isAbsolute(raw)) {
    return resolve(raw);
  }
  const fromCwd = resolve(raw);
  if (!mustExist || existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromRepoRoot = resolve(findRepoRoot(process.cwd()), raw);
  return existsSync(fromRepoRoot) ? fromRepoRoot : fromCwd;
};
