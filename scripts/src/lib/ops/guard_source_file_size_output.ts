// scripts/src/lib/ops/guard_source_file_size_output.ts
//
// Rendering for the source-file-size guard: warnings, the path-based failure
// diagnostics GitHub parses, the `--show-all` list, and the threshold
// distribution report. Kept separate from the walk/policy orchestration so each
// module keeps one cohesive responsibility — the policy this guard itself
// enforces.

import { annotate } from './gha_annotate.ts';
import { budgetFor, type ScannedFile } from './guard_source_file_size_helpers.ts';
import {
  type Assessment,
  bySizeDescending,
  type ExemptionSet,
  statusLabel,
  type WaiverSet,
} from './guards/source_size_policy.ts';

export type FileAssessment = { file: ScannedFile; assessment: Assessment };

const formatSize = (assessment: Assessment, lines: number): string => {
  const limit = assessment.allowance === undefined ? '' : `, limit ${assessment.allowance}`;
  return `${lines} lines${limit} — ${assessment.detail}`;
};

export const printWarnings = (warnings: FileAssessment[]): void => {
  for (const { file, assessment } of warnings) {
    console.log(`⚠️  ${file.path} — ${formatSize(assessment, file.lines)}`);
  }
};

export const printFailures = (failures: FileAssessment[]): void => {
  for (const { file, assessment } of failures) {
    const message = formatSize(assessment, file.lines);
    console.error(`❌ ${file.path} — ${message}`);
    // GitHub's diagnostic parser matches this `path:line [rule] message` shape.
    console.error(`        ${file.path}:1 [size] ${message}`);
    annotate({ file: file.path, line: 1, message, title: 'source-file-size guard' });
  }
};

/** Files above the warning threshold, largest first. */
const listedRows = (options: {
  files: readonly ScannedFile[];
  assess: (file: ScannedFile) => Assessment;
}): FileAssessment[] =>
  options.files
    .map((file) => ({ file, assessment: options.assess(file) }))
    .filter(({ file }) => file.lines > budgetFor(file.kind).warn)
    .sort((a, b) =>
      bySizeDescending(
        { lines: a.file.lines, path: a.file.path },
        { lines: b.file.lines, path: b.file.path },
      ),
    );

export const printReport = (options: {
  files: readonly ScannedFile[];
  assess: (file: ScannedFile) => Assessment;
  generatedExcluded: number;
}): void => {
  const rows = listedRows(options);
  console.log('\n📋 Source file size report (files above the warning threshold)');
  console.log('   lines  status      path');
  for (const { file, assessment } of rows) {
    console.log(
      `  ${String(file.lines).padStart(6)}  ${statusLabel(assessment.status).padEnd(10)}  ${file.path}`,
    );
  }
  console.log(
    `\n   ${rows.length} file(s) listed · ${options.files.length} scanned · ${options.generatedExcluded} generated file(s) excluded`,
  );
};

// ── Threshold distribution report ────────────────────────────────────────

/** Upper bound (inclusive) of each bucket, in ascending order. */
const BUCKET_EDGES = [500, 600, 700, 800, 900, 1200] as const;

const BUCKET_LABELS = ['<=500', '501-600', '601-700', '701-800', '801-900', '901-1200', '>1200'];

const bucketOf = (lines: number): string => {
  for (let index = 0; index < BUCKET_EDGES.length; index++) {
    if (lines <= (BUCKET_EDGES[index] ?? 0)) {
      return BUCKET_LABELS[index] ?? BUCKET_LABELS[BUCKET_LABELS.length - 1] ?? '>1200';
    }
  }
  return BUCKET_LABELS[BUCKET_LABELS.length - 1] ?? '>1200';
};

