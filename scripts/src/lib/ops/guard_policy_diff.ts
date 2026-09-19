// scripts/src/lib/ops/guard_policy_diff.ts
//
// "Is this PR changing what counts as acceptable debt?"
//
// The individual guards already refuse to raise their own allowances (their
// trusted-base check). This check answers the complementary question at the
// whole-policy level and answers it in the CI summary, in one place, in
// language a reviewer can act on:
//
//   GUARD POLICY CHANGE
//   Verdict: POLICY EXPANSION — requires explicit human review
//
// It classifies every changed guard-policy file (guard implementations, ratchet
// baselines, waivers/exemptions, Biome lint severity, Moon guard tasks,
// validation policy, CI guard wiring) and compares the EFFECTIVE allowance
// across the two revisions, so a representation change is not mistaken for an
// expansion and an expansion cannot hide behind one.
//
// 🔴 It does not block by itself for every kind of policy change — a guard
// refactor must be able to land. It blocks exactly one thing: an allowance
// increase (or a relaxed lint severity) with no authorization. Authorization is
// the maintainer-applied `guard-policy-approved` label, surfaced to CI as
// AIKAMI_GUARD_POLICY_AUTHORIZATION.
//
// Usage:
//   bun run src/lib/ops/guard_policy_diff.ts [--base-ref=<ref>] [--json]
//
// Exits non-zero when an unauthorized policy expansion is detected.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { budgetFor, isTestFile } from './guard_source_file_size_helpers.ts';
import { classifyPolicyChange, renderPolicyReport } from './guards/policy_diff.ts';
import { parseCountsBaseline, parseLegacyCountsBaseline } from './guards/ratchet.ts';
import { readJsonAtRef, resolveBaseRef } from './guards/ratchet_io.ts';
import { isGuardPolicyPath, ratchetedGuards } from './guards/registry.ts';
import {
  type ExemptionSet,
  effectiveAllowances,
  type LegacyExceptionSet,
  validateExemptions,
  validateWaivers,
  type WaiverSet,
} from './guards/source_size_policy.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

const BASELINE_REL = 'scripts/src/lib/ops/guard_source_file_size_baseline.json';
const EXEMPTIONS_REL = 'scripts/src/lib/ops/guard_source_file_size_exemptions.json';
const WAIVERS_REL = 'scripts/src/lib/ops/guard_source_file_size_waivers.json';
const LEGACY_EXCEPTIONS_REL = 'scripts/src/lib/ops/guard_source_file_size_exceptions.json';
const BIOME_REL = 'biome.json';

const allowanceBaselineOf = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [path, value] of Object.entries(raw)) {
    if (!path.startsWith('_') && typeof value === 'number') {
      out[path] = value;
    }
  }
  return out;
};

const legacyOf = (raw: unknown): LegacyExceptionSet => {
  const out: LegacyExceptionSet = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    const maxLines = (value as { maxLines?: unknown })?.maxLines;
    if (typeof maxLines === 'number') {
      out[path] = { maxLines };
    }
  }
  return out;
};

/**
 * A policy file read, where "absent" and "unreadable" are different answers.
 *
 * 🔴 Collapsing them is a fail-open: a corrupted `…_waivers.json` would make the
 * "after" allowance map EMPTY, the diff would read that as every ceiling being
 * removed, and the classifier would report `DEBT REDUCTION` — the most
 * reassuring possible verdict for a file it could not read.
 */
type PolicyFileRead =
  | { ok: true; value: unknown; present: boolean }
  | { ok: false; reason: string };

/** Reads a repo-relative JSON file at a ref. Absence is fine; unreadable is not. */
const jsonAtRef = (ref: string, relPath: string): PolicyFileRead => {
  const result = readJsonAtRef({ root: ROOT, ref, relPath });
  if (result.status === 'unavailable') {
    return { ok: false, reason: `${ref}:${relPath} could not be read — ${result.message}` };
  }
  return {
    ok: true,
    value: result.status === 'ok' ? result.value : undefined,
    present: result.status === 'ok',
  };
};

