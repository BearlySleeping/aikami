// .pi/scripts/resource_check.ts
//
// C-478 AC-2: Check-only mode — read-only, offline verification of installed
// resources against the resource manifest.
//
// Reports exact differences without downloads, file writes, or configuration
// changes. Exits with a meaningful nonzero code for required mismatches.
//
// Usage:
//   bun run resource-check              # check all resources
//   bun run resource-check --verbose     # include matching entries
//   bun run resource-check --json        # JSON output for tooling

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  hashDirectory,
  loadManifest,
  MANIFEST_PATH,
  PI_DIR,
  type ResourceManifest,
} from './resource_manifest.ts';

// ── Types ────────────────────────────────────────────────────────────

type CheckResult = {
  /** Number of resources that matched the manifest */
  matched: number;
  /** Number of resources that had a mismatch */
  mismatched: number;
  /** Number of resources that were missing entirely */
  missing: number;
  /** Number of resources that were in the manifest but not checkable */
  unchecked: number;
  /** Detailed entries */
  entries: CheckEntry[];
  /** Whether the check found any issues */
  hasIssues: boolean;
};

type CheckEntry = {
  name: string;
  status: 'match' | 'mismatch' | 'missing' | 'unchecked';
  expectedHash: string;
  actualHash: string;
  expectedFiles: number;
  actualFiles: number;
  detail: string;
};

// ── Constants ────────────────────────────────────────────────────────

// ── Check logic ──────────────────────────────────────────────────────

/**
 * Resolve the filesystem path for a manifest resource entry.
 * Returns undefined if the path cannot be determined statically.
 */
const resolveResourcePath = (
  entry: ResourceManifest['resources'][string],
  baseDir: string,
): string | undefined => {
  switch (entry.type) {
    case 'git-skill':
    case 'generated-skill':
      return join(baseDir, 'generated-skills', entry.name);
    case 'local-skill':
      if (entry.source.kind === 'local') {
        return join(baseDir, entry.source.relativePath);
      }
      return join(baseDir, entry.name);
    case 'npm-package':
      if (entry.source.kind === 'npm') {
        return join(baseDir, 'node_modules', entry.source.package);
      }
      return undefined;
  }
};

/**
 * Check a single resource against the manifest.
 * Read-only: does not create or modify any files.
 */
const checkResource = async (
  name: string,
  entry: ResourceManifest['resources'][string],
  baseDir: string,
): Promise<CheckEntry> => {
  const resourcePath = resolveResourcePath(entry, baseDir);

  if (!resourcePath || !existsSync(resourcePath)) {
    return {
      name,
      status: 'missing',
      expectedHash: entry.installed.contentHash,
      actualHash: '',
      expectedFiles: entry.installed.fileCount,
      actualFiles: 0,
      detail: resourcePath ? `Path not found: ${resourcePath}` : 'Cannot resolve resource path',
    };
  }

  // Check if it's a file or directory
  const stat = existsSync(resourcePath) ? require('node:fs').statSync(resourcePath) : null;

  if (!stat) {
    return {
      name,
      status: 'missing',
      expectedHash: entry.installed.contentHash,
      actualHash: '',
      expectedFiles: entry.installed.fileCount,
      actualFiles: 0,
      detail: 'Cannot stat path',
    };
  }

  if (stat.isDirectory()) {
    const identity = await hashDirectory(resourcePath);
    if (identity.contentHash === entry.installed.contentHash) {
      return {
        name,
        status: 'match',
        expectedHash: entry.installed.contentHash,
        actualHash: identity.contentHash,
        expectedFiles: entry.installed.fileCount,
        actualFiles: identity.fileCount,
        detail: `${entry.installed.fileCount} files, hash matches`,
      };
    }
    return {
      name,
      status: 'mismatch',
      expectedHash: entry.installed.contentHash,
      actualHash: identity.contentHash,
      expectedFiles: entry.installed.fileCount,
      actualFiles: identity.fileCount,
      detail: `Hash mismatch: expected ${entry.installed.contentHash.slice(0, 16)}…, got ${identity.contentHash.slice(0, 16)}…`,
    };
  }

  // Single file
  const content = await readFile(resourcePath);
  const { createHash } = await import('node:crypto');
  const actualHash = createHash('sha256').update(content).digest('hex');

  if (actualHash === entry.installed.contentHash) {
    return {
      name,
      status: 'match',
      expectedHash: entry.installed.contentHash,
      actualHash,
      expectedFiles: entry.installed.fileCount,
      actualFiles: 1,
      detail: 'Hash matches',
    };
  }
  return {
    name,
    status: 'mismatch',
    expectedHash: entry.installed.contentHash,
    actualHash,
    expectedFiles: entry.installed.fileCount,
    actualFiles: 1,
    detail: `Hash mismatch: expected ${entry.installed.contentHash.slice(0, 16)}…, got ${actualHash.slice(0, 16)}…`,
  };
};

