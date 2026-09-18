// scripts/src/lib/ops/guards/ratchet_runner.ts
//
// The shared CLI shell for a ratcheted guard.
//
// Every ratcheted guard needs the same five things, and they are the five
// things that used to be re-implemented (and re-broken) per guard:
//
//   1. load the baseline and report a malformed one as a failure;
//   2. compare it to the tree and report growth;
//   3. refuse `--update-baseline` when it would add or raise debt;
//   4. check the result against the trusted base revision, failing closed when
//      an explicitly configured authority cannot be read;
//   5. tell the agent what to actually do — never "raise the baseline".
//
// A guard supplies only its own domain knowledge: which rules exist, which
// violations are present, and which violations are hard invariants that fail
// regardless of any baseline. Everything else is here.
//
// 🔴 This is deliberately a *runner*, not an engine. It knows nothing about
// TypeScript, Svelte, Biome or line counts; it operates on the `ratchet.ts`
// vocabulary. A guard that needs semantics this cannot express should keep
// them locally rather than grow this file.

import { annotate } from '../gha_annotate.ts';
import {
  baselineFromViolations,
  contractCounts,
  diffCounts,
  parseCountsBaseline,
  parseLegacyCountsBaseline,
  type RatchetBaseline,
  type RatchetChange,
  type RatchetDiff,
  type RatchetRuleSpec,
  type RatchetViolation,
  renderExpansions,
  renderReductions,
  serializeCounts,
  stripIdentities,
} from './ratchet.ts';
import { readJsonAtRef, readJsonFileSafe, resolveBaseRef, writeTextFile } from './ratchet_io.ts';

const bullet = '      ';

export type RatchetRunOptions = {
  /** Short guard name used in diagnostics, e.g. `type-safety`. */
  name: string;
  /** Repository root, for git-ref reads. */
  root: string;
  /** Absolute path of the baseline file. */
  baselinePath: string;
  /** Repo-relative path of the baseline file (for `git show`). */
  baselineRelPath: string;
  /** The ratcheted rules this guard owns. */
  rules: readonly RatchetRuleSpec[];
  /** Every ratcheted violation present in the tree right now. */
  violations: readonly RatchetViolation[];
  /**
   * The tree's ratchet baseline. Defaults to folding `violations` into
   * per-rule counts. Supply it explicitly when a guard ratchets a derived
   * quantity as well as a count — e.g. the cognitive-complexity guard records
   * both the number of excessive functions and the worst score in the file.
   */
  current?: RatchetBaseline;
  /** Number of hard (non-ratcheted) violations the caller already reported. */
  hardFailures: number;
  /** Configuration errors the caller already reported. */
  configErrors?: readonly string[];
  /** Whether this guard records violation identities. */
  identityAware: boolean;
  args: readonly string[];
  env?: Record<string, string | undefined>;
  /** Line appended to the pass message, e.g. totals. */
  summary?: string;
  /** Message shown after a successful contraction. */
  contractionSummary?: string;
  /** Parses the on-disk baseline. Defaults to the canonical shape. */
  parseBaseline?: (raw: unknown, label: string) => { baseline: RatchetBaseline; errors: string[] };
};

/** Emits a GitHub annotation for a violation, matching the other guards. */
const annotateViolation = (name: string, violation: RatchetViolation): void => {
  annotate({
    file: violation.file,
    line: violation.line,
    message: violation.message,
    title: `${name} guard`,
  });
};

const printChanges = (options: {
  changes: readonly RatchetChange[];
  rules: readonly RatchetRuleSpec[];
  label: string;
}): void => {
  for (const line of renderExpansions(options)) {
    console.error(line);
  }
};

/**
 * Runs the standard ratchet lifecycle and exits the process.
 *
 * Exits 0 only when: no hard violation, no config error, no baseline growth,
 * no unlocked reduction, and the trusted-base check passed (or was not
 * configured).
 */
export const runRatchet = (options: RatchetRunOptions): void => {
  const args = options.args;
  const env = options.env ?? process.env;
  const parse = options.parseBaseline ?? parseCountsBaseline;

  const loaded = readJsonFileSafe(options.baselinePath, options.baselineRelPath);
  if (!loaded.ok) {
    console.error(`❌ ${loaded.error}`);
    process.exit(1);
  }
  const parsed = parse(loaded.value, options.baselineRelPath);
  if (parsed.errors.length > 0) {
    console.error(`❌ malformed ${options.baselineRelPath}`);
    for (const error of parsed.errors) {
      console.error(`${bullet}${error}`);
    }
    process.exit(1);
  }

  // `--show-all` reports the true state of the tree, ignoring what has already
  // been accepted. It never writes the baseline.
  const baseline = args.includes('--show-all') ? {} : parsed.baseline;
  const current =
    options.current ??
    baselineFromViolations({
      violations: options.violations,
      identityAware: options.identityAware,
    });
  const diff = diffCounts({ baseline, current });

  if (args.includes('--bootstrap-baseline')) {
    runBootstrap({ options, existing: loaded.value, current });
    return;
  }
  if (args.includes('--update-baseline')) {
    runContraction({ options, args, baseline, current, diff });
    return;
  }

  runCheckMode({ options, env, parse, baseline, current, diff });
};

