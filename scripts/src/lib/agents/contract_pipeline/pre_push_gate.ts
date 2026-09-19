// scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts
//
// The pipeline's stand-in for the pre-commit hook.
//
// 🔴 Why this exists. Contract pipeline checkpoints normally pass
// `--no-verify` — through `commitAll` (agents/git_worktree.ts) and the
// per-stage checkpoint in .pi/extensions/contract_pipeline.ts. That is
// deliberate: checkpoints must stay fast, and ops/pre_commit.ts does
// docs/contract-sync work that must not run inside a worktree. The red-gate
// :fix sweep is the exception and explicitly opts into hook verification.
// Without this publication gate, though, the normal pipeline path would never
// run lint, format or typecheck. The
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
// 🔴 `node:`-only. No `Bun.*`, no import of cli_utils.ts — this module is
// exercised from the contract pipeline, which pi reaches through the Bun
// bridge (scripts/src/lib/pi/); keeping it dependency-light keeps the bridge
// invocation cheap.
import { spawnSync } from 'node:child_process';
import { isWholeRepoGuardTask, validateConstituentTasks } from '../../ops/guards/registry.ts';
import { reportInfraIssue } from '../../ops/infra_report.ts';
import type { GateOutcome } from './gate_outcome.ts';
import { getRequiredChecks } from './validation_policy.ts';

/** Cap on the diagnostics carried into the review prompt. */
export const MAX_GATE_OUTPUT_CHARS = 4000;

/**
 * Outcome of running the pipeline's pre-push validation gate.
 *
 * 🔴 One outcome vocabulary (C-474-family brief, P1). `outcome` is the single
 * source of truth:
 *
 * | outcome       | meaning                                            | promotion |
 * |---------------|----------------------------------------------------|-----------|
 * | `passed`      | ran; every required check passed                   | allowed   |
 * | `failed`      | ran; the code is red                               | blocked (authorization required) |
 * | `unavailable` | could not run (missing moon, bad base, spawn fail)  | blocked — never green |
 * | `cancelled`   | interrupted before a verdict                        | blocked   |
 *
 * `ran` and `ok` are retained as derived, read-only views for existing
 * callers and logs. They are computed from `outcome`, never set independently:
 * `ran === (outcome === 'passed' || outcome === 'failed')` and
 * `ok === (outcome === 'passed')`.
 *
 * 🔴 Before this change, an infrastructure failure returned `ok: true` and the
 * gate was treated as green. Unknown is now distinct from passed: it reports
 * `unavailable`, which blocks promotion and is surfaced as an infra issue.
 */
export type PrePushGateResult = {
  /** The single verdict. */
  outcome: GateOutcome;
  /**
   * Derived: whether the gate actually reached a verdict (`passed`/`failed`).
   * False for `unavailable`/`cancelled`. Kept for logs and legacy callers.
   */
  ran: boolean;
  /** Derived: true only when `outcome === 'passed'`. */
  ok: boolean;
  /** Combined stdout+stderr of the failing step, truncated. Empty when passed. */
  output: string;
};

/** Build a `PrePushGateResult` from the one authoritative `outcome`. */
const gateResult = (options: { outcome: GateOutcome; output?: string }): PrePushGateResult => ({
  outcome: options.outcome,
  ran: options.outcome === 'passed' || options.outcome === 'failed',
  ok: options.outcome === 'passed',
  output: options.output ?? '',
});

/**
 * A command runner, injectable so tests never shell out.
 * Returns the exit status plus combined output.
 */
export type GateRunner = (options: {
  command: string;
  args: string[];
  cwd: string;
  /** Extra environment for this step only. */
  env?: Record<string, string>;
}) => {
  status: number | null;
  output: string;
  spawnFailed: boolean;
};

const defaultRunner: GateRunner = ({ command, args, cwd, env }) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
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
 * Named tasks that make up the `:validate` aggregate.
 *
 * 🔴 DERIVED from the guard registry, not maintained here. This list used to be
 * hand-written and had already drifted: it knew `guard-mvvm-conventions`,
 * `guard-service-conventions`, `guard-image-component`, `guard-data-plane` and
 * `guard-type-safety`, but not `guard-orphaned-capability`,
 * `guard-test-boundary`, `guard-view-model-composition`,
 * `guard-source-file-size`, `guard-cognitive-complexity` or
 * `guard-policy-diff`. A guard could therefore fail `moon run :validate` and
 * the attribution pass below would not know it existed, handing the review
 * captain an opaque blob instead of a named check.
 *
 * `scripts/src/lib/ops/__tests__/guard_registry.test.ts` pins the registry
 * against `.moon/tasks/all.yml`'s `validate` task and
 * `.moon/tasks/scripts.yml`'s `guard` task, so the three cannot diverge again.
 */
