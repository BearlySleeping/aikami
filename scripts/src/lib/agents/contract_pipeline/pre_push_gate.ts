// scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts
//
// The pipeline's stand-in for the pre-commit hook.
//
// 🔴 Why this exists. Every commit path in the contract pipeline passes
// `--no-verify` — `commitAll` (agents/git_worktree.ts) and the per-stage
// checkpoint in .pi/extensions/contract_pipeline.ts. That is deliberate:
// checkpoints must stay fast, and ops/pre_commit.ts does docs/contract-sync
// work that must not run inside a worktree. The consequence, though, is that
// NOTHING in a pipeline run ever runs lint, format or typecheck. The
// `node_modules/.bin` symlink in herdr/worktree.ts makes the hook *able* to
// run in a worktree, but it only fires for an agent that runs `git commit`
// itself — and the agents don't; the orchestrator sweeps their edits up.
//
// C-464 (PR #240) is what that costs: five red CI targets — client:lint,
// client:format, hub:format, types:format, e2e:format — every one of them
// Biome format/lint on freshly written files, every one auto-fixable, and
// all of them chased down by hand in three follow-up commits after the PR
// was already open.
//
// So the check moves to the one place it belongs: once, in the worktree,
// after the verifier passes and before the branch is pushed.
//
// 🔴 Node-only. No `Bun.*`, no import of cli_utils.ts — this module is
// reachable from orchestrator.ts, which .pi/extensions/* loads under Node.
// See scripts/src/lib/env/runtime_boundary.test.ts.
import { spawnSync } from 'node:child_process';
import { reportInfraIssue } from '../../ops/infra_report.ts';
import { getRequiredChecks } from './validation_policy.ts';

/** Cap on the diagnostics carried into the review prompt. */
export const MAX_GATE_OUTPUT_CHARS = 4000;

/**
 * Outcome of running the pipeline's pre-push validation gate.
 *
 * AC-4: Failed or unavailable checks prevent promotion.
 * The `unavailable` field distinguishes "checks ran and passed" from
 * "checks could not be run" — the latter is an infrastructure issue that
 * must still block promotion, not silently convert to ok.
 */
export type PrePushGateResult = {
  /**
   * Whether the gate actually reached a verdict. False means the gate could
   * not run (moon missing, base ref unresolvable) — reported as an infra
   * issue and treated as `ok`, because a broken gate must never block a run.
   */
  ran: boolean;
  /**
   * True when `:validate` is green, or when the gate could not run.
   *
   * AC-4: When checks are unavailable (could not run but infrastructure is
   * fine), this is false — unavailable checks must prevent promotion.
   */
  ok: boolean;
  /**
   * True when the gate ran but one or more required checks could not be
   * executed (e.g. moon binary found but task definition missing).
   * AC-4: unavailable checks prevent promotion.
   */
  unavailable?: boolean;
  /** Combined stdout+stderr of the failing step, truncated. Empty when ok. */
  output: string;
};

/**
 * A command runner, injectable so tests never shell out.
 * Returns the exit status plus combined output.
 */
export type GateRunner = (options: { command: string; args: string[]; cwd: string }) => {
  status: number | null;
  output: string;
  spawnFailed: boolean;
};

const defaultRunner: GateRunner = ({ command, args, cwd }) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // Windows: `bun` may resolve through a .cmd shim.
    shell: process.platform === 'win32',
    windowsHide: true,
    // moon streams a lot; a generous cap beats a truncated diagnosis.
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status, output, spawnFailed: !!result.error };
};

const truncate = (text: string): string =>
  text.length <= MAX_GATE_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_GATE_OUTPUT_CHARS)}\n… (${text.length - MAX_GATE_OUTPUT_CHARS} more characters truncated)`;

const GATE_SETUP_FAILURE_PATTERNS = [
  /(?:script|module) not found ["'`]?moon\b/i,
  /\bmoon(?:\.cmd|\.exe)?: (?:command )?not found\b/i,
  /fatal: (?:ambiguous argument|bad revision|bad object)/i,
  /unknown revision or path not in the working tree/i,
  /invalid (?:base|reference|revision).*--base/i,
] as const satisfies readonly RegExp[];

/** Identify failures that prevent Moon from reaching project validation. */
const isGateSetupFailure = (output: string): boolean =>
  GATE_SETUP_FAILURE_PATTERNS.some((pattern) => pattern.test(output));

