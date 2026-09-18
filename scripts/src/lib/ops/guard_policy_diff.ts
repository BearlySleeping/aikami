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
import { readJsonAtRef, resolveBaseRef } from './guards/ratchet_io.ts';
import { isGuardPolicyPath } from './guards/registry.ts';
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

/** Reads a repo-relative JSON file at a ref, tolerating absence. */
const jsonAtRef = (ref: string, relPath: string): unknown => {
  const result = readJsonAtRef({ root: ROOT, ref, relPath });
  return result.status === 'ok' ? result.value : undefined;
};

const jsonFromDisk = (relPath: string): unknown => {
  const path = resolve(ROOT, relPath);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * The effective source-size allowance map for one revision.
 *
 * Reads BOTH the current split files and the legacy single-exceptions file, so
 * the migration itself is allowance-neutral: the ceiling a path had before is
 * compared to the ceiling it has now, regardless of which file expresses it.
 */
const sourceSizeAllowances = (read: (relPath: string) => unknown): Record<string, number> => {
  const exemptions: ExemptionSet = validateExemptions(read(EXEMPTIONS_REL)).exemptions;
  const waivers: WaiverSet = validateWaivers(read(WAIVERS_REL), { today: '0000-01-01' }).waivers;
  return effectiveAllowances({
    paths: [],
    isTestFile,
    budgetFor,
    baseline: allowanceBaselineOf(read(BASELINE_REL)),
    exemptions,
    waivers,
    legacyExceptions: legacyOf(read(LEGACY_EXCEPTIONS_REL)),
  });
};

const changedPaths = (base: string): string[] => {
  try {
    return execFileSync('git', ['diff', '--name-only', base], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const main = (): void => {
  const args = process.argv.slice(2);
  const baseRef = resolveBaseRef({ args });
  if (!baseRef) {
    console.log('✅ guard-policy diff skipped — no base revision configured');
    return;
  }

  const paths = changedPaths(baseRef);
  if (paths.length === 0) {
    // A ref that resolves to no diff is either a clean tree or an unreadable
    // ref. Distinguish so an unreadable CI base fails closed rather than
    // reporting a clean policy diff.
    const explicit = (process.env.BASE_REF ?? process.env.AIKAMI_GUARD_BASE_REF ?? '').trim();
    if (explicit.length > 0 && !existsSync(resolve(ROOT, '.git'))) {
      console.error(`🔴 could not diff against the explicit base revision ${baseRef}`);
      process.exit(1);
    }
    console.log(`✅ no changed files against ${baseRef} — nothing to classify`);
    return;
  }

  const policyPaths = paths.filter(isGuardPolicyPath);
  if (policyPaths.length === 0) {
    console.log(`✅ no guard-policy change in this diff (${paths.length} changed file(s) checked)`);
    return;
  }

  const touchesAllowances = policyPaths.some((path) => path.includes('guard_source_file_size'));
  const report = classifyPolicyChange({
    changedPaths: policyPaths,
    beforeAllowances: touchesAllowances
      ? sourceSizeAllowances((rel) => jsonAtRef(baseRef, rel))
      : undefined,
    afterAllowances: touchesAllowances ? sourceSizeAllowances(jsonFromDisk) : undefined,
    biomeBefore: policyPaths.includes(BIOME_REL) ? jsonAtRef(baseRef, BIOME_REL) : undefined,
    biomeAfter: policyPaths.includes(BIOME_REL) ? jsonFromDisk(BIOME_REL) : undefined,
  });

  const authorized = (process.env.AIKAMI_GUARD_POLICY_AUTHORIZATION ?? '').trim().length > 0;
  const lines = renderPolicyReport({ report, authorized });
  for (const line of lines) {
    console.log(line);
  }

  if (report.verdict === 'policy-expansion' && !authorized) {
    console.error(
      '\n🔴 guard-policy expansion without authorization — see the report above. Add the `guard-policy-approved` label (maintainer action) or revert the increase.',
    );
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}