const VALIDATE_CONSTITUENT_TASKS = validateConstituentTasks();

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
  const baseArg = options.affected.find((arg) => arg.startsWith('--base='));
  const base = baseArg?.slice('--base='.length);
  const failing: { label: string; task: string; output: string }[] = [];
  for (const { task, label } of VALIDATE_CONSTITUENT_TASKS) {
    // A whole-repo guard must be re-run without `--affected`: its inputs span
    // the repository, and gating it on the affected graph is exactly the bug
    // that let oversized files reach main (see .github/workflows/pr-checks.yml).
    const args = isWholeRepoGuardTask(task)
      ? ['moon', 'run', task]
      : ['moon', 'run', task, ...options.affected];
    const result = options.run({
      command: 'bun',
      args,
      cwd: options.cwd,
      ...(base === undefined ? {} : { env: { AIKAMI_GUARD_BASE_REF: base } }),
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

/** One step in the gate: a labelled moon invocation and whether it is a verdict. */
type GateStep = {
  label: string;
  args: readonly string[];
  verdict: boolean;
  env?: Record<string, string>;
};

/**
 * Builds the ordered gate steps for a profile.
 *
 * Order matters: `:fix` first (it mutates), then the read-only checks, then the
 * sanctioned contraction, and `:validate` last as the verdict.
 *
 * 🔴 A whole-repo guard runs WITHOUT `--affected`. Its inputs span the
 * repository, so the affected-project graph is the wrong gate: on a base whose
 * diff resolves to nothing it would be skipped entirely. See
 * `.github/workflows/pr-checks.yml`.
 *
 * The contraction step is not a verdict: it can legitimately refuse (there is
 * real growth to fix) and `:validate` reports that properly.
 */
const buildGateSteps = (options: {
  profile: import('./validation_policy.ts').ValidationProfile;
  affected: readonly string[];
  baseEnv: Record<string, string>;
}): GateStep[] => {
  const steps: GateStep[] = [];
  const addedTasks = new Set<string>();

  for (const check of getRequiredChecks(options.profile)) {
    if (addedTasks.has(check.task)) {
      continue;
    }
    addedTasks.add(check.task);
    const concurrencyArgs = check.task === ':fix' ? ['--concurrency', '8'] : [];
    steps.push({
      label: check.task,
      args: isWholeRepoGuardTask(check.task)
        ? ['moon', 'run', check.task]
        : ['moon', 'run', check.task, ...options.affected, ...concurrencyArgs],
      verdict: check.task !== ':fix',
      env: options.baseEnv,
    });
  }

  steps.push({
    label: 'scripts:guard-contract',
    args: ['moon', 'run', 'scripts:guard-contract'],
    verdict: false,
  });

  steps.push({
    label: ':validate',
    args: ['moon', 'run', ':validate', ...options.affected],
    verdict: true,
    env: options.baseEnv,
  });

  return steps;
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
  const steps = buildGateSteps({
    profile: options.profile ?? 'pre_publication',
    affected: ['--affected', `--base=${options.base}`],
    baseEnv: { AIKAMI_GUARD_BASE_REF: options.base },
  });

  for (const step of steps) {
    const result = run({
      command: 'bun',
      args: [...step.args],
      cwd: options.cwd,
      ...(step.env === undefined ? {} : { env: step.env }),
    });

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
      // 🔴 NOT green. The gate could not run, so it has no evidence about the
      // code. Reporting `passed` here (the old `{ ran: false, ok: true }`) let
      // a missing moon binary authorize a PR. `unavailable` blocks promotion.
      return gateResult({ outcome: 'unavailable', output: truncate(result.output) });
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
              affected: ['--affected', `--base=${options.base}`],
              fallback: truncate(result.output),
            })
          : truncate(result.output);
      return gateResult({ outcome: 'failed', output });
    }
  }

  return gateResult({ outcome: 'passed' });
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
 * `unavailable` and `failed` are distinct: the captain must know whether to
 * fix the code or the infrastructure.
 */
export const formatGateNotesForPrompt = (result: PrePushGateResult | undefined): string => {
  if (!result || result.ok) {
    return '';
  }
  const unavailable = result.outcome === 'unavailable' || result.outcome === 'cancelled';
  const header = unavailable
    ? '## 🔴 Pre-push validation UNAVAILABLE — required checks could not run'
    : '## 🔴 Pre-push validation FAILED';
  const body = unavailable
    ? [
        '',
        'The branch was pushed (a branch push runs no CI), but the gate could not',
        'reach a verdict. This is an infrastructure issue (missing task definitions,',
        'broken toolchain, unresolvable base) rather than a code defect. Check the',
        'output below and resolve before opening the PR.',
      ]
    : [
        '',
        'The branch was pushed (a branch push runs no CI), but `moon run :validate`',
        'is red on it. CI will repeat these failures on the PR check.',
        '',
        '🔴 A red verdict does NOT authorize PR creation on its own. `gh_pr create`',
        'requires an explicit, revision-bound authorization record for this exact',
        'commit (see `contract_stage` action `validate`). YOLO records one; otherwise',
        'fix the failures and re-validate.',
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
    'resulting commit. `gh_pr create` REFUSES unless the recorded verdict is GREEN on',
    'the current commit, or an explicit authorization covers this exact verdict and',
    'revision.',
    '',
    '```',
    result.output,
    '```',
    '',
  ].join('\n');
};
