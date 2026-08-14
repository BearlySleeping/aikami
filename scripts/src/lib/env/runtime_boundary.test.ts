// scripts/src/lib/env/runtime_boundary.test.ts
//
// 🔴 THE BUN/NODE BOUNDARY — the whole point of this file.
//
// This repo runs on Bun and should keep doing so. But `.pi/extensions/*.ts`
// are loaded by pi, whose bin is `#!/usr/bin/env node` — the
// `"npmCommand": ["bun"]` setting in .pi/settings.json chooses the package
// *installer*, not the interpreter. So any module reachable from an extension
// executes under Node, where the `Bun` global does not exist.
//
// A `Bun.*` call in that import graph throws `ReferenceError: Bun is not
// defined` at the moment it's reached — not at load, which is why it shows up
// as a mystery failure in one command months after the offending line landed.
//
// The rest of scripts/src is free to use Bun APIs. This test only guards the
// frontier, so the boundary is enforced mechanically instead of remembered.

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');
const extensionsDir = join(repoRoot, '.pi/extensions');

/** Every local module reachable from `entry` via relative imports. */
const importGraph = (entry: string): string[] => {
  const seen = new Set<string>();

  const walk = (file: string): void => {
    let resolved = file;
    for (const extension of ['', '.ts', '/index.ts']) {
      try {
        if (statSync(resolved + extension).isFile()) {
          resolved += extension;
          break;
        }
      } catch {
        // Try the next candidate suffix.
      }
    }
    if (seen.has(resolved)) {
      return;
    }
    let source: string;
    try {
      source = readFileSync(resolved, 'utf8');
    } catch {
      return; // Bare specifier or missing file — not ours to police.
    }
    seen.add(resolved);
    for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
      walk(resolve(dirname(resolved), match[1] as string));
    }
  };

  walk(entry);
  return [...seen];
};

/** Lines using the `Bun` global, ignoring comments. */
const bunGlobalUses = (file: string): string[] => {
  const offenders: string[] = [];
  let inBlockComment = false;

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (inBlockComment) {
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        return;
      }
      if (trimmed.startsWith('/*')) {
        inBlockComment = !trimmed.includes('*/');
        return;
      }
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
        return;
      }
      const code = trimmed.replace(/\/\/.*$/, '');
      // `Bun.x` and `Bun['x']`, but not `typeof Bun`, `bun`, or `SomeBun.x`.
      if (/(?<![\w$.])Bun\s*[.[]/.test(code)) {
        offenders.push(`${relative(repoRoot, file)}:${index + 1}  ${code}`);
      }
    });

  return offenders;
};

const extensionEntries = readdirSync(extensionsDir)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => join(extensionsDir, file));

describe('pi extensions run under Node — no Bun globals in their import graph', () => {
  it('finds the extensions to check', () => {
    // Guards the guard: a bad glob would make every case below vacuously pass.
    expect(extensionEntries.length).toBeGreaterThan(5);
  });

  for (const entry of extensionEntries) {
    it(`${relative(repoRoot, entry)} and everything it imports`, () => {
      const offenders = importGraph(entry).flatMap(bunGlobalUses);
      expect(offenders).toEqual([]);
    });
  }
});

describe('bunGlobalUses', () => {
  it('detects a real call but ignores comments and lookalikes', () => {
    // Proves the detector actually fires — otherwise the suite above could
    // pass simply because the regex never matches anything.
    const fixture = join(import.meta.dir, 'which.ts');
    expect(bunGlobalUses(fixture)).toEqual([]);

    const detect = (code: string): boolean => /(?<![\w$.])Bun\s*[.[]/.test(code);
    expect(detect('const x = Bun.which("bash");')).toBe(true);
    expect(detect('Bun["which"]("bash")')).toBe(true);
    expect(detect('typeof Bun !== "undefined"')).toBe(false);
    expect(detect('import { bunFoo } from "./bun";')).toBe(false);
    expect(detect('myBun.which("bash")')).toBe(false);
  });
});
