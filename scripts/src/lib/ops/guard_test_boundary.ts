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

// ── Comment stripping (keeps string contents) ───────────────────────────

const stripComments = (source: string): string => {
  let result = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') {
        result += ' ';
        index++;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      if (index < length) {
        result += '  ';
        index += 2;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      result += char;
      index++;
      while (index < length && source[index] !== quote) {
        if (source[index] === '\\') {
          result += source[index] + (source[index + 1] ?? '');
          index += 2;
          continue;
        }
        result += source[index];
        index++;
      }
      if (index < length) {
        result += source[index];
        index++;
      }
      continue;
    }
    result += char;
    index++;
  }
  return result;
};

// ── Classification ──────────────────────────────────────────────────────

/** A file the guard inspects: production source, never a test or fixture. */
const isProductionSource = (file: string): boolean => {
  if (!file.includes('/src/')) {
    return false;
  }
  if (!(file.endsWith('.ts') || file.endsWith('.svelte'))) {
    return false;
  }
  if (file.endsWith('.d.ts')) {
    return false;
  }
  if (/\.(test|spec)\.(svelte\.)?ts$/.test(file)) {
    return false;
  }
  if (file.includes('/__tests__/') || file.includes('/testing/')) {
    return false;
  }
  if (file.endsWith('test_preload.ts')) {
    return false;
  }
  return true;
};

/** Returns the violated rule name when a specifier points at a test helper. */
const testHelperRule = (specifier: string): string | undefined => {
  if (specifier.includes('test_preload')) {
    return 'test_preload';
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

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
] as const;

// ── Main ────────────────────────────────────────────────────────────────

const violations: Violation[] = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of walk(resolve(ROOT, scanRoot))) {
    if (!isProductionSource(file)) {
      continue;
    }
    const content = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const specifier = match[1] ?? '';
        const rule = testHelperRule(specifier);
        if (rule) {
          violations.push({ file: relPath(file), specifier, rule });
        }
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
