/**
 * Lints all contract files in docs/contracts/ for structural issues,
 * placeholder residues, missing evidence, and status inconsistencies.
 *
 * Run: bun run src/lib/ops/lint_contracts.ts
 * Or add as moon task: lint-contracts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────────

type LintIssue = {
  file: string;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
};

// ── Helpers ────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs', 'contracts');

const readContractFiles = (): string[] =>
  readdirSync(CONTRACTS_DIR).filter(
    (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md') && f !== 'TEMPLATE.md',
  );

const readFile = (filename: string): string => {
  const filePath = join(CONTRACTS_DIR, filename);
  return readFileSync(filePath, 'utf8');
};

const extractId = (filename: string): string => {
  const match = filename.match(/^((?:C|MIG)-\d+)/);
  return match?.[1] ?? filename;
};

const extractStatus = (content: string): string => {
  // Check metadata table for **Status**
  const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
  if (statusMatch) {
    return (statusMatch[1] ?? '').trim();
  }
  return 'not_started';
};

const hasCompletedMarker = (content: string): boolean => /^<!--\s*completed:/.test(content);

const hasExecutionReport = (content: string): boolean => /## Execution Report/i.test(content);

const hasVerificationReport = (content: string): boolean =>
  /## Verification Verdict/i.test(content);

// ── Check functions ────────────────────────────────────────

const checkPlaceholders = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];
  // Check for template placeholders — must be inside fenced code blocks to be valid
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const placeholderMatch = line.match(/\{[A-Z_]+(:[^}]+)?\}/);
    if (placeholderMatch && !/\{FEATURE_CODE\}/.test(line)) {
      // Allow {FEATURE_CODE} and {TITLE} only in TEMPLATE.md
      issues.push({
        file: filename,
        severity: 'error',
        rule: 'no-placeholders',
        message: `Line ${i + 1}: Unfilled placeholder "${placeholderMatch[0]}"`,
      });
    }
  }

  return issues;
};

const checkDuplicateIds = (): LintIssue[] => {
  const allIds = new Map<string, string[]>();

  for (const f of readContractFiles()) {
    const id = extractId(f).toLowerCase();
    const existing = allIds.get(id) ?? [];
    existing.push(f);
    allIds.set(id, existing);
  }

  const issues: LintIssue[] = [];
  for (const [, files] of allIds) {
    if (files.length > 1) {
      issues.push({
        file: files[0] ?? 'unknown',
        severity: 'error',
        rule: 'no-duplicate-ids',
        message: `Duplicate contract IDs: ${files.join(', ')}`,
      });
    }
  }

  return issues;
};

const checkStatusConsistency = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];
  const status = extractStatus(content);
  const hasCompleted = hasCompletedMarker(content);

  // completed marker but status is not completed
  if (hasCompleted && status !== 'completed' && status !== 'verified') {
    issues.push({
      file: filename,
      severity: 'error',
      rule: 'status-marker-mismatch',
      message: `Has "<!-- completed: ... -->" marker but status is "${status}"`,
    });
  }

  // Status is completed but no completed marker
  if (status === 'completed' && !hasCompleted) {
    issues.push({
      file: filename,
      severity: 'warning',
      rule: 'status-marker-mismatch',
      message: 'Status is "completed" but no completion marker found',
    });
  }

  // Status is completed but no execution report
  if (status === 'completed' && !hasExecutionReport(content)) {
    issues.push({
      file: filename,
      severity: 'error',
      rule: 'missing-execution-report',
      message: 'Status is "completed" but no execution report found',
    });
  }

  // Status is verified but no verification report
  if (status === 'verified' && !hasVerificationReport(content)) {
    issues.push({
      file: filename,
      severity: 'error',
      rule: 'missing-verification-report',
      message: 'Status is "verified" but no verification verdict found',
    });
  }

  return issues;
};

const checkAcCoverage = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];

  // Extract AC IDs
  const acIds: string[] = [];
  const acRegex = /^### (AC-\d+):/gm;
  let match: RegExpExecArray | null;
  while (true) {
    match = acRegex.exec(content);
    if (match === null) {
      break;
    }
    acIds.push(match[1] ?? '');
  }

  if (acIds.length === 0) {
    return issues;
  }

  // Check execution report covers each AC
  if (hasExecutionReport(content)) {
    const reportSection = content.split('## Execution Report')[1];
    if (reportSection) {
      for (const acId of acIds) {
        if (!reportSection.includes(acId)) {
          issues.push({
            file: filename,
            severity: 'warning',
            rule: 'ac-not-in-report',
            message: `AC ${acId} not mentioned in execution report`,
          });
        }
      }
    }
  }

  return issues;
};

const checkTestFileExistence = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];

  // Find declared test files in Test Hooks
  const testFileRegex = /`(apps\/e2e\/tests\/[^`]+\.spec\.ts)`/g;
  let match: RegExpExecArray | null;

  while (true) {
    match = testFileRegex.exec(content);
    if (match === null) {
      break;
    }
    const filePath = join(REPO_ROOT, match[1] ?? '');
    if (!existsSync(filePath)) {
      issues.push({
        file: filename,
        severity: 'error',
        rule: 'test-file-missing',
        message: `Declared test file "${match[1]}" does not exist`,
      });
    }
  }

  // Check visual suite files
  const visualRegex = /`(suites\/[^`]+\.visual\.ts)`/g;
  while (true) {
    match = visualRegex.exec(content);
    if (match === null) {
      break;
    }
    const filePath = join(REPO_ROOT, 'apps', 'e2e', 'src', 'visual', match[1] ?? '');
    if (!existsSync(filePath)) {
      issues.push({
        file: filename,
        severity: 'error',
        rule: 'test-file-missing',
        message: `Declared visual suite "${match[1]}" does not exist`,
      });
    }
  }

  return issues;
};

const checkDeviations = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];

  const hasDeviations = /### Deviations from Spec/i.test(content);
  const hasAmendments = /## Amendments/i.test(content);

  if (hasDeviations && !hasAmendments) {
    const status = extractStatus(content);
    // Only warn if implemented/verified/completed — draft can have deviations without amendments
    if (['implemented', 'verified', 'completed'].includes(status)) {
      issues.push({
        file: filename,
        severity: 'warning',
        rule: 'deviations-without-amendments',
        message: 'Has deviations but no Amendments section — scope changes not formally recorded',
      });
    }
  }

  return issues;
};

const checkDependencies = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];

  const depMatch = content.match(/\|\s*\*\*Dependencies\*\*\s*\|\s*([^*|]+?)\s*\|/i);
  if (!depMatch) {
    return issues;
  }

  const deps = depMatch[1] ?? '';
  if (deps.trim() === '—' || deps.trim() === '-' || deps.trim() === '') {
    return issues;
  }

  const depIds = deps
    .split(/[,;]/)
    .map((d) => d.trim())
    .filter(Boolean);
  const existingFiles = readContractFiles().map(extractId);

  for (const depId of depIds) {
    if (!depId.startsWith('C-') && !depId.startsWith('MIG-')) {
      continue; // Skip package dependencies like "packages/shared"
    }
    if (!existingFiles.includes(depId)) {
      issues.push({
        file: filename,
        severity: 'warning',
        rule: 'missing-dependency',
        message: `Dependency "${depId}" has no contract file`,
      });
    }
  }

  return issues;
};

const checkOpenQuestions = (filename: string, content: string): LintIssue[] => {
  const issues: LintIssue[] = [];
  const status = extractStatus(content);

  if (status === 'approved') {
    const oqSection = content.match(/## Open Questions\n\n([\s\S]*?)(?=\n## |$)/);
    if (oqSection) {
      const hasUnresolved =
        oqSection[1]?.includes('- {question}') !== true &&
        oqSection[1]
          ?.trim()
          .replace(/^Must be resolved.*$/m, '')
          .trim() !== '';

      if (hasUnresolved && !/^-\s*$/.test(oqSection[1]?.trim() ?? '')) {
        issues.push({
          file: filename,
          severity: 'warning',
          rule: 'unresolved-questions',
          message: 'Status is "approved" but Open Questions may be unresolved',
        });
      }
    }
  }

  return issues;
};

// ── Main ───────────────────────────────────────────────────

const lintContracts = (): { passed: boolean; issues: LintIssue[] } => {
  console.log('🔍 Linting contracts...\n');

  const files = readContractFiles();
  if (files.length === 0) {
    console.log('⚠️ No contract files found.');
    return { passed: true, issues: [] };
  }

  const allIssues: LintIssue[] = [];

  // Global checks (run once, not per file)
  allIssues.push(...checkDuplicateIds());

  for (const filename of files) {
    const content = readFile(filename);

    const checks = [
      checkPlaceholders,
      checkStatusConsistency,
      checkAcCoverage,
      checkTestFileExistence,
      checkDeviations,
      checkDependencies,
      checkOpenQuestions,
    ];

    for (const check of checks) {
      allIssues.push(...check(filename, content));
    }
  }

  // Remove exact duplicates
  const seen = new Set<string>();
  const unique = allIssues.filter((i) => {
    const key = `${i.file}:${i.rule}:${i.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const errors = unique.filter((i) => i.severity === 'error');
  const warnings = unique.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`❌ ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(`  ${e.file}: ${e.message} [${e.rule}]`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️ ${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.log(`  ${w.file}: ${w.message} [${w.rule}]`);
    }
  }

  if (unique.length === 0) {
    console.log(`✅ All ${files.length} contracts pass lint checks.`);
  }

  console.log(`\n📊 ${files.length} files | ${errors.length} errors | ${warnings.length} warnings`);

  return { passed: errors.length === 0, issues: unique };
};

// ── CLI ────────────────────────────────────────────────────

if (import.meta.main) {
  const result = lintContracts();
  process.exit(result.passed ? 0 : 1);
}