const jsonFromDisk = (relPath: string): PolicyFileRead => {
  const path = resolve(ROOT, relPath);
  if (!existsSync(path)) {
    return { ok: true, value: undefined, present: false };
  }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) as unknown, present: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${relPath} is not valid JSON — ${message}` };
  }
};

/** Collects failures from a batch of policy reads. */
class PolicyReadErrors {
  readonly reasons: string[] = [];

  /** The value, or `undefined` when the file is absent or unreadable. */
  value(read: PolicyFileRead): unknown {
    if (read.ok) {
      return read.value;
    }
    this.reasons.push(read.reason);
    return undefined;
  }

  /** True when the file exists at this revision. */
  present(read: PolicyFileRead): boolean {
    if (read.ok) {
      return read.present;
    }
    this.reasons.push(read.reason);
    return false;
  }
}

/**
 * The effective source-size allowance map for one revision.
 *
 * Reads BOTH the current split files and the legacy single-exceptions file, so
 * the migration itself is allowance-neutral: the ceiling a path had before is
 * compared to the ceiling it has now, regardless of which file expresses it.
 */
const sourceSizeAllowances = (
  read: (relPath: string) => PolicyFileRead,
  errors: PolicyReadErrors,
): Record<string, number> => {
  const exemptions: ExemptionSet = validateExemptions(
    errors.value(read(EXEMPTIONS_REL)),
  ).exemptions;
  const waivers: WaiverSet = validateWaivers(errors.value(read(WAIVERS_REL)), {
    today: '0000-01-01',
  }).waivers;
  return effectiveAllowances({
    paths: [],
    isTestFile,
    budgetFor,
    baseline: allowanceBaselineOf(errors.value(read(BASELINE_REL))),
    exemptions,
    waivers,
    legacyExceptions: legacyOf(errors.value(read(LEGACY_EXCEPTIONS_REL))),
  });
};

/**
 * Effective allowances for every ratcheted COUNT baseline, at one revision.
 *
 * 🔴 The policy classifier must see every ratchet, not just the source-size
 * ones: raising `guard_type_safety_baseline.json` is the same class of change as
 * raising a line ceiling, and it must be classified the same way. The individual
 * guards still enforce it; this makes the CI SUMMARY say so.
 */
const ratchetAllowances = (
  read: (relPath: string) => PolicyFileRead,
  errors: PolicyReadErrors,
  options: { only?: ReadonlySet<string> },
): Record<string, number> => {
  const allowances: Record<string, number> = {};
  for (const guard of ratchetedGuards()) {
    if (guard.baseline === undefined) {
      continue;
    }
    if (options.only !== undefined && !options.only.has(guard.id)) {
      continue;
    }
    collectGuardAllowances({ guard, read, errors, into: allowances });
  }
  return allowances;
};

/** Flattens one guard's baseline into namespaced per-rule allowances. */
const collectGuardAllowances = (options: {
  guard: { id: string; baseline?: string };
  read: (relPath: string) => PolicyFileRead;
  errors: PolicyReadErrors;
  into: Record<string, number>;
}): void => {
  const baselinePath = options.guard.baseline;
  if (baselinePath === undefined) {
    return;
  }
  const raw = options.errors.value(options.read(baselinePath));
  // 🔴 The base revision may still carry a PRE-FRAMEWORK baseline shape (a flat
  // per-rule map, or an orphan symbol list). Reading it through the legacy
  // parser keeps a representation migration allowance-neutral — without it, the
  // canonical parser returns an empty baseline and every entry on this side
  // looks like a brand-new allowance.
  const canonical = parseCountsBaseline(raw, baselinePath);
  const legacy =
    canonical.errors.length > 0 ? parseLegacyCountsBaseline(raw, baselinePath) : undefined;
  const parsed = legacy !== undefined && legacy.errors.length === 0 ? legacy : canonical;
  for (const [file, entry] of Object.entries(parsed.baseline)) {
    for (const [rule, count] of Object.entries(entry.counts)) {
      // Namespaced so two guards' entries for the same path cannot collide.
      options.into[`${options.guard.id}:${file}#${rule}`] = count;
    }
  }
};

