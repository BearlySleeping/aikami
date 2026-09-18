// scripts/src/lib/ops/guards/registry.ts
//
// The single source of truth for "what guards exist".
//
// Before this file, knowledge of the guard set was duplicated across at least
// six places, and it had drifted in every one of them:
//
//   • `.moon/tasks/scripts.yml`      — the `scripts:guard` aggregate
//   • `package.json`                 — `guard:all`, `guard:show-all`
//   • `pre_push_gate.ts`             — VALIDATE_CONSTITUENT_TASKS (a subset:
//                                      no test-boundary, no
//                                      view-model-composition, no
//                                      source-file-size, no orphaned-capability)
//   • `validation_policy.ts`         — structural-guard list (only :typecheck)
//   • `STRICTNESS_COVERAGE_MATRIX.md`— still advertised the retired
//                                      `guard-service-mock-coverage`
//   • the skills/docs
//
// The consequence was concrete: a guard could fail `moon run :validate` and
// the pipeline's own failure-attribution pass would not know it existed, so
// the review captain got an opaque blob instead of a named check. And a new
// guard could be added to the aggregate without ever reaching the matrix.
//
// 🔴 Adding, removing or renaming a guard must now break exactly one obvious
// test. `scripts/src/lib/ops/__tests__/guard_registry.test.ts` asserts parity
// between this registry, the Moon task file, the pre-push attribution list and
// the coverage matrix.
//
// This registry is metadata only. It deliberately does not generate Moon YAML
// (that would trade a readable task file for a build step) — parity is
// asserted by test instead.

/**
 * How a guard's failure should be read. The distinction is not cosmetic: it
 * decides whether a failure is a defect, a policy violation, or a signal.
 */
export type GuardCategory =
  /** An architectural invariant. Always fails immediately; no baseline. */
  | 'hard-invariant'
  /** Architectural debt with a baseline that may only shrink. */
  | 'ratcheted-debt'
  /** A maintainability signal. Advisory or ratcheted, never an architecture proof. */
  | 'maintainability'
  /** Detects changes to what counts as acceptable debt, rather than violations. */
  | 'policy'
  /** Enforced at agent runtime (git hook / pi extension), not in source CI. */
  | 'runtime';

export type GuardMeta = {
  /** Stable id used in diagnostics and tests. */
  id: string;
  /** Moon target, e.g. `scripts:guard-type-safety`. */
  task: string;
  /**
   * Repo-relative path of the guard implementation.
   * Used by the sanctioned contraction step (`guard_contract.ts`) so it never
   * has to guess which script a ratcheted guard lives in.
   */
  script: string;
  /** Human label used in CI reports and attribution. */
  label: string;
  category: GuardCategory;
  /**
   * True when the guard reads the whole repository rather than one project's
   * files. Whole-repo guards must NOT be gated on Moon's affected-project
   * graph — see `wholeRepoGuardTasks()`.
   */
  wholeRepo: boolean;
  /** True when the guard records existing debt in a baseline it may only shrink. */
  ratcheted: boolean;
  /**
   * True when the guard is a dependency of the `scripts:guard` aggregate.
   */
  aggregate: boolean;
  /**
   * True when the guard has a Moon task. A runtime-only guard (a git hook) is
   * registered and documented here but is not part of the Moon graph.
   */
  moonTask: boolean;
  /** True when the guard is documented in STRICTNESS_COVERAGE_MATRIX.md. */
  documented: boolean;
  /** Repo-relative locations the guard reads. Used for docs and drift checks. */
  paths: readonly string[];
  /** One-line description for docs and diagnostics. */
  description: string;
  /**
   * How an agent is expected to clear a failure.
   * 🔴 Never "raise the baseline", "extend the waiver", or "add an exception".
   */
  remediation: string;
};

