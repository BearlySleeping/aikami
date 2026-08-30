/**
 * Syncs PROGRESS.md from individual contract files (docs/contracts/C-*.md).
 *
 * V2 changes:
 * - Trusts the **Status** metadata field (not completion comment).
 * - Marker/status mismatch is treated as a linter error elsewhere — not silently
 *   overridden here.
 * - Supports full lifecycle: draft, approved, in_progress, implemented,
 *   verification_failed, verified, completed, blocked, superseded.
 * - Shows completed and verified completion distinctly.
 * - Rejects duplicate IDs.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBacklog } from './parse_backlog.js';

const REPO_ROOT = join(import.meta.dir, '../../../..');

const STATUS_LABELS: Record<string, string> = {
  // Active lifecycle
  draft: '📝 draft',
  approved: '👍 approved',
  in_progress: '🔄 in_progress',
  implemented: '🛠️ implemented',
  verification_failed: '❌ verification_failed',
  verified: '✅ verified',
  completed: '🏁 completed',
  blocked: '🚫 blocked',
  superseded: '👻 superseded',

  not_started: '⏳ not_started',
  not_started_no_file: '⏳ not_started (no contract file)',

  // Archived (in docs/contracts/archived/)
  archived: '📦 archived',
};

const PROMOTION_LABELS: Record<string, string> = {
  sandbox: '🧪 sandbox',
  integrated: '🔗 integrated',
  release_verified: '🚀 release_verified',
};

const slugToName = (filename: string): string => {
  const stem = filename.replace(/\.md$/, '');
  const namePart = stem.replace(/^(C|MIG)-\d+-/, '');
  if (!namePart) {
    return stem;
  }
  return namePart
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Extract status from the metadata table **Status** field.
 * This is the canonical source of truth.
 */
const extractStatus = (content: string): string => {
  const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
  if (statusMatch) {
    return (statusMatch[1] ?? '').trim();
  }
  return 'not_started';
};

/**
 * Extract promotion state from the metadata table **Promotion** field.
 * Returns undefined if the field is missing or set to "—".
 */
const extractPromotion = (content: string): string | undefined => {
  const promotionMatch = content.match(
    /\|\s*\*\*Promotion\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i,
  );
  if (!promotionMatch) {
    return undefined;
  }
  const raw = (promotionMatch[1] ?? '').trim();
  if (raw === '—' || raw === '' || raw === '—') {
    return undefined;
  }
  return raw;
};

/**
 * Detect contract format version.
 * Returns 2 if contract declares version 2.0.0+, 1 otherwise.
 */
const detectVersion = (content: string): number => {
  const versionMatch = content.match(
    /\|\s*\*\*Contract version\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i,
  );
  if (versionMatch) {
    const ver = (versionMatch[1] ?? '').trim();
    const major = Number.parseInt(ver.split('.')[0] ?? '1', 10);
    return major >= 2 ? 2 : 1;
  }
  return 1;
};

type ContractInfo = {
  id: string;
  name: string;
  status: string;
  version: number;
  promotion: string | undefined;
  fileName: string;
  archived: boolean;
};

const readContractsFromDir = (
  dir: string,
  archived: boolean,
): { contracts: ContractInfo[]; duplicateIds: string[] } => {
  let files: string[];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        /^(C|MIG)-\d+/.test(f) &&
        f.endsWith('.md') &&
        f !== 'TEMPLATE.md' &&
        f !== 'THIN_TEMPLATE.md',
    );
  } catch {
    return { contracts: [], duplicateIds: [] };
  }

  const contracts: ContractInfo[] = [];
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];

  for (const file of files) {
    const idMatch = file.match(/^((?:C|MIG)-\d+)/);
    if (!idMatch) {
      continue;
    }

    const id = idMatch[1].toLowerCase();

    if (seenIds.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    seenIds.add(id);

    const content = readFileSync(join(dir, file), 'utf8');
    const version = detectVersion(content);
    const name = slugToName(file);

    const status: string = archived ? 'archived' : extractStatus(content);

    const promotion = archived ? undefined : extractPromotion(content);

    contracts.push({ id, name, status, version, promotion, fileName: file, archived });
  }

  return { contracts, duplicateIds };
};

