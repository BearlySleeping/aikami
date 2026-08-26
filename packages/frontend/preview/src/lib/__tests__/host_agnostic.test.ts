// packages/frontend/preview/src/lib/__tests__/host_agnostic.test.ts
//
// AC-1: The package is host-agnostic.
// Verifies that no module imports from apps/**, $app/*, $lib/*, $services,
// or any Svelte store defined outside the package.

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '../../..');
const srcDir = join(packageRoot, 'src');

/** Recursively collect all .ts and .svelte files in a directory. */
const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))) {
      files.push(fullPath);
    }
  }
  return files;
};

/** Forbidden import patterns that would violate host-agnosticism. */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+['"]\$app\//, reason: 'SvelteKit $app/* module' },
  { pattern: /from\s+['"]\$lib\//, reason: 'Client $lib/* alias' },
  { pattern: /from\s+['"]\$services/, reason: 'Client $services barrel' },
  { pattern: /from\s+['"]\$views/, reason: 'Client $views alias' },
  { pattern: /from\s+['"]\$types/, reason: 'Client $types alias' },
  { pattern: /from\s+['"]apps\//, reason: 'Direct app import' },
  { pattern: /from\s+['"]\.\.\/apps\//, reason: 'Relative app import' },
];

describe('AC-1: Package is host-agnostic', () => {
  const sourceFiles = collectSourceFiles(srcDir);

  it('should not import from any app or SvelteKit module', () => {
    const violations: Array<{ file: string; pattern: string; line: string }> = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(packageRoot, ''),
              pattern: reason,
              line: line.trim(),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `  ${v.file}:${v.pattern} — ${v.line}`)
        .join('\n');
      expect.fail(`Found ${violations.length} host-agnostic violations:\n${message}`);
    }
  });

  it('should have two separate entrypoints (static vs sandbox)', () => {
    const indexContent = readFileSync(join(srcDir, 'index.ts'), 'utf-8');
    const sandboxContent = readFileSync(join(srcDir, 'sandbox.ts'), 'utf-8');

    // Static entrypoint should NOT export WalkSandbox
    expect(indexContent).not.toContain('WalkSandbox');
    // Sandbox entrypoint should NOT export LpcPreview
    expect(sandboxContent).not.toContain('LpcPreview');
  });

  it('should not declare dependency on any app package', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };

    const appDeps = Object.keys(allDeps).filter(
      (dep) => dep.includes('@aikami/client') || dep.includes('@aikami/hub'),
    );
    expect(appDeps).toEqual([]);
  });
});