/**
 * Run the full check against the resource manifest.
 * Returns a structured CheckResult with no side effects.
 */
export const runCheck = async (
  manifest: ResourceManifest,
  options?: { verbose?: boolean; baseDir?: string },
): Promise<CheckResult> => {
  const baseDir = options?.baseDir ?? PI_DIR;
  const entries: CheckEntry[] = [];
  let matched = 0;
  let mismatched = 0;
  let missing = 0;
  let unchecked = 0;

  for (const [name, entry] of Object.entries(manifest.resources)) {
    const result = await checkResource(name, entry, baseDir);
    entries.push(result);
    switch (result.status) {
      case 'match':
        matched++;
        break;
      case 'mismatch':
        mismatched++;
        break;
      case 'missing':
        missing++;
        break;
      case 'unchecked':
        unchecked++;
        break;
    }
  }

  return {
    matched,
    mismatched,
    missing,
    unchecked,
    entries,
    hasIssues: mismatched > 0 || missing > 0,
  };
};

// ── Output formatting ────────────────────────────────────────────────

const formatCheckResult = (result: CheckResult, verbose: boolean): string => {
  const lines: string[] = [];
  lines.push('=== Resource Check Report ===');
  lines.push(
    `Summary: ${result.matched} matched, ${result.mismatched} mismatched, ${result.missing} missing, ${result.unchecked} unchecked`,
  );
  lines.push(result.hasIssues ? 'Status: ❌ ISSUES FOUND' : 'Status: ✅ ALL MATCH');
  lines.push('');

  for (const entry of result.entries) {
    if (!verbose && entry.status === 'match') {
      continue;
    }

    let icon: string;
    if (entry.status === 'match') {
      icon = '✅';
    } else if (entry.status === 'mismatch') {
      icon = '❌';
    } else if (entry.status === 'missing') {
      icon = '⚠️';
    } else {
      icon = '❓';
    }
    lines.push(`${icon} ${entry.name}: ${entry.status}`);
    lines.push(`   ${entry.detail}`);
    if (entry.status === 'mismatch' || entry.status === 'missing') {
      lines.push(`   expected: ${entry.expectedHash.slice(0, 16)}… (${entry.expectedFiles} files)`);
      lines.push(`   actual:   ${entry.actualHash.slice(0, 16)}… (${entry.actualFiles} files)`);
    }
  }

  lines.push('');
  lines.push('=== End Report ===');
  return lines.join('\n');
};

// ── CLI entry ────────────────────────────────────────────────────────

export const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');

  // Check that manifest exists
  if (!existsSync(MANIFEST_PATH)) {
    console.error('❌ No resource manifest found at', MANIFEST_PATH);
    console.error('   Run `bun run resource-update` to create one.');
    process.exit(2);
  }

  const manifest = await loadManifest();
  if (!manifest) {
    console.error('❌ Failed to load resource manifest.');
    process.exit(2);
  }

  const result = await runCheck(manifest, { verbose });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result, verbose));
  }

  process.exit(result.hasIssues ? 1 : 0);
};

// Only auto-run when executed directly (not when imported as a module by tests)
const isDirectExecution = process.argv[1]?.endsWith('resource_check.ts');
if (isDirectExecution) {
  main().catch((err: Error) => {
    console.error('resource-check failed:', err.message);
    process.exit(2);
  });
}
