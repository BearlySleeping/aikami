/**
 * Syncs the contract statuses from docs/contracts/PROGRESS.md
 * to the individual docs/contracts/C-*.md metadata tables.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../../..');

export function syncContracts() {
  const progressPath = join(REPO_ROOT, 'docs/contracts/PROGRESS.md');
  const contractsDir = join(REPO_ROOT, 'docs/contracts');

  console.log('📄 Syncing contract statuses from PROGRESS.md...');

  try {
    const progressContent = readFileSync(progressPath, 'utf8');
    const statusMap = new Map<string, string>();

    // Parse the PROGRESS.md table
    // Looks for lines containing | C-001 | ... | ✅ completed |
    const lines = progressContent.split('\n');
    for (const line of lines) {
      if (!line.includes('|')) {
        continue;
      }

      // Extract the C-XXX identifier
      const cMatch = line.match(/(C-\d{3})/);
      if (!cMatch) {
        continue;
      }
      const id = cMatch[1];

      // Extract the last column (which is the status)
      const columns = line
        .split('|')
        .map((col) => col.trim())
        .filter(Boolean);
      if (columns.length < 3) {
        continue;
      }

      const rawStatus = columns[columns.length - 1];

      // Clean up the status (removes emojis, markdown bold, etc.)
      const cleanStatus = rawStatus.replace(/[✅⏳🔄❌**_]/gu, '').trim();

      if (cleanStatus) {
        statusMap.set(id, cleanStatus);
      }
    }

    // Read all contract files
    const files = readdirSync(contractsDir).filter((f) => f.startsWith('C-') && f.endsWith('.md'));
    let updatedCount = 0;

    for (const file of files) {
      const idMatch = file.match(/^(C-\d{3})/);
      if (!idMatch) {
        continue;
      }

      const id = idMatch[1];
      const newStatus = statusMap.get(id);

      if (newStatus) {
        const filePath = join(contractsDir, file);
        let content = readFileSync(filePath, 'utf8');

        // Regex to find and replace the Status row in the contract's metadata table
        // Matches: | **Status** | not_started |
        const statusRegex = /(\|\s*\*\*Status\*\*\s*\|\s*)([^|]+?)(\s*\|)/i;

        if (statusRegex.test(content)) {
          content = content.replace(statusRegex, `$1**${newStatus}**$3`);
          writeFileSync(filePath, content);
          updatedCount++;
        }
      }
    }

    console.log(`✅ Synced ${updatedCount} contracts to match PROGRESS.md`);
  } catch (error) {
    console.error('❌ Failed to sync contracts:', error);
    process.exit(1);
  }
}

// Allow running directly from CLI
if (import.meta.main) {
  syncContracts();
}