/**
 * The one-time, reviewed act that records the debt present when a guard is
 * introduced. It refuses to run twice, so it can never be used as an "accept
 * the current state" command on an established baseline.
 */
const runBootstrap = (input: {
  options: RatchetRunOptions;
  existing: unknown;
  current: RatchetBaseline;
}): void => {
  const { options, existing, current } = input;
  if (existing !== undefined) {
    console.error(
      `🔴 ${options.baselineRelPath} already exists. Bootstrap is a one-time, reviewed act; use --update-baseline to shrink it.`,
    );
    process.exit(1);
  }
  writeTextFile(options.baselinePath, serializeCounts(current));
  console.log(
    `✅ Bootstrapped ${options.baselineRelPath}: ${Object.keys(current).length} file(s) with recorded debt`,
  );
};

/** Reduction-only contraction of the baseline onto the current tree. */
const runContraction = (input: {
  options: RatchetRunOptions;
  args: readonly string[];
  baseline: RatchetBaseline;
  current: RatchetBaseline;
  diff: RatchetDiff;
}): void => {
  const { options, baseline, current, diff } = input;
  if (input.args.includes('--show-all')) {
    console.error('🔴 --update-baseline and --show-all are mutually exclusive');
    process.exit(1);
  }
  if (diff.expansions.length > 0) {
    printChanges({
      changes: diff.expansions,
      rules: options.rules,
      label: `${options.name} guard refusing --update-baseline`,
    });
    process.exit(1);
  }
  const configErrorCount = options.configErrors?.length ?? 0;
  if (options.hardFailures > 0 || configErrorCount > 0) {
    console.error(
      `🔴 refusing --update-baseline while ${options.hardFailures} hard violation(s) and ${configErrorCount} configuration error(s) are outstanding — fix those first`,
    );
    process.exit(1);
  }
  const next = contractCounts({ baseline, current });
  writeTextFile(options.baselinePath, serializeCounts(next));
  console.log(
    options.contractionSummary ??
      `✅ ${options.name} baseline contracted: ${Object.keys(baseline).length} → ${Object.keys(next).length} file(s) with recorded debt`,
  );
};

/**
 * Trusted-base enforcement.
 *
 * Reductions and removals are always fine; growth relative to the base revision
 * is not.
 *
 * 🔴 `AIKAMI_GUARD_POLICY_AUTHORIZATION` is the ONE explicit override. CI sets
 * it from a maintainer-applied `guard-policy-approved` label; an agent cannot
 * apply a label. It downgrades an expansion from a failure to a loudly-reported,
 * recorded review — it never authorizes `--update-baseline` to expand, which the
 * expansion check above already refuses unconditionally.
 *
 * 🔴 The base revision may still carry a PRE-FRAMEWORK baseline shape (flat
 * per-rule counts, or an orphan symbol list). It is read through the legacy
 * parser so a representation migration is allowance-neutral rather than reported
 * as a parse failure — the migration changes how the debt is written down, not
 * how much of it is accepted.
 *
 * Identities are dropped from the trusted side on purpose: a violation's
 * identity is derived from the code at that revision, so comparing it across
 * revisions would flag every legitimate edit to an accepted violation. The
 * identity check that matters — a swap on THIS branch — is done against the
 * branch's own baseline.
 */