/**
 * The ratchets that already existed at a revision.
 *
 * 🔴 A guard whose baseline file does not exist at the base revision is being
 * INTRODUCED by this diff, not relaxed by it. Its entries must therefore be
 * excluded from BOTH sides of the comparison — excluding them from only one side
 * makes every entry look like a brand-new allowance, and the classifier reports
 * the largest possible expansion for the act of adding a check.
 */
const ratchetsExistingAt = (baseRef: string): Set<string> => {
  const ids = new Set<string>();
  const errors = new PolicyReadErrors();
  for (const guard of ratchetedGuards()) {
    if (guard.baseline === undefined) {
      continue;
    }
    if (errors.present(jsonAtRef(baseRef, guard.baseline))) {
      ids.add(guard.id);
    }
  }
  return ids;
};

/**
 * Paths whose change alters what counts as acceptable debt.
 *
 * Derived from the registry, so a newly added ratchet's baseline is classified
 * automatically.
 */
const ratchetBaselinePaths = (): string[] =>
  ratchetedGuards()
    .map((guard) => guard.baseline)
    .filter((baseline): baseline is string => baseline !== undefined);

type DiffResult = { ok: true; paths: string[] } | { ok: false; message: string };

/**
 * The paths that differ between a base revision and the working tree.
 *
 * 🔴 A git failure is NOT an empty diff. Returning `[]` for both would let an
 * unreadable base revision — a shallow clone, a wrong ref, a missing git — read
 * as "no policy change", which is exactly the fail-open this check exists to
 * prevent.
 */
