/**
 * Syncs the contract statuses by reading individual contract files
 * (docs/contracts/C-*.md, docs/contracts/MIG-*.md) and generating
 * a fresh PROGRESS.md dashboard table.
 *
 * Each contract file is the source of truth — it carries its own
 * execution report at the bottom and a `<!-- completed: YYYY-MM-DD -->`
 * marker at the top when finished.
 *
 * PROGRESS.md is strictly a dashboard table — no execution logs.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../../..');

function slugToName(filename: string): string {
  // C-001-remove-ai-vendor-dirs.md → "Remove AI Vendor Directories"
  // MIG-001-knowledge-splitting.md → "Knowledge Splitting"
  const stem = filename.replace(/\.md$/, '');
  // Drop the ID prefix: C-001- or MIG-001-
  const namePart = stem.replace(/^(C|MIG)-\d+-/, '');
  if (!namePart) {
    return stem;
  }
  return namePart
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractStatus(content: string): string {
  // 1. Check for completed marker (most reliable)
  if (/^<!--\s*completed:/.test(content)) {
    return 'completed';
  }

  // 2. Fall back to **Status** metadata field (handles both `completed` and `**completed**`)
  const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
  if (statusMatch) {
    return statusMatch[1].trim();
  }

  return 'not_started';
}

const STATUS_LABELS: Record<string, string> = {
  completed: '✅ completed',
  // biome-ignore lint/style/useNamingConvention: keys match contract status strings
  not_started: '⏳ not_started',
  // biome-ignore lint/style/useNamingConvention: keys match contract status strings
  in_progress: '🔄 in_progress',
  blocked: '❌ blocked',
};

export function syncContracts() {
  const contractsDir = join(REPO_ROOT, 'docs/contracts');
  const progressPath = join(REPO_ROOT, 'docs/contracts/PROGRESS.md');

  console.log('📄 Syncing PROGRESS.md from individual contract files...');

  try {
    // Read all contract files
    const files = readdirSync(contractsDir).filter(
      (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md'),
    );

    // Extract contract info
    type ContractInfo = {
      id: string;
      name: string;
      status: string;
    };

    const contracts: ContractInfo[] = [];

    for (const file of files) {
      const idMatch = file.match(/^((?:C|MIG)-\d+)/);
      if (!idMatch) {
        continue;
      }

      const id = idMatch[1];
      const content = readFileSync(join(contractsDir, file), 'utf8');
      const status = extractStatus(content);
      const name = slugToName(file);

      contracts.push({ id, name, status });
    }

    // Sort: C contracts first by numeric ID, then MIG contracts by numeric ID
    contracts.sort((a, b) => {
      const aIsMig = a.id.startsWith('MIG');
      const bIsMig = b.id.startsWith('MIG');
      if (aIsMig !== bIsMig) {
        return aIsMig ? 1 : -1;
      }
      const aNum = Number.parseInt(a.id.replace(/^(C|MIG)-/, ''), 10);
      const bNum = Number.parseInt(b.id.replace(/^(C|MIG)-/, ''), 10);
      return aNum - bNum;
    });

    // Generate PROGRESS.md
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [
      '# Contract Implementation Progress',
      '',
      `## Status Summary (Auto-generated: ${now})`,
      '',
      '| Contract | Name | Status |',
      '|----------|------|--------|',
    ];

    for (const c of contracts) {
      const label = STATUS_LABELS[c.status] ?? `❓ ${c.status}`;
      lines.push(`| ${c.id} | ${c.name} | ${label} |`);
    }

    lines.push('');

    const output = `${lines.join('\n')}\n`;
    writeFileSync(progressPath, output);

    console.log(
      `✅ Generated PROGRESS.md with ${contracts.length} contracts ` +
        `(${contracts.filter((c) => c.status === 'completed').length} completed)`,
    );
  } catch (error) {
    console.error('❌ Failed to sync contracts:', error);
    process.exit(1);
  }
}

// Allow running directly from CLI
if (import.meta.main) {
  syncContracts();
}
