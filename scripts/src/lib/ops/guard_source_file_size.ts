// scripts/src/lib/ops/guard_source_file_size.ts
//
// Source-file-size guard: a coarse signal for module responsibility.
//
// 🔴 This is NOT an architecture proof and NOT a complexity metric. A 400-line
// file can be a mess; a 3000-line declarative country table can be perfectly
// cohesive. The guard stops NEW oversized, multi-responsibility modules and
// keeps existing ones from growing. Cognitive complexity is the independent
// signal for "the control flow is too hard to follow" — see
// guard_cognitive_complexity.ts. Do not conflate them.
//
// Three tiers:
//
//   • Warning (non-failing): production > 500 physical lines, tests > 800.
//   • Hard limit: production > 800, tests > 1500.
//   • Grandfathered baseline: files already over the hard limit when the guard
//     was introduced are recorded at their exact size in
//     guard_source_file_size_baseline.json. They may not grow, and a reduction
//     must be locked in so the freed headroom cannot be re-consumed.
//
// ── Two escape hatches, two very different meanings ──────────────────────
//
// PERMANENT EXEMPTION (guard_source_file_size_exemptions.json)
//   Declarative data, a generated-but-tracked artifact, or a cohesive fixture.
//   No expiry, but the classification is VERIFIED against the file: a
//   "declarative" exemption may contain no logic at all, a "generated" one must
//   match a generated-file convention or name the source it is derived from.
//
// TEMPORARY WAIVER (guard_source_file_size_waivers.json)
//   A mutable module above the hard limit. Requires `issue` AND `reviewBy`;
//   expires; and its ceiling is a RATCHET — it may be lowered, never raised,
//   never invented for a new file.
//
// ── What the guard refuses ──────────────────────────────────────────────
//
//   • `--update-baseline` is REDUCTION-ONLY.
//   • Any growth of the EFFECTIVE ALLOWANCE against the trusted base revision
//     (`--base-ref` / AIKAMI_GUARD_BASE_REF / BASE_REF) is rejected — see
//     `trustedBaseErrors` below. This compares the single ceiling a path
//     actually has, whichever file expresses it, so a baseline entry cannot be
//     laundered into a larger waiver, and the pre-split exceptions file cannot
//     be used to smuggle an increase.
//   • An expired waiver, an obsolete exemption, a malformed entry, and a
//     baseline entry that no longer resolves are all failures.
//
// The only way past the trusted-base check is the explicit, human-controlled
// authorization channel (`AIKAMI_GUARD_POLICY_AUTHORIZATION`, set by CI from a
// maintainer-applied `guard-policy-approved` label). An agent cannot apply a
// label.
//
// Usage:
//   bun run src/lib/ops/guard_source_file_size.ts [--show-all] [--report]
//     [--update-baseline | --bootstrap-baseline] [--base-ref=<ref>]
//
// Exits non-zero on any oversized file, baseline growth, unlocked reduction,
// malformed/obsolete/expired entry, laundering attempt, or unauthorized
// allowance expansion against the trusted base revision.

import { type Dirent, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  budgetFor,
  countPhysicalLines,
  isExcludedDir,
  isGeneratedFile,
  isSourceFile,
  isTestFile,
  type ScannedFile,
} from './guard_source_file_size_helpers.ts';
import {
  type FileAssessment,
  printFailures,
  printReport,
  printThresholdReport,
  printWarnings,
} from './guard_source_file_size_output.ts';
import {
  type AllowanceBaseline,
  diffAllowances,
  renderExpansions,
  serializeAllowances,
} from './guards/ratchet.ts';
import { resolveBaseRef } from './guards/ratchet_io.ts';
import {
  allowanceMap,
  BASELINE_PATH,
  checkConfiguration,
  expiredWaivers,
  loadPolicy,
  type Policy,
  ROOT,
  readTrustedSide,
  relFromRoot,
} from './guards/source_size_config.ts';
import {
  assessFile,
  oversizedMutableModuleMessage,
  type WaiverSet,
} from './guards/source_size_policy.ts';

const SCAN_ROOTS = ['apps', 'packages', 'scripts', '.pi'].map((dir) => resolve(ROOT, dir));

// ── File discovery ───────────────────────────────────────────────────────

const scanSources = (): { files: ScannedFile[]; generatedExcluded: number } => {
  const files: ScannedFile[] = [];
  let generatedExcluded = 0;

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      const rel = relFromRoot(full);
      if (entry.isDirectory()) {
        if (isExcludedDir({ name: entry.name, relPath: rel })) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) {
        continue;
      }
      if (isGeneratedFile(rel)) {
        generatedExcluded++;
        continue;
      }
      let content: string;
      try {
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      files.push({
        path: rel,
        lines: countPhysicalLines(content),
        kind: isTestFile(rel) ? 'test' : 'production',
      });
    }
  };

  for (const root of SCAN_ROOTS) {
    walk(root);
  }
  return { files, generatedExcluded };
};

