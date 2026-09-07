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

const truncate = (text: string, limit: number = MAX_GATE_OUTPUT_CHARS): string =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n… (${text.length - limit} more characters truncated)`;

/**
 * Named tasks that make up the `:validate` aggregate (see
 * `.moon/tasks/all.yml`'s `validate` task and `scripts/moon.yml`'s `guard`
 * task). Kept in sync by hand — these are stable structural targets, not
 * derived from the affected-file graph, so there is no single source to
 * read them from at runtime without shelling out to `moon` again.
 */
const VALIDATE_CONSTITUENT_TASKS = [
  { task: ':lint', label: 'Lint' },
  { task: ':format', label: 'Format' },
  { task: ':typecheck', label: 'Typecheck' },
  { task: 'scripts:guard-mvvm-conventions', label: 'Guard: MVVM conventions' },
  { task: 'scripts:guard-service-conventions', label: 'Guard: service conventions' },
  { task: 'scripts:guard-service-mock-coverage', label: 'Guard: service mock coverage' },
  { task: 'scripts:guard-image-component', label: 'Guard: image component' },
  { task: 'scripts:guard-data-plane', label: 'Guard: data plane' },
  { task: 'scripts:guard-type-safety', label: 'Guard: type safety' },
  { task: 'scripts:validate-agent-guidance', label: 'Agent guidance' },
] as const;

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
 * When the aggregate `:validate` step is red, re-run each of its known
 * constituent tasks individually so the diagnostic names exactly which
 * check failed, instead of handing the review captain one opaque blob of
 * interleaved moon output to search through by hand.
 *
 * 🔴 C-482 (2026-09-06): a `guard-type-safety` violation was buried in a
 * wall of passing `:validate` output, and the review captain spent a dozen
 * manual `moon run <task>` invocations re-deriving which check had actually
 * failed before it could fix anything. This does that re-derivation once,
 * automatically, right here.
 *
 * Best-effort: if none of the individual re-runs reproduce a failure (a
 * flaky task, or a check outside this fixed list), falls back to the raw
 * `:validate` output rather than hiding it.
 */
const attributeValidateFailure = (options: {
  run: GateRunner;
  cwd: string;
  affected: readonly string[];
  fallback: string;
}): string => {
  const failing: { label: string; task: string; output: string }[] = [];
  for (const { task, label } of VALIDATE_CONSTITUENT_TASKS) {
    const result = options.run({
      command: 'bun',
      args: ['moon', 'run', task, ...options.affected],
      cwd: options.cwd,
    });
    // Best-effort: a spawn hiccup or an unrelated setup failure on the
    // re-run must not hide the original diagnostic — just skip attributing it.
    if (result.spawnFailed || (result.status !== 0 && isGateSetupFailure(result.output))) {
      continue;
    }
    if (result.status !== 0) {
      failing.push({ label, task, output: result.output });
    }
  }

  if (failing.length === 0) {
    return options.fallback;
  }

  const perTaskBudget = Math.max(500, Math.floor(MAX_GATE_OUTPUT_CHARS / failing.length));
  const attributed = failing
    .map(({ label, task, output }) => `### ${label} (${task})\n${truncate(output, perTaskBudget)}`)
    .join('\n\n');
  return truncate(attributed);
};

/**
 * Auto-fix, then verify, the code about to be pushed.
 *
 * Step 1 — `moon run :fix` — is the one that pays for itself: format and lint
 * are auto-fixable, and they are what actually leaks. The edits land in the
 * working tree BEFORE the caller's `commitAll`, so they ride into that same
 * commit rather than needing a follow-up.
 *
 * Step 2 runs every unique check required by the selected validation profile.
 * A final `moon run :validate` remains the verdict for `:fix`, which may exit
 * non-zero after applying fixes and needs a read-only follow-up check.
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

  // AC-2: Derive required checks from shared policy.
  const policyChecks = getRequiredChecks(profile);
  const steps: { label: string; args: readonly string[]; verdict: boolean }[] = [];
  const addedTasks = new Set<string>();

  for (const check of policyChecks) {
    if (addedTasks.has(check.task)) {
      continue;
    }
    addedTasks.add(check.task);
    const concurrencyArgs = check.task === ':fix' ? ['--concurrency', '8'] : [];
    steps.push({
      label: check.task,
      args: ['moon', 'run', check.task, ...affected, ...concurrencyArgs],
      verdict: check.task !== ':fix',
    });
  }

  // `:fix` is mutating, so use the read-only aggregate as its final verdict.
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
      // The aggregate `:validate` step's own output is an interleaved blob
      // across every affected project and check — re-derive which specific
      // check(s) failed before handing this to the review captain.
      const output =
        step.label === ':validate'
          ? attributeValidateFailure({
              run,
              cwd: options.cwd,
              affected,
              fallback: truncate(result.output),
            })
          : truncate(result.output);
      return { ran: true, ok: false, output };
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
        'Fix them in the worktree, then re-validate — and only then create the PR.',
      ];
  return [
    '',
    header,
    ...body,
    '',
    // 🔴 Never point at individual `moon run <task>` commands here. C-484:
    // this line used to say "reproduce with :fix then :validate", the captain
    // re-ran only the single guard named in the diagnostic below, and its own
    // un-indented hand edit reached CI as a `client:format` failure. One tool,
    // one verdict, bound to the commit it checked.
    'After each round of fixes, call `contract_stage` action `validate` — it applies',
    '`:fix`, re-runs `:validate`, commits, pushes, and records the verdict against the',
    'resulting commit. `gh_pr create` REFUSES to open a PR until that verdict is green',
    'for the exact commit on the remote, so there is no path around it.',
    '',
    '```',
    result.output,
    '```',
    '',
  ].join('\n');
};