const trustedBaseErrors = (input: {
  options: RatchetRunOptions;
  env: Record<string, string | undefined>;
  parse: (raw: unknown, label: string) => { baseline: RatchetBaseline; errors: string[] };
  current: RatchetBaseline;
}): string[] => {
  const { options, env, parse, current } = input;
  const baseRef = resolveBaseRef({ args: options.args, env });
  if (!baseRef) {
    return [];
  }
  const authorized = (env.AIKAMI_GUARD_POLICY_AUTHORIZATION ?? '').trim().length > 0;
  const trusted = readJsonAtRef({
    root: options.root,
    ref: baseRef,
    relPath: options.baselineRelPath,
  });

  // `missing` = the baseline did not exist at that revision: the bootstrap
  // case, where there is nothing to be stricter than.
  if (trusted.status === 'missing') {
    return [];
  }
  if (trusted.status === 'unavailable') {
    console.log(`⚠️  base-revision check skipped (${baseRef}): ${trusted.message.split('\n')[0]}`);
    return [
      `could not verify ${options.baselineRelPath} against the explicit base revision ${baseRef} — an unreadable authority is not the same as no authority, so this fails closed`,
    ];
  }

  const label = `${baseRef}:${options.baselineRelPath}`;
  const canonical = parse(trusted.value, label);
  const legacy =
    canonical.errors.length > 0 ? parseLegacyCountsBaseline(trusted.value, label) : undefined;
  const usable = legacy !== undefined && legacy.errors.length === 0 ? legacy : canonical;
  if (usable.errors.length > 0) {
    return [`${label} is not a readable baseline — ${usable.errors[0]}`];
  }

  const against = diffCounts({
    baseline: stripIdentities(usable.baseline),
    current: stripIdentities(current),
  });
  const errors: string[] = [];
  for (const change of against.expansions) {
    const line = `expansion vs ${baseRef}: ${change.file} [${change.rule}] ${change.detail}`;
    if (authorized) {
      console.error(`🔑 GUARD POLICY CHANGE (authorized) — ${line}`);
    } else {
      errors.push(`unauthorized ${line}`);
    }
  }
  return errors;
};

/** Reports every expansion with the offending violations annotated. */
const reportExpansions = (input: { options: RatchetRunOptions; diff: RatchetDiff }): void => {
  const { options, diff } = input;
  if (diff.expansions.length === 0) {
    return;
  }
  printChanges({
    changes: diff.expansions,
    rules: options.rules,
    label: `${options.name} guard failed`,
  });
  for (const change of diff.expansions) {
    for (const violation of options.violations) {
      if (violation.file !== change.file) {
        continue;
      }
      if (change.rule !== '*' && violation.rule !== change.rule) {
        continue;
      }
      console.error(`${bullet}  line ${violation.line}: ${violation.message}`);
      annotateViolation(options.name, violation);
    }
  }
};

/** Check mode: report expansions, unlocked reductions and configuration issues. */
const runCheckMode = (input: {
  options: RatchetRunOptions;
  env: Record<string, string | undefined>;
  parse: (raw: unknown, label: string) => { baseline: RatchetBaseline; errors: string[] };
  baseline: RatchetBaseline;
  current: RatchetBaseline;
  diff: RatchetDiff;
}): void => {
  const { options, diff } = input;
  const configErrors = [
    ...(options.configErrors ?? []),
    ...trustedBaseErrors({ options, env: input.env, parse: input.parse, current: input.current }),
  ];

  if (diff.reductions.length > 0 || diff.stale.length > 0) {
    for (const line of renderReductions({ changes: diff.reductions, stale: diff.stale })) {
      console.log(line);
    }
  }
  reportExpansions({ options, diff });

  if (configErrors.length > 0) {
    console.error('❌ baseline/trusted-base configuration');
    for (const error of configErrors) {
      console.error(`${bullet}${error}`);
    }
  }

  const unlocked = diff.reductions.length + diff.stale.length;
  const failed =
    diff.expansions.length > 0 ||
    configErrors.length > 0 ||
    options.hardFailures > 0 ||
    unlocked > 0;
  if (!failed) {
    console.log(
      `✅ ${options.name} guard passed — recorded debt holds${options.summary ? ` (${options.summary})` : ''}`,
    );
    return;
  }

  if (unlocked > 0 && diff.expansions.length === 0 && configErrors.length === 0) {
    console.error(
      `🔴 ${options.name} guard failed — recorded debt shrank but the reduction is not locked in. Run --update-baseline (the sanctioned validation flow does this for you).`,
    );
  } else {
    console.error(
      `🔴 ${options.name} guard failed — ${diff.expansions.length} growth, ${unlocked} unlocked reduction, ${configErrors.length} config issue(s)`,
    );
  }
  process.exit(1);
};

/** Prints hard-invariant violations and annotations; returns the count. */
export const printHardViolations = (options: {
  name: string;
  violations: readonly RatchetViolation[];
  heading: string;
}): number => {
  if (options.violations.length === 0) {
    return 0;
  }
  const byFile = new Map<string, RatchetViolation[]>();
  for (const violation of options.violations) {
    byFile.set(violation.file, [...(byFile.get(violation.file) ?? []), violation]);
  }
  for (const [file, violations] of byFile) {
    console.error(`❌ ${file}`);
    for (const violation of violations) {
      console.error(`${bullet}${file}:${violation.line} [${violation.rule}] ${violation.message}`);
      annotateViolation(options.name, violation);
    }
  }
  console.error(`\n${options.heading}`);
  return options.violations.length;
};
