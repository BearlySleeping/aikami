#!/usr/bin/env bun
// scripts/src/lib/ops/run_guards.ts
//
// Fast, Moon-free runner for the structural guard aggregate.
//
// Used by the pre-commit hook (ops/pre_commit.ts) and pi's `validate` tool so
// the guards CI enforces are caught before a commit, not after a push.
//
// 🔴 Why not `moon run scripts:guard`. Every whole-repo guard declares
// `@group(guard-scan)` as its inputs, and Moon hashes that entire tree even
// with `cache: false`. Measured on 2026-09-23: `moon run scripts:guard` takes
// ~34s; the same ten guard scripts spawned directly and in parallel take
// ~1.5s. The verdict is identical — the Moon task only adds hashing.
//
// The guard set is read from the registry (ops/guards/registry.ts), so a new
// aggregate guard is picked up here without editing this file.
//
// Usage:
//   bun run scripts/src/lib/ops/run_guards.ts          # human output
//   bun run scripts/src/lib/ops/run_guards.ts --json   # machine output (pi)
// Exits non-zero when any guard fails.

import { resolve } from 'node:path';
import { aggregateGuards, type GuardMeta } from './guards/registry.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

export type GuardRunResult = {
  id: string;
  label: string;
  task: string;
  code: number;
  durationMs: number;
  output: string;
  remediation: string;
};

const runOne = async (guard: GuardMeta): Promise<GuardRunResult> => {
  const startedAt = performance.now();
  const proc = Bun.spawn(['bun', 'run', guard.script], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    // CI-only annotation output would be noise in a hook.
    env: { ...process.env, AIKAMI_CI_ANNOTATIONS: 'off' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    id: guard.id,
    label: guard.label,
    task: guard.task,
    code,
    durationMs: Math.round(performance.now() - startedAt),
    output: `${stdout}${stderr}`.trim(),
    remediation: guard.remediation,
  };
};

/** Run every aggregate guard in parallel. */
export const runGuards = async (
  options: { guards?: readonly GuardMeta[] } = {},
): Promise<GuardRunResult[]> =>
  Promise.all((options.guards ?? aggregateGuards()).map((guard) => runOne(guard)));

/** Keep a failing guard's diagnostic lines, drop the ⚠️ warning wall. */
const failureLines = (output: string): string =>
  output
    .split('\n')
    .filter((line) => !line.includes('⚠️'))
    .join('\n')
    .trim();

/** Render failed guards for a terminal or an agent prompt. */
export const formatGuardFailures = (results: readonly GuardRunResult[]): string =>
  results
    .filter((result) => result.code !== 0)
    .map((result) =>
      [
        `### ❌ ${result.label} (${result.task})`,
        failureLines(result.output),
        `→ Fix: ${result.remediation}`,
      ].join('\n'),
    )
    .join('\n\n');

/** Match a repository-relative path after normalizing Windows guard output. */
export const guardOutputNamesPath = (options: { output: string; path: string }): boolean =>
  options.output.replaceAll('\\', '/').includes(options.path);

if (import.meta.main) {
  const results = await runGuards();
  const failed = results.filter((result) => result.code !== 0);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }));
  } else if (failed.length === 0) {
    const slowest = Math.max(...results.map((result) => result.durationMs));
    console.log(`✅ ${results.length} structural guards passed (${slowest}ms)`);
  } else {
    console.error(formatGuardFailures(results));
    console.error(`\n🔴 ${failed.length}/${results.length} structural guard(s) failed`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}