// ── Modes ────────────────────────────────────────────────────────────────

const currentOverHard = (options: {
  files: readonly ScannedFile[];
  exemptions: Policy['exemptions'];
  waivers: WaiverSet;
}): AllowanceBaseline => {
  const baseline: AllowanceBaseline = {};
  for (const file of options.files) {
    if (options.exemptions[file.path] || options.waivers[file.path]) {
      continue;
    }
    if (file.lines > budgetFor(file.kind).hard) {
      baseline[file.path] = file.lines;
    }
  }
  return baseline;
};

const runBootstrap = (options: {
  files: readonly ScannedFile[];
  exemptions: Policy['exemptions'];
  waivers: WaiverSet;
}): void => {
  if (existsSync(BASELINE_PATH)) {
    console.error(
      `🔴 ${relFromRoot(BASELINE_PATH)} already exists. Bootstrap is a one-time, reviewed act; use --update-baseline to shrink it.`,
    );
    process.exit(1);
  }
  const baseline = currentOverHard(options);
  writeFileSync(BASELINE_PATH, serializeAllowances(baseline));
  console.log(
    `✅ Bootstrapped ${relFromRoot(BASELINE_PATH)}: ${Object.keys(baseline).length} over-limit file(s) grandfathered`,
  );
};

const runUpdate = (options: {
  files: readonly ScannedFile[];
  exemptions: Policy['exemptions'];
  waivers: WaiverSet;
  baseline: AllowanceBaseline;
}): void => {
  const next = currentOverHard(options);
  const diff = diffAllowances({ trusted: options.baseline, current: next });
  if (diff.expansions.length > 0) {
    for (const line of renderExpansions({
      changes: diff.expansions,
      rules: [],
      label: 'source-file-size guard refusing --update-baseline',
    })) {
      console.error(line);
    }
    console.error(
      '      --update-baseline synchronizes reductions only. A new oversized module is a defect to fix,\n' +
        '      not a baseline entry to add.',
    );
    process.exit(1);
  }
  // Reduction-only contraction: existing paths shrink, superseded/removed
  // entries disappear, and no new path is ever written.
  const contracted: AllowanceBaseline = {};
  for (const [path, value] of Object.entries(next).sort(([a], [b]) => a.localeCompare(b))) {
    const before = options.baseline[path];
    if (before === undefined) {
      continue;
    }
    contracted[path] = Math.min(before, value);
  }
  writeFileSync(BASELINE_PATH, serializeAllowances(contracted));
  const removed = Object.keys(options.baseline).filter(
    (path) => contracted[path] === undefined,
  ).length;
  console.log(
    `✅ Baseline contracted: ${Object.keys(options.baseline).length} → ${Object.keys(contracted).length} file(s) (${removed} graduated/removed)`,
  );
};

