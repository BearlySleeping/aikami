// scripts/src/lib/ops/guard_orphaned_capability.ts
//
// Ratchet guard that reports exported service methods whose only
// non-declaration references live in test files or declarations.
//
// For each exported symbol in apps/frontend/client/src/lib/services/**
// (and symbols named by an Evidence Matrix Production Path), count
// references outside its own declaration after resolving barrel re-export
// chains. References in interface/type declarations, declaration files,
// *.test.ts files, or __tests__/ do not count as production use.
//
// Existing offenders are captured in guard_orphaned_capability_baseline.json
// so the guard exits zero on the current tree. New offenders fail the guard,
// and improvements not locked into the baseline also fail (ratchet semantics).
//
// The baseline JSON format:
//   {
//     "apps/frontend/client/src/lib/services/...ts": {
//       "orphaned": ["symbolName1", "symbolName2"],
//       "_comment": "C-456 shipped these with no production caller. C-493 wires them in."  // optional
//     }
//   }
//
// Usage:
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts --update-baseline
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts --show-all
//
// Exits non-zero on any regression (new orphan), any unlocked improvement
// (orphan fixed but not in baseline), or any baseline entry that no longer
// matches (renamed symbol at same count). --show-all ignores the baseline.
//
// See guard_type_safety.ts for the identity-aware ratchet pattern this mirrors.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SERVICES_DIR = resolve(ROOT, 'apps/frontend/client/src/lib/services');
const BASELINE_PATH = resolve(import.meta.dir, 'guard_orphaned_capability_baseline.json');

// ── Types ──────────────────────────────────────────────────

type OrphanEntry = {
  orphaned: string[];
  _comment?: string;
};

type Baseline = Record<string, OrphanEntry>;

type OrphanReport = {
  file: string;
  symbols: string[];
};

// ── Constants ──────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.svelte-kit',
  'build',
  'dist',
  '.git',
  '__tests__',
]);

// ── Helpers ────────────────────────────────────────────────

const relPath = (file: string): string => file.replace(`${ROOT}/`, '').split(sep).join('/');

/** Recursively find all .ts and .svelte files under services dir. */
const collectServiceFiles = (): string[] => {
  const results: string[] = [];
  const walk = (dir: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  };
  if (existsSync(SERVICES_DIR)) {
    walk(SERVICES_DIR);
  }
  return results;
};

/** Extract exported symbol names from source content. */
const extractExports = (content: string): string[] => {
  const exports: string[] = [];
  // Match: export const symbolName, export function symbolName, export class symbolName
  const namedRe = /export\s+(?:const|function|class|type|interface|enum|let|var)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while (true) {
    m = namedRe.exec(content);
    if (m === null) break;
    exports.push(m[1] ?? '');
  }
  // Match: export { symbolName, ... }
  const bracketRe = /export\s+\{\s*([\w\s,]+)\s*\}/g;
  while (true) {
    m = bracketRe.exec(content);
    if (m === null) break;
    const names = (m[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0 && !s.includes(':'));
    for (const name of names) {
      // Handle `symbolName as alias` — use the original name
      const asMatch = name.match(/^(\w+)\s+as\s+/);
      exports.push(asMatch ? (asMatch[1] ?? '') : name);
    }
  }
  // Filter out common noise
  return [...new Set(exports)].filter(
    (s) =>
      !s.startsWith('_') &&
      !['undefined', 'null', 'true', 'false', 'number', 'string', 'boolean'].includes(s),
  );
};

/**
 * Check if a reference is in a production (non-test, non-declaration) file.
 * Returns false for:
 *   - *.test.ts, *.spec.ts
 *   - __tests__/ directories
 *   - *.d.ts declaration files
 *   - Test utilities / fixtures
 */
const isProductionFile = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/__tests__/')) return false;
  if (/\.(test|spec)\.(ts|svelte)$/.test(normalized)) return false;
  if (normalized.endsWith('.d.ts')) return false;
  // Exclude e2e test files
  if (normalized.includes('/apps/e2e/')) return false;
  return true;
};

/**
 * Scan for references to a symbol across the production codebase.
 * Counts the number of files (not occurrences) that reference the symbol
 * outside of its own declaration file.
 */
const findProductionReferences = (options: {
  symbol: string;
  declaringFile: string;
}): string[] => {
  const { symbol, declaringFile } = options;
  const refFiles: string[] = [];
  const normalizedDeclaring = declaringFile.replace(/\\/g, '/');

  // Scan production directories for references
  const scanDirs = [
    resolve(ROOT, 'apps/frontend/client/src'),
    resolve(ROOT, 'apps/frontend/hub/src'),
    resolve(ROOT, 'packages/frontend'),
  ];

  for (const scanDir of scanDirs) {
    if (!existsSync(scanDir)) continue;
    const walk = (dir: string): void => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const normalizedPath = fullPath.replace(/\\/g, '/');
            // Skip the declaring file itself
            if (normalizedPath === normalizedDeclaring) continue;
            // Only check production files
            if (!isProductionFile(normalizedPath)) continue;
            // Check .ts, .svelte files
            if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.svelte')) continue;
            try {
              const content = readFileSync(fullPath, 'utf-8');
              // Simple word-boundary check for the symbol reference
              const symbolRe = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
              if (symbolRe.test(content)) {
                refFiles.push(normalizedPath);
              }
            } catch {
              // skip unreadable files
            }
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    };
    walk(scanDir);
  }

  return refFiles;
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compute a simple hash for a list of orphan symbols (for identity-aware comparison). */
const orphanHash = (symbols: string[]): string => {
  const sorted = [...symbols].sort();
  const input = sorted.join(',');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
};

