// scripts/src/lib/ops/emberwatch_release_io.ts
//
// The I/O half of the Emberwatch release orchestrator: the step ledger, the
// remote pointer read, and the release-artifact writers.
//
// Extracted from `emberwatch_release.ts` so that file can be what its name
// says — a CLI shell over typed phases — instead of a mix of phase logic and
// console formatting. Nothing here decides anything about a release; it records
// what happened and persists the evidence.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReleaseReceipt } from '@aikami/schemas';

/** Repo root, from this module's directory. */
const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Overrides where release artifacts are read and written.
 *
 * A TEST SEAM, and a deliberately weak one: it moves the candidate lock, the
 * receipts and the reports, and nothing else. It cannot weaken a gate — the
 * staging approval still has to resolve against the real staging origin, and
 * the target still comes from the fail-closed release-target table — so a
 * forged receipt in an overridden plane fails exactly as a forged receipt in
 * the real one does.
 */
export const RELEASE_PLANE_ENV = 'AIKAMI_RELEASE_PLANE';

/** Where candidate locks, receipts and release reports live. */
export const releasePlaneDir = (): string =>
  process.env[RELEASE_PLANE_ENV] ?? join(REPOSITORY, '.local/releases');

/** One executed (or deliberately skipped) orchestrator step. */
export type StepResult = {
  name: string;
  command: string;
  status: 'ok' | 'failed' | 'skipped';
  exitCode: number;
  durationMs: number;
  detail?: string;
};

const icon = (status: StepResult['status']): string => {
  if (status === 'skipped') {
    return '⏭️';
  }
  return status === 'failed' ? '❌' : '✅';
};

export type StepRecorder = {
  readonly steps: StepResult[];
  record: (entry: StepResult) => void;
  skipped: (name: string, command: string) => void;
  run: (name: string, command: string, args: string[], options?: { cwd?: string }) => StepResult;
  bun: (name: string, script: string, args?: string[]) => StepResult;
  git: (args: string[]) => string;
};

/** Creates the ledger every step appends to, and the process runners it uses. */
export const createStepRecorder = (repository: string): StepRecorder => {
  const steps: StepResult[] = [];

  const record = (entry: StepResult): void => {
    steps.push(entry);
    console.log(
      `${icon(entry.status)} ${entry.name} (${entry.durationMs}ms)${entry.detail ? ` — ${entry.detail}` : ''}`,
    );
  };

  const run = (
    name: string,
    command: string,
    args: string[],
    options: { cwd?: string } = {},
  ): StepResult => {
    const started = Date.now();
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? repository,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const exitCode = result.status ?? 1;
    const failureDetail = `${(result.stderr ?? result.stdout ?? '').trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`;
    const entry: StepResult = {
      name,
      command: [command, ...args].join(' '),
      status: exitCode === 0 ? 'ok' : 'failed',
      exitCode,
      durationMs: Date.now() - started,
      ...(exitCode === 0 ? {} : { detail: failureDetail }),
    };
    record(entry);
    return entry;
  };

  return {
    steps,
    record,
    skipped: (name, command) =>
      record({ name, command, status: 'skipped', exitCode: 0, durationMs: 0 }),
    run,
    bun: (name, script, args = []) => run(name, 'bun', [script, ...args]),
    git: (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim(),
  };
};

export type ReleasePointer = {
  key: string;
  sha256?: string;
  body?: unknown;
  status: number;
};

/** Reads the currently published release pointer over the public origin. */
export const readReleasePointer = async (originUrl: string): Promise<ReleasePointer> => {
  const key = 'index/v1/release.json';
  try {
    const response = await fetch(`${originUrl.replace(/\/$/, '')}/${key}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { key, status: response.status };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    return {
      key,
      sha256: digest,
      body: JSON.parse(new TextDecoder().decode(bytes)),
      status: response.status,
    };
  } catch (error) {
    return { key, status: 0, body: { error: (error as Error).message } };
  }
};

export type ReleaseReportInput = {
  repository: string;
  sourceCommit: string;
  packVersion: string;
  mode: string;
  apply: boolean;
  dirtyWorktree: boolean;
  dirtyWorktreeAllowed: boolean;
  config: { bucket: string; originUrl: string };
  previous: ReleasePointer;
  after?: ReleasePointer;
  steps: readonly StepResult[];
  /** The candidate this run published, when it got that far. */
  candidateLockHash?: string;
  releasePlanHash?: string;
  receiptPath?: string;
};

export const buildReleaseReport = (options: ReleaseReportInput): Record<string, unknown> => ({
  schemaVersion: 1,
  kind: 'emberwatch-release-report',
  sourceCommit: options.sourceCommit,
  packVersion: options.packVersion,
  bucket: options.config.bucket,
  originUrl: options.config.originUrl,
  mode: options.mode,
  applied: options.apply,
  dirtyWorktree: options.dirtyWorktree,
  dirtyWorktreeAllowed: options.dirtyWorktreeAllowed,
  generatedAt: new Date().toISOString(),
  previousRelease: {
    key: options.previous.key,
    sha256: options.previous.sha256 ?? null,
    status: options.previous.status,
  },
  newRelease:
    options.after === undefined
      ? null
      : {
          key: options.after.key,
          sha256: options.after.sha256 ?? null,
          status: options.after.status,
        },
  candidateLockHash: options.candidateLockHash ?? null,
  releasePlanHash: options.releasePlanHash ?? null,
  receiptPath: options.receiptPath ?? null,
  steps: options.steps,
});

/** The release report is a moment-in-time artifact; its name is the timestamp. */
export const reportPath = (mode: string): string =>
  join(releasePlaneDir(), mode, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

export const writeReleaseReport = (options: {
  mode: string;
  report: Record<string, unknown>;
}): string => {
  const path = reportPath(options.mode);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(options.report, null, 2)}\n`);
  return path;
};

/**
 * Persists the release receipt beneath the release-artifact hierarchy.
 *
 * The receipt is the one artifact a promotion reads: it is written for degraded
 * post-activation outcomes too, because "the pointer moved and the alias did
 * not" must be recorded rather than discovered later.
 */
export const writeReceipt = (options: {
  releasePlane: string;
  mode: string;
  receipt: ReleaseReceipt;
}): string => {
  const path = join(options.releasePlane, `receipt-${options.mode}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(options.receipt, null, 2)}\n`);
  return path;
};