/** Classifies every file and splits the result into failures/warnings/reductions. */
const assessAll = (options: {
  files: readonly ScannedFile[];
  policy: Policy;
}): { failures: FileAssessment[]; warnings: FileAssessment[]; reductions: FileAssessment[] } => {
  const failures: FileAssessment[] = [];
  const warnings: FileAssessment[] = [];
  const reductions: FileAssessment[] = [];
  for (const file of [...options.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const assessment = assessFile({
      kind: file.kind,
      lines: file.lines,
      baselineLines: options.policy.baseline[file.path],
      exemption: options.policy.exemptions[file.path],
      waiver: options.policy.waivers[file.path],
      budgetFor,
    });
    if (assessment.status === 'warning') {
      warnings.push({ file, assessment });
    } else if (assessment.status === 'reduction') {
      reductions.push({ file, assessment });
    } else if (assessment.status === 'over-limit') {
      failures.push({ file, assessment });
    }
  }
  return { failures, warnings, reductions };
};

/**
 * Effective-allowance comparison against the trusted base revision.
 *
 * 🔴 This is what closes the laundering hole: it compares the single ceiling a
 * path actually has, whichever file expresses it, so a baseline entry cannot be
 * converted into a larger waiver, and the pre-split exceptions file cannot be
 * used to smuggle an increase.
 */
const trustedBaseErrors = (options: {
  files: readonly ScannedFile[];
  policy: Policy;
  args: readonly string[];
}): string[] => {
  const baseRef = resolveBaseRef({ args: options.args });
  if (!baseRef) {
    return [];
  }
  const authorized = (process.env.AIKAMI_GUARD_POLICY_AUTHORIZATION ?? '').trim().length > 0;
  const trusted = readTrustedSide(baseRef);

  if (trusted.status === 'missing') {
    return [];
  }
  if (trusted.status === 'unavailable') {
    console.log(`⚠️  base-revision check skipped (${baseRef}): ${trusted.message.split('\n')[0]}`);
    return [
      `could not verify the source-size policy against the explicit base revision ${baseRef} — an unreadable authority is not the same as no authority, so this fails closed`,
    ];
  }

  const diff = diffAllowances({
    trusted: allowanceMap({ files: options.files, ...trusted.side }),
    current: allowanceMap({
      files: options.files,
      baseline: options.policy.baseline,
      exemptions: options.policy.exemptions,
      waivers: options.policy.waivers,
    }),
  });

  const errors: string[] = [];
  for (const change of diff.expansions) {
    const line = `${change.file}: ${change.detail}`;
    if (authorized) {
      console.error(`🔑 GUARD POLICY CHANGE (authorized) — ${line}`);
    } else {
      errors.push(
        `unauthorized allowance expansion vs ${baseRef} — ${line}. Raising an accepted ceiling (including by converting a baseline entry into a larger waiver or exemption) is a guard-policy expansion and requires explicit human review.`,
      );
    }
  }
  return errors;
};

const runCheck = (options: {
  files: readonly ScannedFile[];
  policy: Policy;
  generatedExcluded: number;
  showAll: boolean;
  report: boolean;
  args: readonly string[];
}): void => {
  const { files, policy, showAll, report } = options;
  const { failures, warnings, reductions } = assessAll({ files, policy });

  const configErrors = [
    ...policy.errors,
    ...checkConfiguration({
      files,
      baseline: policy.baseline,
      exemptions: policy.exemptions,
      waivers: policy.waivers,
      waiverExpired: expiredWaivers(),
    }),
    ...trustedBaseErrors({ files, policy, args: options.args }),
  ];

  if (warnings.length > 0) {
    printWarnings(warnings);
  }
  if (failures.length > 0) {
    printFailures(failures);
    // The remediation must never suggest raising a ceiling.
    for (const { file, assessment } of failures) {
      if (assessment.source === 'waiver' || assessment.source === 'exemption') {
        console.error(
          `\n      ${oversizedMutableModuleMessage({
            path: file.path,
            lines: file.lines,
            ceiling: assessment.allowance ?? 0,
            source: assessment.source,
          })}`,
        );
      }
    }
  }
  if (reductions.length > 0) {
    console.log(
      `\n✅ ${reductions.length} baselined file(s) shrank — the sanctioned validation flow can lock the reduction in automatically.`,
    );
    for (const { file, assessment } of reductions) {
      console.log(`      ${file.path}: ${assessment.detail}`);
    }
  }
  if (configErrors.length > 0) {
    console.error('❌ exemption/waiver/baseline configuration');
    for (const error of configErrors) {
      console.error(`      ${error}`);
    }
  }
  if (showAll) {
    printReport({
      files,
      generatedExcluded: options.generatedExcluded,
      assess: (file) =>
        assessFile({
          kind: file.kind,
          lines: file.lines,
          baselineLines: policy.baseline[file.path],
          exemption: policy.exemptions[file.path],
          waiver: policy.waivers[file.path],
          budgetFor,
        }),
    });
  }
  if (report) {
    printThresholdReport({
      files,
      exemptions: policy.exemptions,
      waivers: policy.waivers,
      baseline: policy.baseline,
    });
  }

  if (failures.length + configErrors.length + reductions.length > 0) {
    console.error(
      `\n🔴 source-file-size guard failed — ${failures.length} oversized, ${reductions.length} unlocked reduction(s), ${configErrors.length} config issue(s)`,
    );
    process.exit(1);
  }

  console.log(
    `✅ source-file-size guard passed — ${files.length} file(s) checked, ${Object.keys(policy.baseline).length} baselined, ${Object.keys(policy.exemptions).length} exempt, ${Object.keys(policy.waivers).length} waived, ${warnings.length} warning(s) (non-failing)`,
  );
};

// ── Entry point ──────────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const policy = loadPolicy();
  if (policy.errors.length > 0) {
    console.error('❌ malformed source-size policy files');
    for (const error of policy.errors) {
      console.error(`      ${error}`);
    }
    process.exit(1);
  }

  const { files, generatedExcluded } = scanSources();

  if (args.includes('--bootstrap-baseline')) {
    runBootstrap({ files, exemptions: policy.exemptions, waivers: policy.waivers });
    return;
  }
  if (args.includes('--update-baseline')) {
    runUpdate({
      files,
      exemptions: policy.exemptions,
      waivers: policy.waivers,
      baseline: policy.baseline,
    });
    return;
  }
  runCheck({
    files,
    policy,
    generatedExcluded,
    showAll: args.includes('--show-all'),
    report: args.includes('--report'),
    args,
  });
};

if (import.meta.main) {
  main();
}