export const GUARDS: readonly GuardMeta[] = [
  {
    id: 'mvvm-conventions',
    task: 'scripts:guard-mvvm-conventions',
    script: 'scripts/src/lib/ops/guard_mvvm_conventions.ts',
    label: 'Guard: MVVM conventions',
    category: 'ratcheted-debt',
    wholeRepo: false,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: [
      'apps/frontend/client/src/**/*_view.svelte',
      'apps/frontend/client/src/**/*_view_model.svelte.ts',
      'apps/frontend/hub/src/**/*_view.svelte',
      'apps/frontend/hub/src/**/*_view_model.svelte.ts',
    ],
    description:
      'Views are logicless and ViewModels own their lifecycle; V6/V7/M8/M9 are ratcheted.',
    remediation:
      'Move the logic to the ViewModel (V1–V5 are hard) or remove the extra ViewModel dependency. Do not raise the M8/M9 baseline.',
  },
  {
    id: 'service-conventions',
    task: 'scripts:guard-service-conventions',
    script: 'scripts/src/lib/ops/guard_service_conventions.ts',
    label: 'Guard: service conventions',
    category: 'ratcheted-debt',
    wholeRepo: false,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: [
      'apps/frontend/client/src/lib/services/**/*_service.svelte.ts',
      'apps/frontend/hub/src/lib/client/services/**/*_service.svelte.ts',
    ],
    description:
      'Services extend BaseFrontendClass, are built through `.create()`, and never import upward; S11/S12 are ratcheted.',
    remediation:
      'Remove the upward import (S11) or the non-allowlisted dynamic import (S12) by injecting a typed capability. Do not raise the S11/S12 baseline.',
  },
  {
    id: 'image-component',
    task: 'scripts:guard-image-component',
    script: 'scripts/src/lib/ops/guard_image_component.ts',
    label: 'Guard: image component',
    category: 'hard-invariant',
    wholeRepo: false,
    ratcheted: false,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/frontend/client/src/**/*.svelte', 'apps/frontend/hub/src/**/*.svelte'],
    description:
      'Raw <img> is banned; use the shared <Image> component (Tauri asset-protocol security).',
    remediation: 'Replace the raw <img> with the shared <Image> component from $components.',
  },
  {
    id: 'data-plane',
    task: 'scripts:guard-data-plane',
    script: 'scripts/src/lib/ops/guard_data_plane.ts',
    label: 'Guard: data plane',
    category: 'hard-invariant',
    wholeRepo: false,
    ratcheted: false,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/frontend/hub/src/**/*', 'packages/backend/database/**/*'],
    description:
      'Database access is confined to $lib/server / *.server.ts; no Postgres/Neon or TypeBox CLI imports.',
    remediation:
      'Move the database reference behind a repository in $lib/server. There is no baseline for this guard.',
  },
  {
    id: 'type-safety',
    task: 'scripts:guard-type-safety',
    script: 'scripts/src/lib/ops/guard_type_safety.ts',
    label: 'Guard: type safety',
    category: 'ratcheted-debt',
    wholeRepo: true,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/**/*', 'packages/**/*', 'scripts/**/*', '.pi/**/*'],
    description:
      '`as unknown as X`, `as any` and `@ts-ignore` are ratcheted per file with violation identities.',
    remediation:
      'Fix the type: parse unknown input against its schema, or write a type guard. `as any` is never the fix.',
  },
  {
    id: 'orphaned-capability',
    task: 'scripts:guard-orphaned-capability',
    script: 'scripts/src/lib/ops/guard_orphaned_capability.ts',
    label: 'Guard: orphaned capability',
    category: 'ratcheted-debt',
    wholeRepo: false,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/frontend/client/src/lib/services/**/*'],
    description:
      'Runtime service capabilities must have a production consumer; test-only use does not count. Type-only exports are out of scope.',
    remediation:
      'Wire the capability into production, or delete it. Do not raise the orphan baseline, and do not move a runtime capability into a type-only export to silence the guard.',
  },
  {
    id: 'test-boundary',
    task: 'scripts:guard-test-boundary',
    script: 'scripts/src/lib/ops/guard_test_boundary.ts',
    label: 'Guard: test boundary',
    category: 'hard-invariant',
    wholeRepo: true,
    ratcheted: false,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/**/src/**/*', 'packages/**/src/**/*'],
    description: 'Production source must not import test helpers, fixtures or *.test.ts files.',
    remediation:
      'Inject the dependency at composition time instead of importing the test helper. There is no baseline for this guard.',
  },
  {
    id: 'view-model-composition',
    task: 'scripts:guard-view-model-composition',
    script: 'scripts/src/lib/ops/guard_view_model_composition.ts',
    label: 'Guard: view-model composition',
    category: 'ratcheted-debt',
    wholeRepo: false,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/frontend/client/src/lib/views/**/*'],
    description:
      'ViewModels and section registries take no runtime dependency on the application service graph.',
    remediation:
      'Inject a typed capability through the sibling *_composition.ts module instead of importing $services at runtime. Do not raise the C1/C2/C3 baseline.',
  },
  {
    id: 'source-file-size',
    task: 'scripts:guard-source-file-size',
    script: 'scripts/src/lib/ops/guard_source_file_size.ts',
    label: 'Guard: source file size',
    category: 'maintainability',
    wholeRepo: true,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/**/*', 'packages/**/*', 'scripts/**/*', '.pi/**/*'],
    description:
      'Coarse signal for module responsibility: production warns at 500 / fails at 800, tests at 800/1500, with permanent exemptions for declarative data and expiring waivers for mutable modules.',
    remediation:
      'Extract a cohesive responsibility, or reduce the module. Changing an accepted ceiling is a guard-policy expansion and requires explicit human review.',
  },
  {
    id: 'cognitive-complexity',
    task: 'scripts:guard-cognitive-complexity',
    script: 'scripts/src/lib/ops/guard_cognitive_complexity.ts',
    label: 'Guard: cognitive complexity',
    category: 'maintainability',
    wholeRepo: true,
    ratcheted: true,
    aggregate: true,
    moonTask: true,
    documented: true,
    paths: ['apps/**/*', 'packages/**/*', 'scripts/**/*', '.pi/**/*'],
    description:
      "Biome's complexity/noExcessiveCognitiveComplexity score, ratcheted per file on both violation count and worst-case score. Independent of LOC.",
    remediation:
      'Flatten the control flow — early returns, extracted helpers, a lookup table instead of a branch ladder. Do not raise the complexity baseline.',
  },
  {
    id: 'policy-diff',
    task: 'scripts:guard-policy-diff',
    script: 'scripts/src/lib/ops/guard_policy_diff.ts',
    label: 'Guard policy change classification',
    category: 'policy',
    wholeRepo: true,
    ratcheted: false,
    aggregate: false,
    moonTask: true,
    documented: true,
    paths: ['biome.json', '.moon/tasks/**/*', '.github/workflows/**/*'],
    description:
      'Classifies a diff as debt reduction / policy expansion / refactor. A guard-policy change is always surfaced as GUARD POLICY CHANGE in the CI summary.',
    remediation:
      'A policy expansion needs the `guard-policy-approved` label (maintainer action). An agent must revert the increase instead of seeking authorization.',
  },
  {
    id: 'workspace-boundary',
    task: 'scripts:guard-workspace-boundary',
    script: 'scripts/src/lib/ops/guard_workspace_boundary.ts',
    label: 'Guard: workspace boundary',
    category: 'runtime',
    wholeRepo: false,
    ratcheted: false,
    aggregate: false,
    moonTask: false,
    documented: true,
    paths: ['scripts/src/lib/ops/guard_workspace_boundary.ts'],
    description:
      'A pipeline agent may not run a destructive git operation against a repository that is not its own worktree. Enforced as a git hook, not in CI.',
    remediation: 'Read the other revision with `git show <ref>:<path>` inside your own worktree.',
  },
] as const;

