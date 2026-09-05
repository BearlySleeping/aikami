// scripts/src/lib/agents/contract_pipeline/validation_policy.ts
//
// Shared validation policy used by the Pi validate tool, the pre-push gate,
// and the pipeline orchestrator. Defines named profiles with explicit
// required/optional checks, including structural guards and relevant tests.
//
// AC-2: Consumers share the check policy — equivalent policy inputs select
// equivalent required checks.
// AC-4: Failed or unavailable checks prevent promotion.
// AC-5: Safety and cancellation cannot be bypassed.

/**
 * Named validation profiles reflecting different confidence levels.
 * - focused: quick feedback during development (fix + typecheck only)
 * - pre_publication: full pre-PR gate (fix + typecheck + structural guards)
 * - ci: full CI suite (everything including build + test)
 */
export type ValidationProfile = 'focused' | 'pre_publication' | 'ci';

/**
 * A single check that may be required or optional for a given profile.
 */
export type PolicyCheck = {
  /** Moon task target, e.g. ':fix' or 'client:build'. */
  readonly task: string;
  /** Human-readable label. */
  readonly label: string;
  /** When true, the check MUST pass before promotion is allowed. */
  readonly required: boolean;
  /** When true, this is a structural guard (secret/scope safety, conventions). */
  readonly guard: boolean;
};

/**
 * Policy definition for one validation profile.
 */
export type ProfilePolicy = {
  readonly profile: ValidationProfile;
  /** Checks that MUST pass for this profile. */
  readonly requiredChecks: readonly PolicyCheck[];
  /** Checks that run but do not block promotion. */
  readonly optionalChecks: readonly PolicyCheck[];
  /** Structural guards that run even if other checks are cancelled. */
  readonly structuralGuards: readonly PolicyCheck[];
  /** Checks explicitly excluded from this profile (heavy tasks not relevant here). */
  readonly excludedChecks: readonly string[];
};

/**
 * Outcome of a single check execution.
 * AC-4: 'unavailable' and 'cancelled' are distinct from 'failed' and 'passed'.
 */
export type CheckOutcome = 'passed' | 'failed' | 'unavailable' | 'cancelled' | 'not_applicable';

/**
 * Result of one check run.
 */
export type CheckResult = {
  readonly check: string;
  readonly label: string;
  readonly outcome: CheckOutcome;
  /** Human-readable diagnostics (stderr, error messages). Empty when passed. */
  readonly diagnostics: string;
  /** Wall-clock duration in milliseconds, if available. */
  readonly durationMs?: number;
};

/**
 * Versioned validation artifact bound to a specific candidate revision.
 * AC-3: Evidence is bound to the actual candidate.
 */
export type ValidationArtifact = {
  readonly version: number;
  readonly candidateFingerprint: string;
  readonly baseFingerprint: string | undefined;
  readonly profile: ValidationProfile;
  readonly checks: readonly CheckResult[];
  readonly timestamp: string;
  readonly overallOutcome: 'passed' | 'failed' | 'unavailable';
};

// ── Profile Definitions ─────────────────────────────────────────────

/** Focused profile: quick fix + typecheck during development. */
const FOCUSED_POLICY = {
  profile: 'focused',
  requiredChecks: [
    { task: ':fix', label: 'Fix (lint + format)', required: true, guard: false },
    { task: ':typecheck', label: 'TypeScript typecheck', required: true, guard: false },
  ],
  optionalChecks: [],
  structuralGuards: [],
  excludedChecks: [':build', ':test', 'e2e:test'],
} as const satisfies ProfilePolicy;

/** Pre-publication profile: everything needed before opening a PR. */
const PRE_PUBLICATION_POLICY = {
  profile: 'pre_publication',
  requiredChecks: [
    { task: ':fix', label: 'Fix (lint + format)', required: true, guard: false },
    { task: ':typecheck', label: 'TypeScript typecheck', required: true, guard: false },
  ],
  optionalChecks: [
    { task: ':build', label: 'Build all affected', required: false, guard: false },
    { task: ':test', label: 'Test all affected', required: false, guard: false },
  ],
  structuralGuards: [
    {
      task: ':typecheck',
      label: 'TypeScript typecheck (structural guard)',
      required: true,
      guard: true,
    },
  ],
  excludedChecks: [],
} as const satisfies ProfilePolicy;

/** CI profile: full suite run by CI pipeline. */
const CI_POLICY = {
  profile: 'ci',
  requiredChecks: [
    { task: ':fix', label: 'Fix (lint + format)', required: true, guard: false },
    { task: ':typecheck', label: 'TypeScript typecheck', required: true, guard: false },
    { task: ':build', label: 'Build all affected', required: true, guard: false },
    { task: ':test', label: 'Test all affected', required: true, guard: false },
  ],
  optionalChecks: [],
  structuralGuards: [
    {
      task: ':typecheck',
      label: 'TypeScript typecheck (structural guard)',
      required: true,
      guard: true,
    },
  ],
  excludedChecks: [],
} as const satisfies ProfilePolicy;

