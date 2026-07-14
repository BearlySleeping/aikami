// scripts/src/lib/ops/backfill_promotion.ts
/**
 * Backfills promotion states for C-119–C-249 contracts using heuristics.
 *
 * Heuristics:
 *   - Has execution report + visual tests + verified ACs → release_verified
 *   - Has execution report + E2E tests → integrated
 *   - Has execution report only → integrated (minimum)
 *   - Legacy (no execution report) → unassessed (no Promotion field)
 *   - Contracts with execution report but ambiguous → sandbox
 *
 * Writes the **Promotion** row into each contract's Metadata table.
 * If no Metadata table exists (pre-v1 format), skips (reports as unassessed).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '$logger';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs/contracts');

type BackfillResult = {
  id: string;
  fileName: string;
  promotion: string;
  inferredFrom: string;
};

const parseId = (fileName: string): string | null => {
  const match = fileName.match(/^(C-\d+)/);
  return match ? (match[1] ?? null) : null;
};

const hasExecutionReport = (content: string): boolean => /## Execution Report/i.test(content);

/** Extract execution report section from ## Execution Report to next ## heading */
const getReportSection = (content: string): string | undefined => {
  const startIndex = content.search(/## Execution Report\b/i);
  if (startIndex === -1) {
    return undefined;
  }
  const afterStart = content.slice(startIndex);
  const nextHeadingIndex = afterStart.slice(1).search(/\n## /);
  const endIndex = nextHeadingIndex === -1 ? afterStart.length : nextHeadingIndex + 1;
  return afterStart.slice(0, endIndex);
};

const hasVisualTests = (content: string): boolean => {
  const section = getReportSection(content);
  if (!section) {
    return false;
  }
  return /visual/i.test(section) || /\.visual\.ts/i.test(section);
};

const hasE2eTests = (content: string): boolean => {
  const section = getReportSection(content);
  if (!section) {
    return false;
  }
  return /e2e/i.test(section) || /\.spec\.ts/i.test(section) || /playwright/i.test(section);
};

const hasAcStatusPassing = (content: string): boolean => {
  const section = getReportSection(content);
  if (!section) {
    return false;
  }
  // Check for AC status table with ✅ markers
  return /\| AC-[\d\s]+\|[^|]*\|\s*✅\s*\|/i.test(section);
};

const hasMetadataTable = (content: string): boolean => /\|\s*\*\*Status\*\*\s*\|\s*/i.test(content);

const hasPromotionField = (content: string): boolean =>
  /\|\s*\*\*Promotion\*\*\s*\|\s*/i.test(content);

const determinePromotion = (content: string): string | null => {
  if (!hasExecutionReport(content)) {
    return null; // legacy — unassessed
  }

  const hasVisual = hasVisualTests(content);
  const hasE2e = hasE2eTests(content);
  const acPassing = hasAcStatusPassing(content);

  if (hasVisual && acPassing) {
    return 'release_verified';
  }
  if (hasE2e || acPassing) {
    return 'integrated';
  }
  return 'sandbox';
};

const insertPromotionField = (content: string, promotion: string): string => {
  // Insert Promotion row after Status row in the Metadata table
  const statusRowPattern = /(\|\s*\*\*Status\*\*\s*\|[^\n]*\|)/i;
  const match = content.match(statusRowPattern);
  if (!match) {
    return content;
  }
  const statusRow = match[0] ?? '';
  const insertedRow = `| **Promotion** | ${promotion} |`;

  // Replace the status row with status row + promotion row
  return content.replace(statusRow, `${statusRow}\n${insertedRow}`);
};

const backfillPromotion = () => {
  logger.info('backfillPromotion:start', { range: 'C-119–C-249' });

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
    });

  const results: BackfillResult[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const { file, id } of inRange) {
    const filePath = join(CONTRACTS_DIR, file);
    const content = readFileSync(filePath, 'utf8');

    // Skip if already has Promotion field
    if (hasPromotionField(content)) {
      skippedCount++;
      logger.debug('backfillPromotion:skip:already-has-promotion', { id, file });
      continue;
    }

    // Skip if no Metadata table (pre-v1 format)
    if (!hasMetadataTable(content)) {
      skippedCount++;
      results.push({
        id: id.toUpperCase(),
        fileName: file,
        promotion: '—',
        inferredFrom: 'no metadata table (legacy format)',
      });
      logger.debug('backfillPromotion:skip:no-metadata', { id, file });
      continue;
    }

    const promotion = determinePromotion(content);
    if (!promotion) {
      skippedCount++;
      results.push({
        id: id.toUpperCase(),
        fileName: file,
        promotion: '—',
        inferredFrom: 'no execution report (legacy)',
      });
      continue;
    }

    // Insert the Promotion field
    const updated = insertPromotionField(content, promotion);
    writeFileSync(filePath, updated);
    updatedCount++;

    results.push({
      id: id.toUpperCase(),
      fileName: file,
      promotion,
      inferredFrom:
        promotion === 'release_verified'
          ? 'visual tests + passing ACs'
          : promotion === 'integrated'
            ? 'E2E tests or passing ACs'
            : 'execution report (minimum)',
    });
  }

  // Summary
  console.log(`✅ Backfill complete: ${updatedCount} updated, ${skippedCount} skipped`);
  console.log('');

  const byPromotion = new Map<string, number>();
  for (const r of results) {
    byPromotion.set(r.promotion, (byPromotion.get(r.promotion) ?? 0) + 1);
  }

  for (const [promo, count] of byPromotion.entries()) {
    const label = promo === '—' ? 'unassessed' : promo;
    console.log(`  ${label}: ${count}`);
  }

  logger.info('backfillPromotion:complete', {
    updated: updatedCount,
    skipped: skippedCount,
  });
};

if (import.meta.main) {
  backfillPromotion();
}