export const guardById = (id: string): GuardMeta | undefined =>
  GUARDS.find((guard) => guard.id === id);

export const guardByTask = (task: string): GuardMeta | undefined =>
  GUARDS.find((guard) => guard.task === task);

/** Guards that make up the `scripts:guard` aggregate, in registry order. */
export const aggregateGuards = (): readonly GuardMeta[] =>
  GUARDS.filter((guard) => guard.aggregate);

/** Moon targets of the aggregate, e.g. for `scripts:guard`'s `deps:`. */
export const aggregateGuardTasks = (): readonly string[] =>
  aggregateGuards().map((guard) => guard.task);

/**
 * Guards whose correctness depends on reading the whole repository.
 *
 * 🔴 These must run unconditionally in CI. Moon's affected-project graph is
 * the wrong gate for them: a guard that scans every file has no single owning
 * project, and a push to `main` whose diff resolves to nothing would skip it
 * entirely. See `.github/workflows/pr-checks.yml`'s "Structural guards
 * (whole-repo)" step and the parity test that keeps it there.
 */
export const wholeRepoGuardTasks = (): readonly string[] =>
  GUARDS.filter((guard) => guard.wholeRepo).map((guard) => guard.task);

/**
 * True when a task must be run without Moon's `--affected` filter.
 *
 * Covers both an individual whole-repo guard and the aggregate that contains
 * them, so the pre-push gate and CI agree on which tasks are unconditional.
 */
