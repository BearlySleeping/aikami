// packages/shared/local-ai/src/lib/dependency.test.ts
//
// AC-0: the planning core is importable without the stack project and its
// public entry point imports no Node/Bun-only module (node:child_process,
// node:fs, node:os). This is a build-time assertion, not a review
// convention — a stray `import { spawn } from 'node:child_process'` in the
// core silently breaks the Tauri path months later.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');

const NODE_BUILTIN_PATTERNS = [
  /from\s+['"]node:child_process['"]/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:os['"]/,
  /from\s+['"]node:path['"]/,
];

const listTsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

describe('AC-0 — package boundary', () => {
  test('package.json has no dependency on the stack project or any app', async () => {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toContain('@aikami/schemas');
    expect(deps).toContain('@aikami/types');
    for (const dep of deps) {
      expect(dep).not.toMatch(/local-stack/);
      expect(dep).not.toMatch(/^@aikami\/backend/);
      expect(dep).not.toMatch(/^@aikami\/frontend/);
    }
  });

  test('no source file imports Node builtins in its public graph', () => {
    const sources = listTsFiles(SRC_DIR).filter((file) => !file.endsWith('.test.ts'));
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of NODE_BUILTIN_PATTERNS) {
        expect(
          pattern.test(source),
          `${file} must not import a Node builtin (matched ${pattern})`,
        ).toBe(false);
      }
    }
  });

  test('the public entry point exists and re-exports the core', async () => {
    const index = await readFile(join(PACKAGE_ROOT, 'src', 'index.ts'), 'utf8');
    expect(index).toContain('probe_executor');
    expect(index).toContain('recommend');
    expect(index).toContain('detect');
  });
});