const distribution = (rows: readonly ScannedFile[]): Map<string, number> => {
  const counts = new Map<string, number>(BUCKET_LABELS.map((label) => [label, 0]));
  for (const row of rows) {
    const label = bucketOf(row.lines);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
};

const printDistribution = (label: string, rows: readonly ScannedFile[]): void => {
  const counts = distribution(rows);
  console.log(`\n${label}:`);
  for (const bucket of BUCKET_LABELS) {
    console.log(`  ${bucket.padStart(9)}  ${String(counts.get(bucket) ?? 0).padStart(5)}`);
  }
  console.log(`  ${'total'.padStart(9)}  ${String(rows.length).padStart(5)}`);
};

/**
 * The threshold-calibration report.
 *
 * Answers one question with data instead of taste: is the production hard limit
 * (800) still calibrated to this repository, or has the tree drifted far enough
 * that 900 is the honest number? It separates mutable implementation from
 * declarative/generated/test files, because those are the categories the policy
 * treats differently, and it shows how many waivers sit just above 800 versus
 * radically above it — a cluster of 801–900 ceilings means the boundary is
 * misplaced; a handful of 2500-line ceilings means the boundary is fine and
 * those files are the problem.
 */
export const printThresholdReport = (options: {
  files: readonly ScannedFile[];
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  baseline: Record<string, number>;
}): void => {
  const { files, exemptions, waivers, baseline } = options;
  const exemptPaths = new Set(Object.keys(exemptions));
  const waiverPaths = new Set(Object.keys(waivers));

  const mutable: ScannedFile[] = [];
  const exempted: ScannedFile[] = [];
  const waived: ScannedFile[] = [];
  const tests: ScannedFile[] = [];

  for (const file of files) {
    if (file.kind === 'test') {
      tests.push(file);
      continue;
    }
    if (exemptPaths.has(file.path)) {
      exempted.push(file);
      continue;
    }
    if (waiverPaths.has(file.path)) {
      waived.push(file);
      continue;
    }
    mutable.push(file);
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  SOURCE FILE SIZE — THRESHOLD DISTRIBUTION');
  console.log('════════════════════════════════════════════════════════════════');

  printDistribution('Mutable production implementation', mutable);
  printDistribution('Permanent exemptions (declarative / generated / fixture)', exempted);
  printDistribution('Temporary waivers (mutable, expiring)', waived);
  printDistribution('Tests', tests);

  console.log('\nTemporary waivers:');
  console.log('  lines  ceiling  reviewBy    issue       path');
  const waiverRows = [...waived].sort((a, b) =>
    bySizeDescending({ lines: a.lines, path: a.path }, { lines: b.lines, path: b.path }),
  );
  for (const file of waiverRows) {
    const waiver = waivers[file.path];
    if (!waiver) {
      continue;
    }
    console.log(
      `  ${String(file.lines).padStart(5)}  ${String(waiver.maxLines).padStart(7)}  ${waiver.reviewBy}  ${waiver.issue.padEnd(11)} ${file.path}`,
    );
  }
  if (waiverRows.length === 0) {
    console.log('  (none)');
  }

  const near = waiverRows.filter((file) => file.lines <= 900).length;
  const far = waiverRows.filter((file) => file.lines > 1200).length;
  console.log(
    `\nWaiver calibration: ${near} waiver(s) sit at or below 900 lines (the boundary would cover them),`,
  );
  console.log(`                   ${far} sit above 1200 (no boundary move would help).`);

  const above800 = mutable.filter((file) => file.lines > 800).length;
  const above900 = mutable.filter((file) => file.lines > 900).length;
  const above1200 = mutable.filter((file) => file.lines > 1200).length;
  console.log(
    `\nMutable implementation above the limits: >800 ${above800}, >900 ${above900}, >1200 ${above1200}`,
  );

  console.log('\nPermanent exemptions:');
  for (const file of [...exempted].sort((a, b) => b.lines - a.lines)) {
    console.log(
      `  ${String(file.lines).padStart(5)}  ${exemptions[file.path]?.kind ?? '?'}  ${file.path}`,
    );
  }
  if (exempted.length === 0) {
    console.log('  (none)');
  }

  const largest = [...files]
    .sort((a, b) =>
      bySizeDescending({ lines: a.lines, path: a.path }, { lines: b.lines, path: b.path }),
    )
    .slice(0, 25);
  console.log('\nLargest files overall:');
  for (const file of largest) {
    const representation = representationOf({
      file,
      exemptions,
      waivers,
      baseline,
      exemptPaths,
      waiverPaths,
    });
    console.log(`  ${String(file.lines).padStart(5)}  ${representation.padEnd(20)} ${file.path}`);
  }
};

/** How a path's allowance is expressed, for the largest-files listing. */
const representationOf = (options: {
  file: ScannedFile;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  baseline: Record<string, number>;
  exemptPaths: ReadonlySet<string>;
  waiverPaths: ReadonlySet<string>;
}): string => {
  const { file } = options;
  if (options.exemptPaths.has(file.path)) {
    return `exemption(${options.exemptions[file.path]?.maxLines})`;
  }
  if (options.waiverPaths.has(file.path)) {
    return `waiver(${options.waivers[file.path]?.maxLines})`;
  }
  if (options.baseline[file.path] !== undefined) {
    return `baseline(${options.baseline[file.path]})`;
  }
  return statusLabelFor(file);
};

const statusLabelFor = (file: ScannedFile): string => {
  const budget = budgetFor(file.kind);
  if (file.lines > budget.hard) {
    return statusLabel('over-limit');
  }
  return statusLabel(file.lines > budget.warn ? 'warning' : 'ok');
};