export const isWholeRepoGuardTask = (task: string): boolean =>
  task === 'scripts:guard-whole-repo' || wholeRepoGuardTasks().includes(task);

/** Guards that keep a baseline and therefore must be checked for policy drift. */
export const ratchetedGuards = (): readonly GuardMeta[] =>
  GUARDS.filter((guard) => guard.ratcheted);

/**
 * Tasks the `:validate` aggregate runs that are not part of the `scripts:guard`
 * aggregate: the policy classifier and the agent-guidance drift check.
 */
const EXTRA_VALIDATE_TASKS: readonly { task: string; label: string }[] = [
  { task: 'scripts:guard-policy-diff', label: 'Guard policy change classification' },
  { task: 'scripts:validate-agent-guidance', label: 'Agent guidance' },
] as const;

/**
 * The complete list of checks the `:validate` aggregate can fail on, in the
 * order the pre-push gate should re-run them for failure attribution.
 *
 * 🔴 Derived from the registry so a newly added guard is attributed
 * automatically. `scripts/src/lib/ops/__tests__/guard_registry.test.ts` pins
 * this against `.moon/tasks/all.yml`'s `validate` task and
 * `.moon/tasks/scripts.yml`'s `guard` task.
 */
export const validateConstituentTasks = (): readonly { task: string; label: string }[] => [
  { task: ':lint', label: 'Lint' },
  { task: ':format', label: 'Format' },
  { task: ':typecheck', label: 'Typecheck' },
  ...aggregateGuards().map((guard) => ({ task: guard.task, label: guard.label })),
  ...EXTRA_VALIDATE_TASKS,
];

/**
 * Files whose change alters what counts as acceptable debt.
 *
 * 🔴 Autonomous agents may REDUCE debt freely. Changing the definition of
 * acceptable debt is a policy change and requires human review. This list is
 * what `guard_policy_diff.ts` classifies a diff against, and what a
 * CODEOWNERS entry should protect.
 *
 * A trailing `*` means "this prefix"; anything else is an exact path. The
 * distinction is explicit rather than inferred from a trailing slash, so a
 * prefix can never be silently read as a filename.
 */
export const GUARD_POLICY_PATHS: readonly string[] = [
  'scripts/src/lib/ops/guard_*',
  'scripts/src/lib/ops/guards/*',
  'scripts/src/lib/agents/contract_pipeline/validation_policy.ts',
  'scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts',
  'biome.json',
  '.moon/tasks/*',
  '.github/workflows/*',
  '.github/CODEOWNERS',
] as const;

/** True when a repo-relative path participates in guard policy. */
export const isGuardPolicyPath = (relPath: string): boolean =>
  GUARD_POLICY_PATHS.some((entry) =>
    entry.endsWith('*') ? relPath.startsWith(entry.slice(0, -1)) : relPath === entry,
  );