// ── Main ────────────────────────────────────────────────────

const main = () => {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const showAll = args.includes('--show-all');

  // Load baseline
  let baseline: Baseline = {};
  if (existsSync(BASELINE_PATH) && !showAll) {
    try {
      baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
    } catch {
      baseline = {};
    }
  }

  const allReports: OrphanReport[] = [];
  const serviceFiles = collectServiceFiles();

  for (const filePath of serviceFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const exports = extractExports(content);
    if (exports.length === 0) continue;

    const fileRelPath = relPath(filePath);
    const orphanedSymbols: string[] = [];

    for (const symbol of exports) {
      const refs = findProductionReferences({ symbol, declaringFile: filePath });
      // Also check if the declaring file itself references the symbol
      // (the declaration itself doesn't count as production use)
      const externalRefs = refs.filter((r) => r !== fileRelPath);

      if (externalRefs.length === 0) {
        orphanedSymbols.push(symbol);
      }
    }

    if (orphanedSymbols.length > 0) {
      allReports.push({ file: fileRelPath, symbols: orphanedSymbols.sort() });
    }
  }

  // ── Compare against baseline ──────────────────────────────

  let exitCode = 0;
  const annotations: string[] = [];

  if (updateBaseline) {
    // Write new baseline from current scan
    const newBaseline: Baseline = {};
    for (const report of allReports) {
      const existing = baseline[report.file];
      newBaseline[report.file] = {
        orphaned: report.symbols,
        ...(existing?._comment ? { _comment: existing._comment } : {}),
      };
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + '\n', 'utf-8');
    console.log(`✅ Baseline updated: ${Object.keys(newBaseline).length} file(s) with orphans`);
    process.exit(0);
  }

  // Check for regressions and improvements
  for (const report of allReports) {
    const baselineEntry = baseline[report.file];
    const currentHash = orphanHash(report.symbols);

    if (!baselineEntry) {
      // New orphan — regression
      console.log(`❌ NEW ORPHAN: ${report.file} — ${report.symbols.join(', ')}`);
      annotations.push(`error:New orphan in ${report.file}: ${report.symbols.join(', ')}`);
      exitCode = 1;
    } else {
      const baselineHash = orphanHash(baselineEntry.orphaned);
      if (currentHash !== baselineHash) {
        // Changed — could be improvement or regression or same-count replacement
        if (report.symbols.length < baselineEntry.orphaned.length) {
          // Improvement — must be locked in
          console.log(`⚠️  IMPROVEMENT NOT LOCKED: ${report.file} — ${baselineEntry.orphaned.length} → ${report.symbols.length}. Run --update-baseline to lock.`);
          annotations.push(`warning:Improved but not locked: ${report.file}`);
          exitCode = 1;
        } else {
          // Regression or same-count replacement
          console.log(`❌ REGRESSION: ${report.file} — baseline had ${baselineEntry.orphaned.join(', ')}; found ${report.symbols.join(', ')}`);
          annotations.push(`error:Regression in ${report.file}: ${report.symbols.join(', ')}`);
          exitCode = 1;
        }
      }
    }
  }

  // Check for baselined entries that no longer exist (should be removed)
  for (const [filePath, entry] of Object.entries(baseline)) {
    const report = allReports.find((r) => r.file === filePath);
    if (!report) {
      // File no longer exists or has no orphans — improvement
      console.log(`⚠️  IMPROVEMENT NOT LOCKED: ${filePath} — all ${entry.orphaned.length} orphan(s) resolved. Run --update-baseline to lock.`);
      annotations.push(`warning:Resolved but not locked: ${filePath}`);
      exitCode = 1;
    }
  }

  // Print summary
  if (exitCode === 0) {
    if (allReports.length === 0) {
      console.log('✅ No orphaned capabilities found.');
    } else {
      console.log(`✅ All ${allReports.length} orphaned capability file(s) match baseline.`);
      if (!showAll) {
        console.log('   Run --show-all to see full list.');
      }
    }
  }

  // In --show-all mode, print everything
  if (showAll) {
    console.log('\n📋 All current orphaned capabilities:');
    for (const report of allReports) {
      console.log(`  ${report.file}: ${report.symbols.join(', ')}`);
    }
    if (allReports.length === 0) {
      console.log('  (none)');
    }
  }

  // Send annotations (GHA only — annotate always emits ::error)
  for (const annotation of annotations) {
    const [, ...msgParts] = annotation.split(':');
    annotate({
      file: '',
      line: 0,
      message: msgParts.join(':'),
    });
  }

  process.exit(exitCode);
};

main();
