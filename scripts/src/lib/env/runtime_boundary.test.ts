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

/**
 * Runs `file` in a real, separate `node` process (never bun — this repo's
 * own `bun test` runner ships the `Bun` global, which would make a
 * Bun-only violation invisible) and reports whether it threw.
 *
 * This is the execution-based half of the boundary guard: the regex checks
 * below prove no *known* `Bun.*` spelling appears in source; this proves an
 * extension shaped exactly like the real ones actually loads — or actually
 * fails — under the runtime pi uses in production.
 */
const runUnderNode = (file: string): { ok: boolean; stderr: string } => {
  const runner = join(import.meta.dir, 'fixtures/node_loader_runner.ts');
  const result = Bun.spawnSync(['node', runner, file], {
    stderr: 'pipe',
    // contract_stage only registers inside a pipeline worker (see
    // .pi/extensions/lib/gating.ts) — set the role so this smoke sees the
    // same tool surface registration.test.ts does.
    env: { ...process.env, CONTRACT_PIPELINE_ROLE: 'implementer' },
  });
  return { ok: result.exitCode === 0, stderr: result.stderr.toString() };
};

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

describe('Node process smoke — execution proof, not just a source grep', () => {
  it('a clean extension loads and registers under a real node process', () => {
    const fixture = join(import.meta.dir, 'fixtures/valid_extension.ts');
    const { ok, stderr } = runUnderNode(fixture);
    expect(ok, stderr).toBe(true);
  });

  it('a fixture that calls the Bun global fails the boundary under node', () => {
    const fixture = join(import.meta.dir, 'fixtures/invalid_bun_only_extension.ts');
    const { ok, stderr } = runUnderNode(fixture);
    expect(ok).toBe(false);
    expect(stderr).toContain('Bun is not defined');
  });

  // Spawns a fresh `node` process per extension (~20 of them); each pays
  // jiti's own startup cost on top of node's, so bun's 5s default timeout
  // is comfortably local-only — a cold CI runner (esp. Windows/macOS)
  // needs real headroom.
  it('every real extension loads and registers under a real node process', () => {
    for (const entry of extensionEntries) {
      const { ok, stderr } = runUnderNode(entry);
      expect(ok, `${relative(repoRoot, entry)}: ${stderr}`).toBe(true);
    }
  }, 60_000);
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
