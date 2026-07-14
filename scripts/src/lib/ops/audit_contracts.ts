// scripts/src/lib/ops/audit_contracts.ts
/**
 * Audits contracts C-119 through C-249 for execution report completeness.
 *
 * Produces:
 *   - docs/contracts/AUDIT_C-119_C-249.md — gap analysis report
 *   - Audit annotations in legacy contract files (comment above first line)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '$logger';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs/contracts');
const AUDIT_OUTPUT = join(REPO_ROOT, 'docs/contracts/AUDIT_C-119_C-249.md');

const LEGACY_AUDIT_MARKER = '<!-- audit: legacy — no execution report -->';

type AuditEntry = {
  id: string;
  fileName: string;
  hasExecutionReport: boolean;
  hasAcStatusTable: boolean;
  hasEvidenceLinks: boolean;
  templateVersion: string;
  hasLegacyMarker: boolean;
  reportCompleteness: 'full' | 'partial' | 'missing';
  gaps: string[];
};

const parseId = (fileName: string): string | null => {
  const match = fileName.match(/^(C-\d+)/);
  return match ? (match[1] ?? null) : null;
};

const hasExecutionReport = (content: string): boolean => /## Execution Report/i.test(content);

const getReportSection = (content: string): string | undefined => {
  // Extract from ## Execution Report to next ## heading or end of file.
  const startIndex = content.search(/## Execution Report\b/i);
  if (startIndex === -1) {
    return undefined;
  }
  const afterStart = content.slice(startIndex);
  const nextHeadingIndex = afterStart.slice(1).search(/\n## /);
  const endIndex = nextHeadingIndex === -1 ? afterStart.length : nextHeadingIndex + 1;
  return afterStart.slice(0, endIndex);
};

const hasAcStatusTable = (content: string): boolean => {
  const reportSection = getReportSection(content);
  if (!reportSection) {
    return false;
  }
  return /\| AC \| Status \|/i.test(reportSection);
};

const hasEvidenceLinks = (content: string): boolean => {
  const reportSection = getReportSection(content);
  if (!reportSection) {
    return false;
  }

  // Look for files listed in tables or sections
  const hasFilesCreated = /### Files Created/i.test(reportSection);
  const hasFilesModified = /### Files Modified/i.test(reportSection);

  return hasFilesCreated || hasFilesModified;
};

const detectTemplateVersion = (content: string): string => {
  const versionMatch = content.match(
    /\|\s*\*\*Contract version\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i,
  );
  if (versionMatch) {
    return (versionMatch[1] ?? '').trim();
  }
  // Check for legacy contract format (no metadata table)
  if (/^<!--\s*completed:/.test(content) && !/\|\s*\*\*Status\*\*\s*\|/i.test(content)) {
    return 'pre-v1';
  }
  return 'unknown';
};

const hasLegacyCompletedMarker = (content: string): boolean => /^<!--\s*completed:/.test(content);

const assessCompleteness = (
  entry: Omit<AuditEntry, 'reportCompleteness' | 'gaps'>,
): {
  completeness: 'full' | 'partial' | 'missing';
  gaps: string[];
} => {
  const gaps: string[] = [];

  if (!entry.hasExecutionReport) {
    gaps.push('Missing execution report');
  }
  if (!entry.hasAcStatusTable) {
    gaps.push('Missing AC status table in execution report');
  }
  if (!entry.hasEvidenceLinks) {
    gaps.push('Missing evidence links (Files Created/Modified)');
  }

  if (gaps.length === 0) {
    return { completeness: 'full', gaps };
  }
  if (gaps.length <= 2 && entry.hasExecutionReport) {
    return { completeness: 'partial', gaps };
  }
  return { completeness: 'missing', gaps };
};

const annotateLegacyContract = (content: string): string => {
  // Only annotate if it doesn't already have the marker
  if (content.includes(LEGACY_AUDIT_MARKER)) {
    return content;
  }

  // Insert audit marker after the first line (legacy marker or heading)
  const lines = content.split('\n');
  const insertAt = 1; // after first line
  const modified = [
    ...lines.slice(0, insertAt),
    LEGACY_AUDIT_MARKER,
    ...lines.slice(insertAt),
  ].join('\n');
  return modified;
};

const auditContracts = () => {
  logger.info('auditContracts:start', { range: 'C-119–C-249' });

  const files = readdirSync(CONTRACTS_DIR).filter(
    (f) => /^C-\d+/.test(f) && f.endsWith('.md') && f !== 'TEMPLATE.md',
  );

  const inRange = files
    .map((f) => ({ file: f, id: parseId(f) }))
    .filter((entry): entry is { file: string; id: string } => {
      if (!entry.id) {
        return false;
      }
      const num = Number.parseInt(entry.id.replace('C-', ''), 10);
      return num >= 119 && num <= 249;
    })
    .sort((a, b) => {
      const aNum = Number.parseInt(a.id.replace('C-', ''), 10);
      const bNum = Number.parseInt(b.id.replace('C-', ''), 10);
      return aNum - bNum;
    });

  const entries: AuditEntry[] = [];
  let legacyCount = 0;
  let reportCount = 0;

  for (const { file, id } of inRange) {
    const filePath = join(CONTRACTS_DIR, file);
    const content = readFileSync(filePath, 'utf8');

    const reportPresent = hasExecutionReport(content);
    const acTable = hasAcStatusTable(content);
    const evidence = hasEvidenceLinks(content);
    const templateVersion = detectTemplateVersion(content);
    const legacyMarker = hasLegacyCompletedMarker(content);

    const base = {
      id: id.toUpperCase(),
      fileName: file,
      hasExecutionReport: reportPresent,
      hasAcStatusTable: acTable,
      hasEvidenceLinks: evidence,
      templateVersion,
      hasLegacyMarker: legacyMarker,
    };

    const { completeness, gaps } = assessCompleteness(base);

    const entry: AuditEntry = { ...base, reportCompleteness: completeness, gaps };
    entries.push(entry);

    if (reportPresent) {
      reportCount++;
    } else {
      legacyCount++;
      // Annotate legacy contract
      const annotated = annotateLegacyContract(content);
      if (annotated !== content) {
        writeFileSync(filePath, annotated);
        logger.debug('auditContracts:annotated', { file, id });
      }
    }
  }

  // Generate audit report
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    '# Contract Audit Report: C-119–C-249',
    '',
    `> One-time audit artifact — generated: ${now}`,
    '',
    '## Summary',
    '',
    `**Total**: ${entries.length} contracts`,
    `- **With execution reports**: ${reportCount}`,
    `- **Without execution reports (legacy)**: ${legacyCount}`,
    '',
    '### Completeness Breakdown',
    '',
    `| Completeness | Count |`,
    `|---|---|`,
    `| Full | ${entries.filter((e) => e.reportCompleteness === 'full').length} |`,
    `| Partial | ${entries.filter((e) => e.reportCompleteness === 'partial').length} |`,
    `| Missing | ${entries.filter((e) => e.reportCompleteness === 'missing').length} |`,
    '',
    '## Detailed Findings',
    '',
    '| Contract | Execution Report | AC Status Table | Evidence Links | Version | Completeness | Gaps |',
    '|----------|-----------------|-----------------|----------------|---------|-------------|------|',
  ];

  for (const entry of entries) {
    const reportCheck = entry.hasExecutionReport ? '✅' : '❌';
    const acCheck = entry.hasAcStatusTable ? '✅' : '❌';
    const evidenceCheck = entry.hasEvidenceLinks ? '✅' : '❌';
    const gapsStr = entry.gaps.length > 0 ? entry.gaps.join(', ') : '—';
    lines.push(
      `| ${entry.id} | ${reportCheck} | ${acCheck} | ${evidenceCheck} | ${entry.templateVersion} | ${entry.reportCompleteness} | ${gapsStr} |`,
    );
  }

  lines.push('');
  lines.push('### Legacy Contracts Annotated');
  lines.push('');
  lines.push(`${legacyCount} legacy contracts annotated with \`${LEGACY_AUDIT_MARKER}\` comment.`);
  lines.push('');

  const output = `${lines.join('\n')}\n`;
  writeFileSync(AUDIT_OUTPUT, output);

  logger.info('auditContracts:complete', {
    total: entries.length,
    withReports: reportCount,
    withoutReports: legacyCount,
    outputPath: 'docs/contracts/AUDIT_C-119_C-249.md',
  });

  console.log(
    `✅ Audit complete: ${entries.length} contracts (${reportCount} with reports, ${legacyCount} legacy)`,
  );
  console.log(`📄 Report: ${AUDIT_OUTPUT}`);
};

if (import.meta.main) {
  auditContracts();
}
