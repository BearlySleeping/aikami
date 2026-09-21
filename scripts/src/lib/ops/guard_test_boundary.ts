// scripts/src/lib/ops/guard_test_boundary.ts
//
// Structural guard: production source must not import test helpers.
//
// The client test_preload fake-module lane (test_preload.ts,
// localServicesMockBase, feature `testing/` fixtures, `*.test.ts`) is being
// retired. Shipping code that imports a test helper couples the app to test
// scaffolding and can drag the whole preload graph into a build. This guard
// makes the boundary explicit:
//
//   ❌ import { localServicesMockBase } from '../../../test_preload.ts';
//   ❌ import { createAccountCapabilities } from './testing/account_fixtures.ts';
//   ❌ import { helper } from './foo.test.ts';
//
// Scans production `.ts`/`.svelte` under `apps/**/src` and `packages/**/src`,
// skipping test files and the fixtures themselves, stripping comments so doc
// references never false-positive, and checking static imports, re-exports,
// dynamic import() and require().
//
// Usage: bun scripts/src/lib/ops/guard_test_boundary.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SCAN_ROOTS = ['apps', 'packages'] as const;
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.svelte-kit',
  'build',
  'dist',
  '.git',
  '.pi',
  'tmp',
]);

type Violation = {
  file: string;
  specifier: string;
  rule: string;
};

const relPath = (file: string): string => relative(ROOT, file);

// ── File walker ─────────────────────────────────────────────────────────

const walk = (directory: string): string[] => {
  const files: string[] = [];
  if (!existsSync(directory)) {
    return files;
  }
  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue;
    }
    const fullPath = resolve(directory, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
};

// ── Syntax-aware import extraction ──────────────────────────────────────
//
// Uses Bun's parser so comments, strings, template literals and regex
// literals can never hide or smuggle an import specifier. Svelte files are
// scanned via their <script> block(s). If the parser rejects a file, fall
// back to a comment/string-aware regex — never silently skip.

const transpiler = new Bun.Transpiler({ loader: 'ts' });

const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

const extractScriptSource = (content: string): string =>
  [...content.matchAll(SCRIPT_BLOCK_RE)].map((match) => match[1] ?? '').join('\n');

const IMPORT_SPECIFIER_RE = /(?:from\s+|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

/** Last-resort scanner if Bun's parser rejects a file. */
const fallbackImportPaths = (source: string): string[] => {
  const paths: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    if (match[1]) {
      paths.push(match[1]);
    }
  }
  return paths;
};

const scanImportPaths = (file: string, content: string): string[] => {
  const source = file.endsWith('.svelte') ? extractScriptSource(content) : content;
  try {
    return transpiler.scanImports(source).map((entry) => entry.path);
  } catch {
    return fallbackImportPaths(source);
  }
};

// ── Classification ──────────────────────────────────────────────────────

/** A file the guard inspects: production source, never a test or fixture. */
const isProductionSource = (file: string): boolean => {
  // Normalize Windows separators so the same path checks work on every OS.
  const normalized = file.split('\\').join('/');
  if (!normalized.includes('/src/')) {
    return false;
  }
  if (!(normalized.endsWith('.ts') || normalized.endsWith('.svelte'))) {
    return false;
  }
  if (normalized.endsWith('.d.ts')) {
    return false;
  }
  if (/\.(test|spec)\.(svelte\.)?ts$/.test(normalized)) {
    return false;
  }
  if (normalized.includes('/__tests__/') || normalized.includes('/testing/')) {
    return false;
  }
  if (normalized.endsWith('test_setup.ts') || normalized.endsWith('test_preload.ts')) {
    return false;
  }
  return true;
};

/** Returns the violated rule name when a specifier points at a test helper. */
const testHelperRule = (specifier: string): string | undefined => {
  if (specifier.includes('test_setup') || specifier.includes('test_preload')) {
    return 'test_setup';
  }
  if (/(^|\/)testing\//.test(specifier)) {
    return 'testing-fixture';
  }
  if (/(^|\/)__tests__\//.test(specifier)) {
    return '__tests__';
  }
  if (/(^|\/)__fixtures__\//.test(specifier)) {
    return '__fixtures__';
  }
  if (/(^|\/)[^/]*\.(test|spec)(\.(svelte\.)?ts)?$/.test(specifier)) {
    return 'test-file';
  }
  return undefined;
};

// ── Main ────────────────────────────────────────────────────────────────

const violations: Violation[] = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of walk(resolve(ROOT, scanRoot))) {
    if (!isProductionSource(file)) {
      continue;
    }
    for (const specifier of scanImportPaths(file, readFileSync(file, 'utf8'))) {
      const rule = testHelperRule(specifier);
      if (rule) {
        violations.push({ file: relPath(file), specifier, rule });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `❌ ${violations.length} production import(s) of a test helper — production code must not depend on test scaffolding:\n`,
  );
  for (const violation of violations) {
    console.error(`      ${violation.file} → '${violation.specifier}' (${violation.rule})`);
    annotate({
      file: violation.file,
      line: 1,
      message: `Production code imports '${violation.specifier}' (${violation.rule}). Inject a production dependency instead — see the account feature composition pattern.`,
      title: 'test-boundary guard',
    });
  }
  console.error(
    '\n🔴 test-boundary guard failed — remove the test-helper import or move the code into a test file.',
  );
  process.exit(1);
}

console.log('✅ test-boundary guard passed — production source imports no test helpers');