const changedPaths = (base: string): DiffResult => {
  try {
    return {
      ok: true,
      paths: execFileSync('git', ['diff', '--name-only', base], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message.split('\n')[0] ?? message };
  }
};

/**
 * Effective allowances for one revision, covering every ratchet the diff touches.
 *
 * 🔴 Both halves are derived from the registry, so a newly added ratchet is
 * classified automatically rather than needing a second hand-written list.
 */
const allowancesAt = (options: {
  read: (relPath: string) => PolicyFileRead;
  errors: PolicyReadErrors;
  touchesRatchets: boolean;
  touchesSourceSize: boolean;
  /** Ratchets that existed at the base revision; newly added ones are excluded. */
  existingRatchets: ReadonlySet<string>;
}): Record<string, number> => ({
  ...(options.touchesRatchets
    ? ratchetAllowances(options.read, options.errors, { only: options.existingRatchets })
    : {}),
  ...(options.touchesSourceSize ? sourceSizeAllowances(options.read, options.errors) : {}),
});

/** What the two revisions' allowances are, plus any file that could not be read. */
type AllowanceComparison = {
  beforeAllowances?: Record<string, number>;
  afterAllowances?: Record<string, number>;
  biomeBefore?: unknown;
  biomeAfter?: unknown;
  readErrors: string[];
};

/** Gathers every allowance this diff needs to compare, collecting read failures. */
const collectAllowanceComparison = (options: {
  baseRef: string;
  policyPaths: readonly string[];
}): AllowanceComparison => {
  const touchesSourceSize = options.policyPaths.some((path) =>
    path.includes('guard_source_file_size'),
  );
  const touchesRatchets = ratchetBaselinePaths().some((path) => options.policyPaths.includes(path));
  const touchesBiome = options.policyPaths.includes(BIOME_REL);
  const hasAllowances = touchesRatchets || touchesSourceSize;

  const beforeErrors = new PolicyReadErrors();
  const afterErrors = new PolicyReadErrors();
  const existingRatchets = touchesRatchets
    ? ratchetsExistingAt(options.baseRef)
    : new Set<string>();

  const side = (
    read: (relPath: string) => PolicyFileRead,
    errors: PolicyReadErrors,
  ): Record<string, number> | undefined =>
    hasAllowances
      ? allowancesAt({ read, errors, touchesRatchets, touchesSourceSize, existingRatchets })
      : undefined;

  const comparison: AllowanceComparison = {
    beforeAllowances: side((rel) => jsonAtRef(options.baseRef, rel), beforeErrors),
    afterAllowances: side(jsonFromDisk, afterErrors),
    ...(touchesBiome
      ? {
          biomeBefore: beforeErrors.value(jsonAtRef(options.baseRef, BIOME_REL)),
          biomeAfter: afterErrors.value(jsonFromDisk(BIOME_REL)),
        }
      : {}),
    readErrors: [],
  };
  comparison.readErrors = [...beforeErrors.reasons, ...afterErrors.reasons];
  return comparison;
};

/**
 * Classifies and reports a policy change; exits non-zero on an unauthorized
 * expansion, and on any policy file it could not read.
 */
const reportPolicyChange = (options: { baseRef: string; policyPaths: readonly string[] }): void => {
  const comparison = collectAllowanceComparison(options);

  if (comparison.readErrors.length > 0) {
    // An unreadable policy file is an unreadable AUTHORITY. Classifying the
    // comparison anyway would produce a confident verdict from a partial read.
    console.error('🔴 could not read the policy files this comparison needs:');
    for (const reason of comparison.readErrors) {
      console.error(`      ${reason}`);
    }
    console.error(
      '   Refusing to classify a policy change from an incomplete comparison. Fix the file(s) or the base revision.',
    );
    process.exit(1);
  }

  const { beforeAllowances, afterAllowances, biomeBefore, biomeAfter } = comparison;
  const report = classifyPolicyChange({
    changedPaths: options.policyPaths,
    ...(beforeAllowances !== undefined && afterAllowances !== undefined
      ? { beforeAllowances, afterAllowances }
      : {}),
    ...(options.policyPaths.includes(BIOME_REL) ? { biomeBefore, biomeAfter } : {}),
  });

  const authorized = (process.env.AIKAMI_GUARD_POLICY_AUTHORIZATION ?? '').trim().length > 0;
  for (const line of renderPolicyReport({ report, authorized })) {
    console.log(line);
  }

  if (report.verdict === 'policy-expansion' && !authorized) {
    console.error(
      '\n🔴 guard-policy expansion without authorization — see the report above. Add the `guard-policy-approved` label (maintainer action) or revert the increase.',
    );
    process.exit(1);
  }
};

const main = (): void => {
  const baseRef = resolveBaseRef({ args: process.argv.slice(2) });
  if (!baseRef) {
    console.log('✅ guard-policy diff skipped — no base revision configured');
    return;
  }

  const diff = changedPaths(baseRef);
  if (!diff.ok) {
    // An explicit base revision that cannot be diffed is an unreadable
    // authority, and an unreadable authority fails closed.
    console.error(
      `🔴 could not diff against the base revision ${baseRef} — ${diff.message}. Refusing to report a clean policy diff from a comparison that did not happen.`,
    );
    process.exit(1);
  }

  if (diff.paths.length === 0) {
    console.log(`✅ no changed files against ${baseRef} — nothing to classify`);
    return;
  }

  const policyPaths = diff.paths.filter(isGuardPolicyPath);
  if (policyPaths.length === 0) {
    console.log(
      `✅ no guard-policy change in this diff (${diff.paths.length} changed file(s) checked)`,
    );
    return;
  }

  reportPolicyChange({ baseRef, policyPaths });
};

if (import.meta.main) {
  main();
}
