/**
 * Contract linter V2 — validates contract files for structural issues.
 *
 * Modes:
 *   --contract C-XXX    Strict lint for one contract (CI gate)
 *   --changed [base]    Lint contracts changed from a Git base (default: HEAD~1)
 *   --all               Full audit, including legacy warnings (non-blocking)
 *   (no flag)           Per-contract mode if CONTRACT_LINT_ID env set; else --all audit
 *
 * Rules are STATUS-AWARE:
 *   draft:       TBD/open questions allowed. Structural errors + dup IDs fail.
 *   approved:    No TBD/placeholders. Deps must exist. Evidence Matrix structurally complete.
 *   in_progress: Same spec reqs as approved.
 *   implemented: Execution Report + test artifacts required. AC coverage in report.
 *   verified:    All implemented reqs + Verification Report with PASS + fingerprint.
 *   completed:   All verified reqs + completion marker.
 *
 * Legacy (v1) contracts are grandfathered for missing modern reports.
 * Duplicate IDs are a global error for ALL versions.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────────

type Severity = 'error' | 'warning';

type LintIssue = {
  file: string;
  severity: Severity;
  rule: string;
  message: string;
};

type ContractInfo = {
  filename: string;
  id: string;
  content: string;
  status: string;
  version: number;
  archived: boolean;
};

// ── Constants ──────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs', 'contracts');
const ARCHIVED_CONTRACTS_DIR = join(REPO_ROOT, 'docs', 'contracts', 'archived');

const VALID_STATUSES = new Set([
  'draft',
  'approved',
  'in_progress',
  'implemented',
  'verification_failed',
  'verified',
  'completed',
  'blocked',
  'superseded',
  'not_started', // legacy
]);

const IMPLEMENTED_OR_LATER = new Set(['implemented', 'verified', 'completed']);
const VERIFIED_OR_LATER = new Set(['verified', 'completed']);
const APPROVED_OR_LATER = new Set([
  'approved',
  'in_progress',
  'implemented',
  'verified',
  'completed',
]);

// ── Helpers ────────────────────────────────────────────────

const readContractFiles = (): string[] =>
  readdirSync(CONTRACTS_DIR).filter(
    (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md') && f !== 'TEMPLATE.md',
  );

const readArchivedContractFiles = (): string[] => {
  try {
    return readdirSync(ARCHIVED_CONTRACTS_DIR).filter(
      (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md'),
    );
  } catch {
    return [];
  }
};

/** Check archived/ for a contract ID. Returns filename if found. */
const findInArchived = (id: string): string | null => {
  const upperId = id.toUpperCase();
  const archivedFiles = readArchivedContractFiles();
  for (const f of archivedFiles) {
    if (extractId(f).toUpperCase() === upperId) {
      return f;
    }
  }
  return null;
};

const extractId = (filename: string): string => {
  const match = filename.match(/^((?:C|MIG)-\d+)/);
  return match?.[1]?.toUpperCase() ?? filename;
};

