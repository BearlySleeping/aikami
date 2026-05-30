// scripts/src/lib/ops/cleanup_vendor_dirs.ts
/**
 * Clean up AI vendor directories and stale root files.
 * Implements contract C-001: Remove AI Vendor Directories.
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../../..');

const AI_VENDOR_DIRS = [
  '.agent',
  '.agents',
  '.ai',
  '.claude',
  '.cursor',
  '.gemini',
  '.qwen',
  '.zed',
  '.opencode',
  'openspec',
  '.github_old',
];

const STALE_ROOT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'opencode.json',
  'skills-lock.json',
  'firestack.skill',
  'session-ses_34bd.md',
  '.rules',
  'DEVELOPMENT.md',
  'CONTRIBUTING.md',
  'TODO.md',
];

function main() {
  console.log('Cleaning up AI vendor directories and stale files...\n');

  let removed = 0;

  // Remove vendor dirs
  for (const dir of AI_VENDOR_DIRS) {
    const fullPath = join(ROOT, dir);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
      console.log(`  Removed: ${dir}/`);
      removed++;
    }
  }

  // Remove stale files
  for (const file of STALE_ROOT_FILES) {
    const fullPath = join(ROOT, file);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { force: true });
      console.log(`  Removed: ${file}`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log('  Nothing to clean — root is already clean! ✓');
  } else {
    console.log(`\nCleaned up ${removed} items.`);
  }
}

main();
