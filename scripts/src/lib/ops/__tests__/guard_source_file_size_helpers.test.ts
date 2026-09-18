// scripts/src/lib/ops/__tests__/guard_source_file_size_helpers.test.ts
//
// Pure-logic tests for the source-file-size guard's measurement layer: line
// counting, file classification, directory exclusions, and the structure
// analysis that decides whether a `declarative` exemption claim is true.

import { describe, expect, test } from 'bun:test';
import {
  analyseFileStructure,
  budgetFor,
  countPhysicalLines,
  isExcludedDir,
  isGeneratedFile,
  isSourceFile,
  isTestFile,
} from '../guard_source_file_size_helpers.ts';

describe('countPhysicalLines', () => {
  test('counts an empty file as zero lines', () => {
    expect(countPhysicalLines('')).toBe(0);
  });

  test('does not add a phantom line for a trailing newline', () => {
    expect(countPhysicalLines('a')).toBe(1);
    expect(countPhysicalLines('a\n')).toBe(1);
    expect(countPhysicalLines('a\nb\n')).toBe(2);
  });

  test('normalizes CRLF and lone CR', () => {
    expect(countPhysicalLines('a\r\nb\r\n')).toBe(2);
    expect(countPhysicalLines('a\rb')).toBe(2);
  });

  test('counts a lone newline as one blank line', () => {
    expect(countPhysicalLines('\n')).toBe(1);
  });
});

describe('budgets', () => {
  test('uses the documented production and test budgets', () => {
    expect(budgetFor('production')).toEqual({ warn: 500, hard: 800 });
    expect(budgetFor('test')).toEqual({ warn: 800, hard: 1500 });
  });
});

describe('classification', () => {
  test('recognizes source formats', () => {
    for (const name of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.svelte']) {
      expect(isSourceFile(name)).toBe(true);
    }
    expect(isSourceFile('a.json')).toBe(false);
    expect(isSourceFile('a.md')).toBe(false);
  });

  test('recognizes generated conventions', () => {
    expect(isGeneratedFile('apps/x/src/env.d.ts')).toBe(true);
    expect(isGeneratedFile('.pi/generated-skills/foo/bar.ts')).toBe(true);
    expect(isGeneratedFile('packages/x/src/generated/catalog.ts')).toBe(true);
    expect(isGeneratedFile('packages/x/src/paraglide/messages.js')).toBe(true);
    expect(isGeneratedFile('apps/x/src/lpc_asset_catalog_generated.ts')).toBe(true);
    expect(isGeneratedFile('apps/x/src/catalog.generated.ts')).toBe(true);
    expect(isGeneratedFile('apps/frontend/client/static/content.js')).toBe(true);
    expect(isGeneratedFile('apps/x/src/foo.ts')).toBe(false);
  });

  test('recognizes tests', () => {
    expect(isTestFile('apps/x/src/foo.test.ts')).toBe(true);
    expect(isTestFile('apps/x/src/foo.spec.ts')).toBe(true);
    expect(isTestFile('packages/x/src/__tests__/foo.ts')).toBe(true);
    expect(isTestFile('packages/x/tests/foo.ts')).toBe(true);
    expect(isTestFile('apps/e2e/specs/foo.ts')).toBe(true);
    expect(isTestFile('apps/frontend/client/src/lib/test_preload.ts')).toBe(true);
    expect(isTestFile('apps/x/src/foo.ts')).toBe(false);
  });

  test('excludes dependencies and only known generated-output roots', () => {
    expect(isExcludedDir({ name: 'node_modules', relPath: 'apps/x/node_modules' })).toBe(true);
    for (const name of ['build', 'dist', 'target', 'temp', 'tmp', 'vendor']) {
      expect(isExcludedDir({ name, relPath: `apps/frontend/x/${name}` })).toBe(true);
      expect(isExcludedDir({ name, relPath: `apps/frontend/x/src/${name}` })).toBe(false);
    }
    expect(isExcludedDir({ name: 'dist', relPath: 'scripts/dist' })).toBe(true);
    expect(
      isExcludedDir({ name: 'target', relPath: 'apps/frontend/client/src-tauri/target' }),
    ).toBe(true);
    expect(isExcludedDir({ name: '.svelte-kit', relPath: 'apps/x/.svelte-kit' })).toBe(true);
    expect(isExcludedDir({ name: 'git', relPath: '.pi/git' })).toBe(true);
    expect(isExcludedDir({ name: 'workspaces', relPath: '.pi/workspaces' })).toBe(true);
    expect(isExcludedDir({ name: 'dist', relPath: 'scripts/src/lib/dist' })).toBe(false);
    expect(isExcludedDir({ name: 'vendor', relPath: 'apps/x/src/views/vendor' })).toBe(false);
    expect(isExcludedDir({ name: 'src', relPath: 'apps/x/src' })).toBe(false);
  });
});

describe('analyseFileStructure', () => {
  test('a pure data table has no logic declarations', () => {
    const structure = analyseFileStructure(
      'export const COUNTRY_CODES: Record<string, string> = { US: "United States", GB: "United Kingdom" };\n',
    );
    expect(structure.logicDeclarations).toBe(0);
  });

  test('a schema built from call expressions has no logic declarations', () => {
    const structure = analyseFileStructure(
      'export const users = sqliteTable("users", { id: text("id").primaryKey() });\n',
    );
    expect(structure.logicDeclarations).toBe(0);
  });

  test('function and class declarations count as logic', () => {
    const structure = analyseFileStructure(
      'export function a() {}\nfunction b() {}\nexport class C {}\nclass D {}\n',
    );
    expect(structure.logicDeclarations).toBe(4);
    expect(structure.exportedDeclarations).toBe(2);
  });

  test('an arrow function bound to a const counts as logic', () => {
    const structure = analyseFileStructure(
      'export const doThing = (options: { a: number }) => options.a;\n',
    );
    expect(structure.logicDeclarations).toBe(1);
    expect(structure.exportedDeclarations).toBe(1);
  });

  test('an object literal bound to a const does not count as logic', () => {
    expect(analyseFileStructure('export const MAP = { a: 1, b: 2 };\n').logicDeclarations).toBe(0);
  });

  test('a file the parser cannot handle is treated as logic-bearing', () => {
    // Conservative: an unparseable file cannot be PROVEN declarative, so it may
    // not claim a declarative exemption.
    const structure = analyseFileStructure('<<< not valid typescript at all >>>');
    expect(structure.logicDeclarations).toBeGreaterThan(0);
  });
});