const extractStatus = (content: string): string => {
  const m = content.match(/\|\s*\*\*Status\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
  return (m?.[1] ?? 'not_started').trim();
};

const detectVersion = (content: string): number => {
  const m = content.match(/\|\s*\*\*Contract version\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
  if (m) {
    return Number.parseInt((m[1] ?? '1').split('.')[0] ?? '1', 10);
  }
  return 1;
};

const hasExecutionReport = (content: string): boolean => /## Execution Report/i.test(content);

const hasVerificationReport = (content: string): boolean =>
  /## Verification Verdict/i.test(content);

const hasCompletedMarker = (content: string): boolean => /^<!--\s*completed:/.test(content);

/** Check if a line is inside a fenced code block (```) */
const isInsideCodeBlock = (lines: string[], lineIndex: number): boolean => {
  let inside = false;
  for (let i = 0; i < lineIndex; i++) {
    if (/^```/.test(lines[i] ?? '')) {
      inside = !inside;
    }
  }
  return inside;
};

/** Parse decorated dependency ID: "C-236 (Agent Pipeline...)" → "C-236" */
const extractDepIds = (depsRaw: string): string[] => {
  const ids: string[] = [];
  const idRe = /(?:^|[,\s;])\s*(C-\d+|MIG-\d+)/gi;
  let m: RegExpExecArray | null;
  while (true) {
    m = idRe.exec(depsRaw);
    if (m === null) {
      break;
    }
    ids.push((m[1] ?? '').toUpperCase());
  }
  return ids;
};

// ── Check Functions ────────────────────────────────────────

const checkPlaceholders = (info: ContractInfo): LintIssue[] => {
  const issues: LintIssue[] = [];
  const lines = info.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isInsideCodeBlock(lines, i)) {
      continue;
    }

    // Match any {UPPER}, {lower}, {CamelCase}, {with:options} placeholder
    const matches = line.match(/\{[A-Za-z][\w:]*(?::[^}]+)?\}/g);
    if (!matches) {
      continue;
    }

    // Filter out known template placeholders that are expected in TEMPLATE.md
    const knownTemplate = /\{FEATURE_CODE\}|\{TITLE\}/;
    for (const m of matches) {
      if (!knownTemplate.test(m)) {
        issues.push({
          file: info.filename,
          severity: info.version === 2 && APPROVED_OR_LATER.has(info.status) ? 'error' : 'warning',
          rule: 'placeholder',
          message: `Line ${i + 1}: Unfilled placeholder "${m}"`,
        });
      }
    }
  }

  return issues;
};

const checkTbd = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !APPROVED_OR_LATER.has(info.status)) {
    return [];
  }

  const issues: LintIssue[] = [];
  const lines = info.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isInsideCodeBlock(lines, i)) {
      continue;
    }
    // Match standalone TBD in table cells or bullet values
    // TBD in any context: table cells (`| TBD |`), bullet lists (`- **Field:** TBD`),
    // or standalone text. Skip inside fenced code blocks.
    if (/\bTBD\b/.test(line)) {
      issues.push({
        file: info.filename,
        severity: 'error',
        rule: 'tbd-in-approved',
        message: `Line ${i + 1}: TBD value in approved-or-later contract`,
      });
    }
  }

  return issues;
};

const checkDuplicateIds = (
  contracts: ContractInfo[],
  targetFilenames?: Set<string>,
): LintIssue[] => {
  const allIds = new Map<string, string[]>();
  for (const c of contracts) {
    const key = c.id.toLowerCase();
    const existing = allIds.get(key) ?? [];
    existing.push(c.filename);
    allIds.set(key, existing);
  }

  const issues: LintIssue[] = [];
  for (const [, files] of allIds) {
    if (files.length > 1) {
      // In scoped mode (--contract/--changed), only report duplicates
      // that involve at least one file from the target set.
      if (targetFilenames && !files.some((f) => targetFilenames.has(f))) {
        continue;
      }
      issues.push({
        file: files[0] ?? 'unknown',
        severity: 'error',
        rule: 'duplicate-id',
        message: `Duplicate contract IDs: ${files.join(', ')}`,
      });
    }
  }
  return issues;
};

const checkStatus = (info: ContractInfo): LintIssue[] => {
  const issues: LintIssue[] = [];

  if (!VALID_STATUSES.has(info.status)) {
    issues.push({
      file: info.filename,
      severity: 'error',
      rule: 'invalid-status',
      message: `Unknown status "${info.status}" — must be one of: ${[...VALID_STATUSES].join(', ')}`,
    });
  }

  // Marker/status consitency
  const marker = hasCompletedMarker(info.content);
  if (marker && info.status !== 'completed' && info.status !== 'legacy_completed') {
    issues.push({
      file: info.filename,
      severity: 'warning',
      rule: 'marker-status-mismatch',
      message: `Has completion marker but status is "${info.status}" (should be "completed")`,
    });
  }

  return issues;
};

const checkExecutionReport = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !IMPLEMENTED_OR_LATER.has(info.status)) {
    return [];
  }

  const issues: LintIssue[] = [];

  if (!hasExecutionReport(info.content)) {
    issues.push({
      file: info.filename,
      severity: 'error',
      rule: 'missing-execution-report',
      message: `Status "${info.status}" requires an Execution Report`,
    });
    return issues;
  }

  // Check AC coverage in execution report
  const acIds: string[] = [];
  const acRe = /^### (AC-\d+):/gm;
  let m: RegExpExecArray | null;
  while (true) {
    m = acRe.exec(info.content);
    if (m === null) {
      break;
    }
    acIds.push(m[1] ?? '');
  }

  const reportSection = info.content.split('## Execution Report')[1];
  if (reportSection) {
    for (const acId of acIds) {
      if (!reportSection.includes(acId)) {
        issues.push({
          file: info.filename,
          severity: 'warning',
          rule: 'ac-not-in-report',
          message: `AC ${acId} not mentioned in execution report`,
        });
      }
    }
  }

  return issues;
};

const checkVerificationReport = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !VERIFIED_OR_LATER.has(info.status)) {
    return [];
  }

  const issues: LintIssue[] = [];

  if (!hasVerificationReport(info.content)) {
    issues.push({
      file: info.filename,
      severity: 'error',
      rule: 'missing-verification-report',
      message: `Status "${info.status}" requires a Verification Report`,
    });
  }

  return issues;
};

const checkTestFiles = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !IMPLEMENTED_OR_LATER.has(info.status)) {
    return [];
  }

  const issues: LintIssue[] = [];

  // Check E2E test files
  const testFileRe = /`(apps\/e2e\/tests\/[^`]+\.spec\.ts)`/g;
  let m: RegExpExecArray | null;
  while (true) {
    m = testFileRe.exec(info.content);
    if (m === null) {
      break;
    }
    const path = join(REPO_ROOT, m[1] ?? '');
    if (!existsSync(path)) {
      issues.push({
        file: info.filename,
        severity: 'error',
        rule: 'test-file-missing',
        message: `Declared test file "${m[1]}" does not exist`,
      });
    }
  }

  // Check visual suite files
  const visualRe = /`(suites\/[^`]+\.visual\.ts)`/g;
  while (true) {
    m = visualRe.exec(info.content);
    if (m === null) {
      break;
    }
    const path = join(REPO_ROOT, 'apps', 'e2e', 'src', 'visual', m[1] ?? '');
    if (!existsSync(path)) {
      issues.push({
        file: info.filename,
        severity: 'error',
        rule: 'test-file-missing',
        message: `Declared visual suite "${m[1]}" does not exist`,
      });
    }
  }

  return issues;
};

const checkDependencies = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !APPROVED_OR_LATER.has(info.status)) {
    return [];
  }

  const depMatch = info.content.match(/\|\s*\*\*Dependencies\*\*\s*\|\s*([^*|]+?)\s*\|/i);
  if (!depMatch) {
    return [];
  }

  const depsRaw = depMatch[1] ?? '';
  const depIds = extractDepIds(depsRaw);
  if (depIds.length === 0) {
    return [];
  }

  const existingFiles = readContractFiles()
    .map(extractId)
    .map((id) => id.toUpperCase());

  const issues: LintIssue[] = [];
  for (const depId of depIds) {
    if (!existingFiles.includes(depId)) {
      issues.push({
        file: info.filename,
        severity: 'warning',
        rule: 'missing-dependency',
        message: `Dependency "${depId}" has no contract file`,
      });
    }
  }

  return issues;
};

const checkOpenQuestions = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !APPROVED_OR_LATER.has(info.status)) {
    return [];
  }

  const oqMatch = info.content.match(/## Open Questions\n\n([\s\S]*?)(?=\n## |$)/);
  if (!oqMatch) {
    return []; // No Open Questions section — OK
  }

  const body = (oqMatch[1] ?? '').trim();

  // Remove the header line "Must be resolved before..."
  const cleaned = body.replace(/^Must be resolved.*$/m, '').trim();

  // Check for unresolved questions
  const items = cleaned
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.replace(/^-\s+/, '').trim());

  const unresolved = items.filter((item) => {
    const lower = item.toLowerCase();
    return (
      lower !== 'none' &&
      lower !== 'n/a' &&
      !lower.startsWith('resolved:') &&
      !lower.startsWith('✅') &&
      item.length > 0 &&
      !lower.includes('{question}')
    );
  });

  if (unresolved.length > 0) {
    return [
      {
        file: info.filename,
        severity: 'warning',
        rule: 'open-questions',
        message: `${unresolved.length} open question(s) may be unresolved`,
      },
    ];
  }

  return [];
};

const checkEvidenceMatrix = (info: ContractInfo): LintIssue[] => {
  if (info.version !== 2 || !APPROVED_OR_LATER.has(info.status)) {
    return [];
  }

  // Check that Evidence Matrix section exists
  const hasMatrix =
    /\*\*Evidence Matrix\*\*/i.test(info.content) ||
    /\| AC \| Test Level \| Required Artifact/i.test(info.content);

  if (!hasMatrix) {
    return [
      {
        file: info.filename,
        severity: 'warning',
        rule: 'missing-evidence-matrix',
        message: 'Approved-or-later contract should have an Evidence Matrix',
      },
    ];
  }

  return [];
};

// ── Mode: per-contract ─────────────────────────────────────

const lintContract = (info: ContractInfo): LintIssue[] => {
  const issues: LintIssue[] = [];

  // Always-run checks
  issues.push(...checkStatus(info));

  // Status-aware checks
  if (info.version === 2) {
    issues.push(...checkPlaceholders(info));
    issues.push(...checkTbd(info));
  }

  if (info.version === 2 && APPROVED_OR_LATER.has(info.status)) {
    issues.push(...checkDependencies(info));
    issues.push(...checkEvidenceMatrix(info));
    issues.push(...checkOpenQuestions(info));
  }

  if (info.version === 2 && IMPLEMENTED_OR_LATER.has(info.status)) {
    issues.push(...checkExecutionReport(info));
    issues.push(...checkTestFiles(info));
  }

  if (info.version === 2 && VERIFIED_OR_LATER.has(info.status)) {
    issues.push(...checkVerificationReport(info));
  }

  // Legacy v1: only check status validity
  if (info.version === 1) {
    // Status check already done above
    // Skip modern report requirements for legacy
  }

  return issues;
};

// ── Mode: changed contracts ─────────────────────────────────

const getChangedFiles = (base: string): string[] => {
  try {
    const output = execSync(`git diff --name-only ${base} -- ${CONTRACTS_DIR}/`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .map((f) => f.split('/').pop() ?? '')
      .filter((f) => /^(C|MIG)-\d+/.test(f));
  } catch {
    return [];
  }
};

// ── Dedup ──────────────────────────────────────────────────

const deduplicate = (issues: LintIssue[]): LintIssue[] => {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.file}:${i.rule}:${i.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

// ── Main ───────────────────────────────────────────────────

type LintOptions = {
  mode: 'contract' | 'changed' | 'all';
  contractId?: string;
  base?: string;
};

const parseArgs = (): LintOptions => {
  const args = process.argv.slice(2);

  // Check env var first
  const envId = process.env.CONTRACT_LINT_ID;

  if (args.includes('--contract')) {
    const idx = args.indexOf('--contract');
    const id = args[idx + 1] ?? envId ?? '';
    return { mode: 'contract', contractId: id };
  }

  if (args.includes('--changed')) {
    const idx = args.indexOf('--changed');
    const base = args[idx + 1] ?? 'HEAD~1';
    return { mode: 'changed', base };
  }

  if (args.includes('--all')) {
    return { mode: 'all' };
  }

  // Default: use env var for per-contract, else full audit
  if (envId) {
    return { mode: 'contract', contractId: envId };
  }
  return { mode: 'all' };
};

const main = () => {
  const opts = parseArgs();
  const allFiles = readContractFiles();

  // Parse all active contracts
  const allContracts: ContractInfo[] = [];
  for (const filename of allFiles) {
    const content = readFileSync(join(CONTRACTS_DIR, filename), 'utf-8');
    allContracts.push({
      filename,
      id: extractId(filename),
      content,
      status: extractStatus(content),
      version: detectVersion(content),
      archived: false,
    });
  }

  // Parse archived contracts (for --all duplicate-ID checks and --contract lookups)
  const archivedFiles = opts.mode === 'all' || opts.mode === 'contract' ? readArchivedContractFiles() : [];
  const archivedContracts: ContractInfo[] = [];
  for (const filename of archivedFiles) {
    const content = readFileSync(join(ARCHIVED_CONTRACTS_DIR, filename), 'utf-8');
    archivedContracts.push({
      filename,
      id: extractId(filename),
      content,
      status: extractStatus(content),
      version: detectVersion(content),
      archived: true,
    });
  }

  let targetContracts: ContractInfo[];
  let modeLabel: string;

  switch (opts.mode) {
    case 'contract': {
      const id = opts.contractId?.toUpperCase() ?? '';
      targetContracts = allContracts.filter((c) => c.id.toUpperCase() === id);
      modeLabel = `contract ${id || '(unspecified)'}`;
      if (targetContracts.length === 0) {
        // Check archived
        const archivedFile = findInArchived(id);
        if (archivedFile) {
          console.log(`📦 Contract ${id} is archived: docs/contracts/archived/${archivedFile}`);
          console.log('   See docs/contracts/archived/README.md for details.');
          process.exit(0);
        }
        console.error(`❌ Contract not found: ${id}`);
        process.exit(1);
      }
      break;
    }
    case 'changed': {
      const base = opts.base ?? 'HEAD~1';
      const changedFilenames = getChangedFiles(base);
      targetContracts = allContracts.filter((c) => changedFilenames.includes(c.filename));
      modeLabel = `changed (base: ${base})`;
      break;
    }
    default:
      targetContracts = allContracts;
      modeLabel = 'full audit';
      break;
  }

  console.log(`🔍 Linting contracts — ${modeLabel} (${targetContracts.length} files)\n`);

  const issues = (() => {
    // Global duplicate IDs: in --all mode include both active + archived.
    // In --contract/--changed mode, only report duplicates involving target files.
    const targetFilenames =
      opts.mode === 'all' ? undefined : new Set(targetContracts.map((c) => c.filename));

    // Combine active + archived for global duplicate check in --all mode
    const allForDups =
      opts.mode === 'all' ? [...allContracts, ...archivedContracts] : allContracts;
    const result: LintIssue[] = [...checkDuplicateIds(allForDups, targetFilenames)];

    // Per-contract checks run in ALL modes (archived contracts get no checks beyond duplicates)
    for (const c of targetContracts) {
      result.push(...lintContract(c));
    }
    return deduplicate(result);
  })();

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`❌ ${errors.length} error(s):`);
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.file}: ${e.message} [${e.rule}]`);
    }
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more errors`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️ ${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 10)) {
      console.log(`  ${w.file}: ${w.message} [${w.rule}]`);
    }
    if (warnings.length > 10) {
      console.log(`  ... and ${warnings.length - 10} more warnings`);
    }
  }

  if (issues.length === 0) {
    console.log('✅ All contracts pass lint checks.');
  }

  console.log(
    `\n📊 ${targetContracts.length} files | ${errors.length} errors | ${warnings.length} warnings`,
  );

  // In --all mode, errors are non-blocking for legacy contracts
  // In --contract and --changed mode, errors block
  if (opts.mode === 'all') {
    process.exit(0);
  }
  process.exit(errors.length > 0 ? 1 : 0);
};

main();