// ── Policy Registry ─────────────────────────────────────────────────

const POLICIES = {
  focused: FOCUSED_POLICY,
  pre_publication: PRE_PUBLICATION_POLICY,
  ci: CI_POLICY,
} as const satisfies Record<ValidationProfile, ProfilePolicy>;

/**
 * Get the policy definition for a named profile.
 * Returns undefined for unknown profiles.
 */
export const getPolicy = (profile: ValidationProfile): ProfilePolicy | undefined =>
  POLICIES[profile];

/**
 * Get all required checks (including structural guards) for a profile.
 * AC-2: Equivalent policy inputs produce equivalent required checks.
 */
export const getRequiredChecks = (profile: ValidationProfile): readonly PolicyCheck[] => {
  const policy = POLICIES[profile];
  if (!policy) {
    return [];
  }
  return [...policy.requiredChecks, ...policy.structuralGuards];
};

/**
 * Determine whether a check outcome should block promotion.
 * AC-4: Failed, unavailable, and cancelled checks prevent promotion.
 * AC-5: Cancellation cannot satisfy check requirements.
 */
export const isBlockingOutcome = (outcome: CheckOutcome): boolean =>
  outcome === 'failed' || outcome === 'unavailable' || outcome === 'cancelled';

/**
 * Given a set of check results for a profile, determine the overall outcome.
 * AC-4: Any failed/unavailable/cancelled required check → overall 'failed'.
 */
export const determineOverallOutcome = (options: {
  profile: ValidationProfile;
  results: readonly CheckResult[];
}): 'passed' | 'failed' | 'unavailable' => {
  const requiredTasks = new Set(getRequiredChecks(options.profile).map((c) => c.task));

  let hasUnavailable = false;
  const passedTasks = new Set<string>();

  for (const result of options.results) {
    if (!requiredTasks.has(result.check)) {
      continue; // Skip optional checks for overall determination
    }
    if (result.outcome === 'failed') {
      return 'failed';
    }
    if (result.outcome === 'unavailable' || result.outcome === 'cancelled') {
      hasUnavailable = true;
    }
    if (result.outcome === 'passed') {
      passedTasks.add(result.check);
    }
  }

  if (hasUnavailable || [...requiredTasks].some((task) => !passedTasks.has(task))) {
    return 'unavailable';
  }

  return 'passed';
};

/**
 * Create a versioned validation artifact bound to a candidate.
 * AC-3: The artifact records the candidate fingerprint so stale evidence
 * can be detected.
 */
export const createValidationArtifact = (options: {
  candidateFingerprint: string;
  baseFingerprint?: string;
  profile: ValidationProfile;
  results: readonly CheckResult[];
}): ValidationArtifact => ({
  version: 1,
  candidateFingerprint: options.candidateFingerprint,
  baseFingerprint: options.baseFingerprint,
  profile: options.profile,
  checks: options.results,
  timestamp: new Date().toISOString(),
  overallOutcome: determineOverallOutcome({
    profile: options.profile,
    results: options.results,
  }),
});

/**
 * Check whether a validation artifact is still fresh for a given candidate.
 * AC-3: Stale evidence (different candidate fingerprint) is rejected.
 */
export const isArtifactFresh = (options: {
  artifact: ValidationArtifact;
  currentFingerprint: string;
  currentBaseFingerprint?: string;
}): boolean => {
  if (options.artifact.candidateFingerprint !== options.currentFingerprint) {
    return false;
  }
  // If base fingerprint changed, the diff context is different
  if (
    options.currentBaseFingerprint !== undefined &&
    options.artifact.baseFingerprint !== options.currentBaseFingerprint
  ) {
    return false;
  }
  return true;
};

/**
 * Summarize check results into a human-readable report string.
 */
export const formatValidationReport = (options: {
  artifact: ValidationArtifact;
  fresh: boolean;
}): string => {
  const lines: string[] = [];
  const statusIcon = options.artifact.overallOutcome === 'passed' ? '✅' : '❌';
  const freshnessNote = options.fresh ? '' : ' (STALE — re-run required)';

  lines.push(`${statusIcon} Validation [${options.artifact.profile}]${freshnessNote}`);
  lines.push(`Candidate: ${options.artifact.candidateFingerprint.slice(0, 12)}`);
  lines.push(`Time: ${options.artifact.timestamp}`);

  for (const check of options.artifact.checks) {
    let icon: string;
    switch (check.outcome) {
      case 'passed':
        icon = '✅';
        break;
      case 'failed':
        icon = '❌';
        break;
      case 'unavailable':
        icon = '⚠️';
        break;
      case 'cancelled':
        icon = '🚫';
        break;
      default:
        icon = '⏭️';
    }
    const diag = check.diagnostics ? `: ${check.diagnostics.slice(0, 200)}` : '';
    lines.push(`  ${icon} ${check.label} (${check.outcome})${diag}`);
  }

  return lines.join('\n');
};
