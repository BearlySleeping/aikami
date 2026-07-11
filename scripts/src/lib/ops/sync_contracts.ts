/**
 * Syncs PROGRESS.md from individual contract files (docs/contracts/C-*.md).
 *
 * V2 changes:
 * - Trusts the **Status** metadata field (not completion comment).
 * - Marker/status mismatch is treated as a linter error elsewhere — not silently
 *   overridden here.
 * - Supports full lifecycle: draft, approved, in_progress, implemented,
 *   verification_failed, verified, completed, blocked, superseded.
 * - Shows legacy completion and verified completion distinctly.
 * - Rejects duplicate IDs.
 * - Version 1 contracts with completion markers but no execution reports
 *   display as "legacy_completed" to distinguish from verified contracts.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../../..');

const STATUS_LABELS: Record<string, string> = {
  // Active lifecycle
  draft: '📝 draft',
  approved: '👍 approved',
  // biome-ignore lint/style/useNamingConvention: keys match contract status strings
  in_progress: '🔄 in_progress',
  implemented: '🛠️ implemented',
  // biome-ignore lint/style/useNamingConvention: keys match contract status strings
  verification_failed: '❌ verification_failed',
  verified: '✅ verified',
  completed: '🏁 completed',
  blocked: '🚫 blocked',
  superseded: '👻 superseded',

  // Legacy (pre-V2)
  // biome-ignore lint/style/useNamingConvention: legacy status key
  legacy_completed: '📦 legacy_completed',
  // biome-ignore lint/style/useNamingConvention: keys match contract status strings
  not_started: '⏳ not_started',
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
 * Detect if contract is legacy (v1 with completion marker but no modern evidence).
 */
const isLegacyCompleted = (content: string): boolean => {
  const hasCompletedMarker = /^<!--\s*completed:/.test(content);
  const status = extractStatus(content);
  const hasExecutionReport = /## Execution Report/i.test(content);
  const hasVerificationReport = /## Verification Verdict/i.test(content);

  // Legacy: has completion marker but status is not following V2 lifecycle
  return (
    hasCompletedMarker &&
    !hasExecutionReport &&
    !hasVerificationReport &&
    status !== 'verified' &&
    status !== 'completed'
  );
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
};

export const syncContracts = () => {
  const contractsDir = join(REPO_ROOT, 'docs/contracts');
  const progressPath = join(REPO_ROOT, 'docs/contracts/PROGRESS.md');

  console.log('📄 Syncing PROGRESS.md from individual contract files...');

  try {
    const files = readdirSync(contractsDir).filter(
      (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md'),
    );

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

      const content = readFileSync(join(contractsDir, file), 'utf8');
      const version = detectVersion(content);
      const name = slugToName(file);

      let status: string;
      if (version === 1 && isLegacyCompleted(content)) {
        status = 'legacy_completed';
      } else {
        status = extractStatus(content);
      }

      contracts.push({ id, name, status, version });
    }

    // Sort: C first by numeric ID, then MIG by numeric ID
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

    // Generate PROGRESS.md
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [
      '# Contract Implementation Progress',
      '',
      `## Status Summary (Auto-generated: ${now})`,
      '',
      '| Contract | Name | Status | Version |',
      '|----------|------|--------|---------|',
    ];

    for (const c of contracts) {
      const label = STATUS_LABELS[c.status] ?? `❓ ${c.status}`;
      const verLabel = c.version === 2 ? 'v2' : 'v1';
      lines.push(`| ${c.id.toUpperCase()} | ${c.name} | ${label} | ${verLabel} |`);
    }

    if (duplicateIds.length > 0) {
      lines.push('');
      lines.push('## ⚠️ Duplicate IDs');
      for (const dup of duplicateIds) {
        lines.push(`- \`${dup.toUpperCase()}\` — resolve before next sync`);
      }
    }

    lines.push('');

    const output = `${lines.join('\n')}\n`;
    writeFileSync(progressPath, output);

    const verified = contracts.filter((c) => c.status === 'verified' || c.status === 'completed');
    const legacy = contracts.filter((c) => c.status === 'legacy_completed');

    console.log(
      `✅ Generated PROGRESS.md: ${contracts.length} contracts ` +
        `(${verified.length} verified, ${legacy.length} legacy, ${duplicateIds.length} duplicates)`,
    );

    if (duplicateIds.length > 0) {
      console.warn(`⚠️ Duplicate IDs: ${duplicateIds.join(', ')}`);
    }
  } catch (error) {
    console.error('❌ Failed to sync contracts:', error);
    process.exit(1);
  }
};

if (import.meta.main) {
  syncContracts();
}