const sortContracts = (contracts: ContractInfo[]): void => {
  contracts.sort((a, b) => {
    const aIsMig = a.id.startsWith('mig');
    const bIsMig = b.id.startsWith('mig');
    if (aIsMig !== bIsMig) {
      return aIsMig ? 1 : -1;
    }
    const aNum = Number.parseInt(a.id.replace(/^(c|mig)-/, ''), 10);
    const bNum = Number.parseInt(b.id.replace(/^(c|mig)-/, ''), 10);
    return aNum - bNum;
  });
};

export const syncContracts = () => {
  const contractsDir = join(REPO_ROOT, 'docs/contracts');
  const archivedDir = join(REPO_ROOT, 'docs/contracts/archived');
  const progressPath = join(REPO_ROOT, 'docs/contracts/PROGRESS.md');

  console.log('📄 Syncing PROGRESS.md from individual contract files...');

  try {
    // Read active contracts
    const activeResult = readContractsFromDir(contractsDir, false);

    // Read archived contracts
    const archivedResult = readContractsFromDir(archivedDir, true);

    const activeContracts = activeResult.contracts;
    const archivedContracts = archivedResult.contracts;

    // Cross-reference with TODO.md backlog
    const activeIdSet = new Set(activeContracts.map((c) => c.id));
    const backlogDoc = parseBacklog(REPO_ROOT);
    let missingFromContracts = 0;

    for (const item of backlogDoc.items) {
      const id = item.id.toLowerCase();
      if (!activeIdSet.has(id)) {
        activeContracts.push({
          id,
          name: item.title,
          status: 'not_started_no_file',
          version: 0,
          promotion: undefined,
          fileName: '(no contract file)',
          archived: false,
          contractType: 'full',
        });
        missingFromContracts++;
      }
    }

    const allDuplicateIds = [...activeResult.duplicateIds, ...archivedResult.duplicateIds];

    // Check for cross-directory duplicate IDs (activeIdSet already includes TODO.md-only items)
    for (const ac of archivedContracts) {
      if (activeIdSet.has(ac.id)) {
        allDuplicateIds.push(`${ac.id} (active + archived)`);
      }
    }

    sortContracts(activeContracts);
    sortContracts(archivedContracts);

    // Generate PROGRESS.md
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [
      '# Contract Implementation Progress',
      '',
      `## Status Summary (Auto-generated: ${now})`,
      '',
      `**${activeContracts.length} active (${missingFromContracts} without contract file), ${archivedContracts.length} archived, ${allDuplicateIds.length} duplicates**`,
      '',
      '### Active Contracts',
      '',
      '| Contract | Name | Status | Promotion | Version | Type |',
      '|----------|------|--------|-----------|---------|------|',
    ];

    for (const c of activeContracts) {
      const statusLabel = STATUS_LABELS[c.status] ?? `❓ ${c.status}`;
      const promotionLabel = c.promotion
        ? (PROMOTION_LABELS[c.promotion] ?? `❓ ${c.promotion}`)
        : '—';
      let verLabel: string;
      if (c.version === 0) {
        verLabel = '—';
      } else if (c.version === 2) {
        verLabel = 'v2';
      } else {
        verLabel = 'v1';
      }
      const typeLabel = c.contractType === 'thin' ? 'thin' : 'full';
      lines.push(
        `| ${c.id.toUpperCase()} | ${c.name} | ${statusLabel} | ${promotionLabel} | ${verLabel} | ${typeLabel} |`,
      );
    }

    if (archivedContracts.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('### 📦 Archived Contracts');
      lines.push('');
      lines.push(
        `> These ${archivedContracts.length} legacy v1 contracts were marked completed with no execution report and are not referenced by pending work.`,
      );
      lines.push('> See `docs/contracts/archived/README.md` for details.');
      lines.push('');
      lines.push('| Contract | Name | Status | Version | Type |');
      lines.push('|----------|------|--------|---------|------|');

      // Show first 20 archived, then count remaining
      const shownArchived = archivedContracts.slice(0, 20);
      for (const c of shownArchived) {
        const label = STATUS_LABELS[c.status] ?? `❓ ${c.status}`;
        const verLabel = c.version === 2 ? 'v2' : 'v1';
        const typeLabel = c.contractType === 'thin' ? 'thin' : 'full';
        lines.push(`| ${c.id.toUpperCase()} | ${c.name} | ${label} | ${verLabel} | ${typeLabel} |`);
      }

      if (archivedContracts.length > 20) {
        const remaining = archivedContracts.length - 20;
        const remainingIds = archivedContracts
          .slice(20)
          .map((c) => c.id.toUpperCase())
          .join(', ');
        lines.push(`| ... | _${remaining} more archived_ | | | |`);
        lines.push('');
        lines.push(`<details><summary>All ${archivedContracts.length} archived IDs</summary>`);
        lines.push('');
        lines.push(remainingIds);
        lines.push('');
        lines.push('</details>');
      }
    }

    if (allDuplicateIds.length > 0) {
      lines.push('');
      lines.push('## ⚠️ Duplicate IDs');
      for (const dup of allDuplicateIds) {
        lines.push(`- \`${dup.toUpperCase()}\` — resolve before next sync`);
      }
    }

    lines.push('');

    const output = `${lines.join('\n')}\n`;
    writeFileSync(progressPath, output);

    // Generate PROMOTION.md — feature-promotion matrix (active contracts only)
    const promotionPath = join(REPO_ROOT, 'docs/contracts/PROMOTION.md');
    const sandboxContracts = activeContracts.filter((c) => c.promotion === 'sandbox');
    const integratedContracts = activeContracts.filter((c) => c.promotion === 'integrated');
    const releaseVerifiedContracts = activeContracts.filter(
      (c) => c.promotion === 'release_verified',
    );
    const unassessedContracts = activeContracts.filter((c) => !c.promotion);

    const promotionLines: string[] = [
      '# Feature Promotion Matrix',
      '',
      `> Auto-generated: ${now}`,
      '',
      'Tracks which features have progressed from dev sandboxes through production integration to release readiness.',
      '',
      `**Summary**: ${sandboxContracts.length} sandbox, ${integratedContracts.length} integrated, ${releaseVerifiedContracts.length} release_verified, ${unassessedContracts.length} unassessed (active only; ${archivedContracts.length} archived contracts excluded)`,
      '',
    ];

    const writeSection = (title: string, sectionContracts: ContractInfo[]): void => {
      promotionLines.push(`## ${title}`);
      promotionLines.push('');
      if (sectionContracts.length === 0) {
        promotionLines.push('_None_');
      } else {
        promotionLines.push('| Contract | Name | Status | Version | Type |');
        promotionLines.push('|----------|------|--------|---------|------|');
        for (const c of sectionContracts) {
          const statusLabel = STATUS_LABELS[c.status] ?? `❓ ${c.status}`;
          const verLabel = c.version === 2 ? 'v2' : 'v1';
          const typeLabel = c.contractType === 'thin' ? 'thin' : 'full';
          promotionLines.push(
            `| ${c.id.toUpperCase()} | ${c.name} | ${statusLabel} | ${verLabel} | ${typeLabel} |`,
          );
        }
      }
      promotionLines.push('');
    };

    writeSection('🚀 Release Verified', releaseVerifiedContracts);
    writeSection('🔗 Integrated', integratedContracts);
    writeSection('🧪 Sandbox', sandboxContracts);
    writeSection('❓ Unassessed', unassessedContracts);

    const promotionOutput = `${promotionLines.join('\n')}\n`;
    writeFileSync(promotionPath, promotionOutput);

    console.log(
      `✅ Generated PROGRESS.md: ${activeContracts.length} active, ${archivedContracts.length} archived, ${allDuplicateIds.length} duplicates`,
    );
    console.log(
      `✅ Generated PROMOTION.md: ${sandboxContracts.length} sandbox, ${integratedContracts.length} integrated, ${releaseVerifiedContracts.length} release_verified`,
    );

    if (allDuplicateIds.length > 0) {
      console.warn(`⚠️ Duplicate IDs: ${allDuplicateIds.join(', ')}`);
    }
  } catch (error) {
    console.error('❌ Failed to sync contracts:', error);
    process.exit(1);
  }
};

if (import.meta.main) {
  // Skip in contract pipeline worktrees — PROGRESS.md and PROMOTION.md
  // are shared files that cause merge conflicts when modified in parallel
  // branches. They are regenerated on main after PR merge.
  if (process.env.CONTRACT_PIPELINE_WORKTREE) {
    process.exit(0);
  }
  syncContracts();
}
