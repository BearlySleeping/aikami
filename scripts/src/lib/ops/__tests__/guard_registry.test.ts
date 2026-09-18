// scripts/src/lib/ops/__tests__/guard_registry.test.ts
//
// Parity tests for the guard registry.
//
// 🔴 The whole point of `guards/registry.ts` is that adding, removing or
// renaming a guard breaks exactly ONE obvious test. Knowledge of the guard set
// used to be duplicated across `.moon/tasks/*.yml`, `package.json`,
// `pre_push_gate.ts`, `validation_policy.ts`, `STRICTNESS_COVERAGE_MATRIX.md`
// and the CI workflow — and it had drifted in every one of them:
//
//   • `pre_push_gate`'s attribution list was missing four guards;
//   • `validation_policy` claimed structural-guard coverage it did not name;
//   • the coverage matrix still advertised the retired
//     `guard-service-mock-coverage`;
//   • `guard-orphaned-capability` was inherited by all 40 projects, producing
//     39 no-op targets per CI run.
//
// Each of those is now a failing assertion below.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  aggregateGuardTasks,
  GUARDS,
  isGuardPolicyPath,
  isWholeRepoGuardTask,
  ratchetedGuards,
  validateConstituentTasks,
  wholeRepoGuardTasks,
} from '../guards/registry.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../../..');
const SCRIPTS_TASKS = readFileSync(resolve(REPO_ROOT, '.moon/tasks/scripts.yml'), 'utf8');
const ALL_TASKS = readFileSync(resolve(REPO_ROOT, '.moon/tasks/all.yml'), 'utf8');
const PR_CHECKS = readFileSync(resolve(REPO_ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const MATRIX = readFileSync(
  resolve(REPO_ROOT, 'docs/contracts/STRICTNESS_COVERAGE_MATRIX.md'),
  'utf8',
);
const SKILL = readFileSync(resolve(REPO_ROOT, '.pi/skills/aikami-conventions/SKILL.md'), 'utf8');

/**
 * Reads a task's `deps:` list from a Moon tasks file.
 *
 * Deliberately a tiny text reader rather than a YAML dependency: the shape
 * being asserted (a flat list of `- '~:task'` scalars under a named task) is
 * stable, and a parser would hide a malformed list instead of failing on it.
 */
const readDeps = (source: string, task: string): string[] => {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${task}:\\s*$`).test(line));
  expect(start, `task "${task}" is missing`).toBeGreaterThan(-1);
  const depsStart = lines.findIndex((line, index) => index > start && /^ {4}deps:\s*$/.test(line));
  if (depsStart === -1) {
    return [];
  }
  const deps: string[] = [];
  for (let index = depsStart + 1; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = line.match(/^\s{6}-\s*['"]([^'"]+)['"]/);
    if (match?.[1]) {
      deps.push(match[1]);
      continue;
    }
    if (/^\s{4}\S/.test(line)) {
      break;
    }
  }
  return deps;
};

/** True when a task name is defined at all in a Moon tasks file. */
const definesTask = (source: string, task: string): boolean =>
  new RegExp(`^ {2}${task}:\\s*$`, 'm').test(source);

describe('registry integrity', () => {
  test('every guard has a unique id, task and script', () => {
    const ids = GUARDS.map((guard) => guard.id);
    const tasks = GUARDS.map((guard) => guard.task);
    const scripts = GUARDS.map((guard) => guard.script);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tasks).size).toBe(tasks.length);
    expect(new Set(scripts).size).toBe(scripts.length);
  });

  test('every guard declares what it reads and how to fix a failure', () => {
    for (const guard of GUARDS) {
      expect(guard.paths.length, `${guard.id} declares no paths`).toBeGreaterThan(0);
      expect(guard.description.length, `${guard.id} has no description`).toBeGreaterThan(20);
      expect(guard.remediation.length, `${guard.id} has no remediation`).toBeGreaterThan(20);
    }
  });

  test('no remediation tells an agent to raise a baseline or add an exception', () => {
    for (const guard of GUARDS) {
      expect(guard.remediation, `${guard.id}`).not.toMatch(/raise the (baseline|waiver|ceiling)/i);
      expect(guard.remediation, `${guard.id}`).not.toMatch(/add a reviewed exception/i);
      expect(guard.remediation, `${guard.id}`).not.toMatch(/extend reviewBy/i);
    }
  });

  test('every ratcheted guard has a distinct baseline-bearing script', () => {
    const ratcheted = ratchetedGuards();
    expect(ratcheted.length).toBeGreaterThan(0);
    for (const guard of ratcheted) {
      expect(guard.script).toMatch(/^scripts\/src\/lib\/ops\/guard_/);
    }
  });
});

describe('.moon/tasks/scripts.yml parity', () => {
  test('every guard script is a task in the scripts task file', () => {
    for (const guard of GUARDS.filter((entry) => entry.moonTask)) {
      const taskName = guard.task.replace(/^scripts:/, '');
      expect(
        definesTask(SCRIPTS_TASKS, taskName),
        `${guard.task} is in the registry but not defined in .moon/tasks/scripts.yml`,
      ).toBe(true);
    }
  });

  test('runtime-only guards are marked as having no Moon task', () => {
    // `guard-workspace-boundary` is a git hook, not a CI task. Without the flag
    // the parity assertion above would demand a Moon task it must not have.
    for (const guard of GUARDS.filter((entry) => !entry.moonTask)) {
      expect(guard.category, `${guard.id} without a Moon task should be runtime`).toBe('runtime');
    }
  });

  test('the `guard` aggregate depends on exactly the registry aggregate', () => {
    const deps = readDeps(SCRIPTS_TASKS, 'guard').map((dep) => dep.replace(/^~:/, 'scripts:'));
    expect(deps.sort()).toEqual([...aggregateGuardTasks()].sort());
  });

  test('the `guard-whole-repo` aggregate depends on exactly the whole-repo guards', () => {
    const deps = readDeps(SCRIPTS_TASKS, 'guard-whole-repo').map((dep) =>
      dep.replace(/^~:/, 'scripts:'),
    );
    expect(deps.sort()).toEqual([...wholeRepoGuardTasks()].sort());
  });

  test('whole-repo guards cannot be run affected-only', () => {
    // Their `inputs` must include the shared `guard-scan` group, which is the
    // only thing that makes Moon's affected detection cover the whole tree —
    // and even then the CI workflow runs them unconditionally.
    for (const task of wholeRepoGuardTasks()) {
      const taskName = task.replace(/^scripts:/, '');
      const lines = SCRIPTS_TASKS.split('\n');
      const start = lines.findIndex((line) => new RegExp(`^ {2}${taskName}:\\s*$`).test(line));
      expect(start, `${task} is missing`).toBeGreaterThan(-1);
      const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
      const block = lines.slice(start, end === -1 ? undefined : end).join('\n');
      // A whole-repo guard must consume a root-anchored file group (the shared
      // `guard-scan` tree, or the policy group for the policy classifier) rather
      // than project-relative globs.
      expect(block, `${task} must consume a root-anchored file group`).toMatch(
        /@group\((guard-scan|guard-policy)\)/,
      );
    }
  });
});

describe('.moon/tasks/all.yml parity', () => {
  test('the `validate` aggregate includes the guard aggregate and the policy classifier', () => {
    const deps = readDeps(ALL_TASKS, 'validate');
    expect(deps).toContain('scripts:guard');
    expect(deps).toContain('scripts:guard-policy-diff');
    expect(deps).toContain('scripts:validate-agent-guidance');
    expect(deps).toContain('~:lint');
    expect(deps).toContain('~:format');
    expect(deps).toContain('~:typecheck');
  });

  test('no guard task is inherited by every project', () => {
    // `guard-orphaned-capability` used to live here with
    // `AIKAMI_GUARD_PROJECT: $project` and a self-returning no-op for every
    // non-scripts project: 39 wasted targets per CI run, and a repo-wide guard
    // masquerading as a per-project one.
    const inheritedGuardTasks = [...ALL_TASKS.matchAll(/^ {2}(guard-[a-z-]+):\s*$/gm)].map(
      (match) => match[1],
    );
    expect(inheritedGuardTasks).toEqual([]);
  });
});

describe('pre-push attribution parity', () => {
  test('attribution knows every aggregate guard', () => {
    const tasks = validateConstituentTasks().map((entry) => entry.task);
    for (const task of aggregateGuardTasks()) {
      expect(tasks, `${task} is not attributed by the pre-push gate`).toContain(task);
    }
  });

  test('attribution covers the non-guard validate constituents', () => {
    const tasks = validateConstituentTasks().map((entry) => entry.task);
    for (const task of [':lint', ':format', ':typecheck', 'scripts:validate-agent-guidance']) {
      expect(tasks).toContain(task);
    }
  });

  test('every attributed task exists as a real Moon task', () => {
    for (const { task } of validateConstituentTasks()) {
      if (task.startsWith(':')) {
        expect(definesTask(ALL_TASKS, task.slice(1)), `${task} missing from all.yml`).toBe(true);
        continue;
      }
      const [project, name] = task.split(':');
      expect(project).toBe('scripts');
      expect(definesTask(SCRIPTS_TASKS, name ?? ''), `${task} missing from scripts.yml`).toBe(true);
    }
  });

  test('the pre-push gate derives its list instead of hard-coding one', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts'),
      'utf8',
    );
    expect(source).toContain('validateConstituentTasks()');
    // The old hand-maintained array must be gone.
    expect(source).not.toMatch(/const VALIDATE_CONSTITUENT_TASKS = \[\s*\{/);
  });

  test('whole-repo guards are recognised so they are never re-run affected-only', () => {
    expect(isWholeRepoGuardTask('scripts:guard-whole-repo')).toBe(true);
    for (const task of wholeRepoGuardTasks()) {
      expect(isWholeRepoGuardTask(task)).toBe(true);
    }
    expect(isWholeRepoGuardTask('scripts:guard-mvvm-conventions')).toBe(false);
  });
});

describe('CI workflow parity', () => {
  test('whole-repo guards run unconditionally, before the affected-aware step', () => {
    const guardStep = PR_CHECKS.indexOf('Structural guards (whole-repo)');
    const moonStep = PR_CHECKS.indexOf('Run Moon CI (default check)');
    expect(guardStep).toBeGreaterThan(-1);
    expect(moonStep).toBeGreaterThan(-1);
    expect(guardStep).toBeLessThan(moonStep);

    const block = PR_CHECKS.slice(guardStep, moonStep);
    expect(block).toContain('scripts:guard-whole-repo');
    // 🔴 The executed command must carry no `--affected`: that is the whole
    // point of the step. (Comments in the block may mention the flag.)
    const runBody = block.slice(block.indexOf('run: |'));
    const commands = runBody
      .split('\n')
      .filter((line) => line.trim().startsWith('bun '))
      .join('\n');
    expect(commands.length).toBeGreaterThan(0);
    expect(commands).not.toContain('--affected');
    expect(commands).not.toContain('moon ci');
  });

  test('the whole-repo aggregate includes the policy classifier', () => {
    expect(wholeRepoGuardTasks()).toContain('scripts:guard-policy-diff');
  });

  test('the job fails when the whole-repo guard step fails', () => {
    expect(PR_CHECKS).toContain("steps.guards.outcome != 'success'");
  });

  test('the policy-expansion authorization channel is wired to a maintainer label', () => {
    expect(PR_CHECKS).toContain('AIKAMI_GUARD_POLICY_AUTHORIZATION');
    expect(PR_CHECKS).toContain('guard-policy-approved');
  });
});

describe('coverage-matrix parity', () => {
  const documentedGuards = GUARDS.filter((guard) => guard.documented);

  test('every documented guard appears in the matrix by its task name', () => {
    for (const guard of documentedGuards) {
      expect(MATRIX, `${guard.task} is not documented in the coverage matrix`).toContain(
        guard.task,
      );
    }
  });

  test('the matrix names no guard task that is not in the registry', () => {
    // Aggregates and tools that are deliberately not individual guards.
    const known = new Set([
      ...GUARDS.map((guard) => guard.task),
      'scripts:guard',
      'scripts:guard-whole-repo',
      'scripts:guard-contract',
      'scripts:guard-source-size-report',
    ]);
    const referenced = [...MATRIX.matchAll(/scripts:(guard-[a-z-]+)/g)].map(
      (match) => `scripts:${match[1]}`,
    );
    for (const task of new Set(referenced)) {
      expect(known.has(task), `${task} is documented but no longer exists`).toBe(true);
    }
  });

  test('the retired service-mock-coverage guard is not advertised as active coverage', () => {
    expect(MATRIX).not.toContain('guard-service-mock-coverage');
  });

  test('every guard category is explained in the matrix', () => {
    for (const heading of [
      'hard invariant',
      'ratchet',
      'maintainability',
      'temporary waiver',
      'policy',
    ]) {
      expect(MATRIX.toLowerCase()).toContain(heading);
    }
  });
});

describe('skill-documentation parity', () => {
  test('the skill explains the reduction-only rule and the policy-expansion rule', () => {
    expect(SKILL).toContain('reduction-only');
    expect(SKILL).toContain('guard-policy-approved');
    expect(SKILL).toMatch(/DO NOT solve a guard failure by raising a baseline/);
  });

  test('the skill distinguishes LOC from cognitive complexity', () => {
    expect(SKILL).toContain('noExcessiveCognitiveComplexity');
    expect(SKILL).toMatch(/not a complexity proof/);
  });

  test('the skill documents permanent exemptions vs temporary waivers', () => {
    expect(SKILL).toContain('guard_source_file_size_exemptions.json');
    expect(SKILL).toContain('guard_source_file_size_waivers.json');
  });
});

describe('guard-policy path classification', () => {
  test('guard implementations, baselines, waivers and wiring are policy paths', () => {
    for (const path of [
      'scripts/src/lib/ops/guard_type_safety.ts',
      'scripts/src/lib/ops/guards/ratchet.ts',
      'scripts/src/lib/ops/guard_source_file_size_waivers.json',
      'scripts/src/lib/ops/guard_cognitive_complexity_baseline.json',
      'scripts/src/lib/agents/contract_pipeline/validation_policy.ts',
      'biome.json',
      '.moon/tasks/scripts.yml',
      '.github/workflows/pr-checks.yml',
    ]) {
      expect(isGuardPolicyPath(path), `${path} should be a policy path`).toBe(true);
    }
  });

  test('ordinary application code is not a policy path', () => {
    for (const path of [
      'apps/frontend/client/src/lib/services/game/session_service.svelte.ts',
      'packages/shared/utils/src/lib/common/utils.ts',
      'scripts/src/lib/ops/preview_client.ts',
      'package.json',
    ]) {
      expect(isGuardPolicyPath(path), `${path} should not be a policy path`).toBe(false);
    }
  });
});