/**
 * Auto-fix, then verify, the code about to be pushed.
 *
 * Step 1 — `moon run :fix` — is the one that pays for itself: format and lint
 * are auto-fixable, and they are what actually leaks. The edits land in the
 * working tree BEFORE the caller's `commitAll`, so they ride into that same
 * commit rather than needing a follow-up.
 *
 * Step 2 — `moon run :validate` — is lint + format + typecheck (the meta-task
 * in .moon/tasks/all.yml), the same set CI's `moon ci` runs, scoped to the
 * PR's diff by `--affected --base`. Tests and builds are deliberately NOT
 * here: they are slow, they are already the verifier's job, and they were not
 * what leaked.
 *
 * 🔴 A failing gate is not a failing run. The caller pushes anyway (a branch
 * push triggers no CI — pr-checks.yml fires on `pull_request` and pushes to
 * `main`) and hands `output` to the review captain as a must-fix before the
 * PR is opened.
 */
export const runPrePushGate = (options: {
  cwd: string;
  /** Base to diff against, e.g. `origin/main`. */
  base: string;
  runId?: string;
  runner?: GateRunner;
  /**
   * Validation profile to use. Defaults to 'pre_publication'.
   * AC-2: Consumers share the check policy.
   */
  profile?: import('./validation_policy.ts').ValidationProfile;
}): PrePushGateResult => {
  const run = options.runner ?? defaultRunner;
  const affected = ['--affected', `--base=${options.base}`];
  const profile = options.profile ?? 'pre_publication';

  // AC-2: Derive required checks from shared policy
  const policyChecks = getRequiredChecks(profile);
  // Use policy to determine which steps to run. Map policy checks to steps.
  const steps: { label: string; args: readonly string[]; verdict: boolean }[] = [];

  // `:fix` failing is not a verdict — the following `:validate` is. A fix
  // task can exit non-zero on a lint rule it cannot auto-fix, which is
  // exactly the case validate is there to report properly.
  if (policyChecks.some((c) => c.task === ':fix')) {
    steps.push({
      label: ':fix',
      args: ['moon', 'run', ':fix', ...affected, '--concurrency', '8'],
      verdict: false,
    });
  }

  // Add validate step (the actual verdict gate)
  steps.push({
    label: ':validate',
    args: ['moon', 'run', ':validate', ...affected],
    verdict: true,
  });

  for (const step of steps) {
    const result = run({ command: 'bun', args: [...step.args], cwd: options.cwd });

    // 🔴 Distinguish "the gate found problems" from "the gate could not run".
    // A missing moon binary or an unresolvable base ref is an infrastructure
    // failure, and silently reporting it as a code problem would send the
    // review captain hunting for lint errors that do not exist.
    if (result.spawnFailed || (result.status !== 0 && isGateSetupFailure(result.output))) {
      reportInfraIssue({
        component: 'pre_push_gate',
        operation: `bun ${step.args.join(' ')}`,
        error: new Error(`Could not run the ${step.label} step: ${truncate(result.output)}`),
        context: { cwd: options.cwd, base: options.base },
        cwd: options.cwd,
        runId: options.runId,
      });
      return { ran: false, ok: true, output: '' };
    }

    if (!step.verdict) {
      continue;
    }
    if (result.status !== 0) {
      return { ran: true, ok: false, output: truncate(result.output) };
    }
  }

  return { ran: true, ok: true, output: '' };
};

/**
 * Render a failed gate for the review captain's prompt.
 *
 * 🔴 Framed as must-fix, unlike the infra notes it sits beside in
 * orchestrator.ts. Those are explicitly "report, don't fix" — a record of
 * what the pipeline worked around. This is the opposite: real diagnostics on
 * the code in the branch, which CI will repeat verbatim the moment a PR
 * exists.
 *
 * AC-4: Unavailable checks are distinguished from known-failing checks so
 * the captain can decide whether to fix the code or the infrastructure.
 */
export const formatGateNotesForPrompt = (result: PrePushGateResult | undefined): string => {
  if (!result || result.ok) {
    return '';
  }
  const header = result.unavailable
    ? '## 🔴 Pre-push validation UNAVAILABLE — required checks could not run'
    : '## 🔴 Pre-push validation FAILED — fix before opening the PR';
  const body = result.unavailable
    ? [
        '',
        'The branch was pushed (a branch push runs no CI), but one or more required',
        'checks could not be executed. This may be an infrastructure issue (missing',
        'task definitions, broken toolchain) or a code issue that prevents the check',
        'from running. Check the output below and resolve before opening the PR.',
      ]
    : [
        '',
        'The branch was pushed (a branch push runs no CI), but `moon run :validate`',
        'is red on it. Opening a PR now puts these same failures on the PR check.',
        'Fix them in the worktree, commit, push, and only then create the PR.',
      ];
  return [
    '',
    header,
    ...body,
    '',
    'Reproduce with: `bun moon run :fix --affected` then `bun moon run :validate --affected`',
    '',
    '```',
    result.output,
    '```',
    '',
  ].join('\n');
};
