// scripts/src/lib/agents/contract_pipeline/base_health.ts
//
// Base-health preflight: are the structural guards already red on the base
// the run branched from?
//
// 🔴 Why this exists. PR #386 (C-545) went red in CI on
// `guard-source-file-size` for ecs_worker.ts — a file the run never touched.
// A direct push to main (71678c0b8) had grown it past its waiver 8 hours
// earlier. The pre-push gate saw the failure but could only report it as this
// branch's failure; the agent spent effort proving it wasn't its fault and
// the PR was opened red anyway.
//
// Checking once, before the first implement attempt (the worktree is still at
// the base), turns that into an up-front, correctly-attributed signal: it is
// recorded as an infra issue, which the review prompt already renders as
// "report, don't fix" — so the captain knows the red guard is inherited.
//
// 🔴 `node:`-only, like pre_push_gate.ts — reached through the pi bridge.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { reportInfraIssue } from '../../ops/infra_report.ts';

const RUNNER = 'scripts/src/lib/ops/run_guards.ts';

export type BaseHealth = { outcome: 'green' | 'red' | 'unavailable'; output: string };

/**
 * A command runner, injectable so tests never shell out — the same shape as
 * `pre_push_gate.ts`'s `GateRunner`.
 */
export type BaseHealthRunner = (options: { cwd: string }) => {
  status: number | null;
  output: string;
  spawnFailed: boolean;
};

const defaultRunner: BaseHealthRunner = ({ cwd }) => {
  const result = spawnSync('bun', ['run', RUNNER], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: 2 * 60 * 1000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    spawnFailed: !!result.error,
  };
};

export const checkBaseHealth = (options: {
  cwd: string;
  runId?: string;
  runner?: BaseHealthRunner;
  /** Injectable filesystem check — see the "not present" branch below. */
  runnerExists?: (cwd: string) => boolean;
}): BaseHealth => {
  const runnerExists = options.runnerExists ?? ((cwd) => existsSync(join(cwd, RUNNER)));
  // A worktree branched before run_guards.ts existed has nothing to run.
  if (!runnerExists(options.cwd)) {
    return { outcome: 'unavailable', output: `${RUNNER} not present in this tree` };
  }
  const result = (options.runner ?? defaultRunner)({ cwd: options.cwd });
  const output = result.output;
  if (result.spawnFailed || result.status === null) {
    return { outcome: 'unavailable', output };
  }
  if (result.status === 0) {
    return { outcome: 'green', output };
  }

  console.warn(
    '\n🔴 BASE IS RED — structural guards already fail on the base this run branched from.\n' +
      '   These failures are NOT caused by this contract; CI will still fail the PR on them.\n' +
      '   Fix main in its own commit, then resume.\n',
  );
  console.warn(output);
  reportInfraIssue({
    component: 'base_health',
    operation: 'structural guards on base',
    error: new Error(`Structural guards are red on the base before any change:\n${output}`),
    context: { cwd: options.cwd },
    cwd: options.cwd,
    runId: options.runId,
  });
  return { outcome: 'red', output };
};
