// scripts/src/lib/ops/guard_source_file_size_output.ts
//
// Rendering for the source-file-size guard: human-readable warnings, the
// path-based failure diagnostics GitHub parses, and the --show-all report.
// Kept separate from the walk/ratchet orchestration so each module keeps one
// cohesive responsibility — the policy this guard itself enforces.

import { annotate } from './gha_annotate.ts';
import {
  type Assessment,
  assessFile,
  type Baseline,
  budgetFor,
  bySizeDescending,
  type ExceptionSet,
  type ScannedFile,
  statusLabel,
} from './guard_source_file_size_helpers.ts';

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

export const printReport = (options: {
  files: ScannedFile[];
  exceptions: ExceptionSet;
  baseline: Baseline;
  generatedExcluded: number;
}): void => {
  const { files, exceptions, baseline, generatedExcluded } = options;
  const rows = files
    .map((file) => ({
      file,
      assessment: assessFile({
        kind: file.kind,
        lines: file.lines,
        baselineLines: baseline[file.path],
        exception: exceptions[file.path],
      }),
    }))
    .filter(({ file }) => file.lines > budgetFor(file.kind).warn)
    .sort((a, b) =>
      bySizeDescending(
        { lines: a.file.lines, path: a.file.path },
        { lines: b.file.lines, path: b.file.path },
      ),
    );

  console.log('\n📋 Source file size report (files above the warning threshold)');
  console.log('   lines  status      path');
  for (const { file, assessment } of rows) {
    console.log(
      `  ${String(file.lines).padStart(6)}  ${statusLabel(assessment.status).padEnd(10)}  ${file.path}`,
    );
  }
  console.log(
    `\n   ${rows.length} file(s) listed · ${files.length} scanned · ${generatedExcluded} generated file(s) excluded`,
  );
};
