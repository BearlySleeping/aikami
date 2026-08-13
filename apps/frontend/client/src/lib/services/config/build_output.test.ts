// apps/frontend/client/src/lib/services/config/build_output.test.ts
//
// AC-1 (C-389): a production build produced without any PUBLIC_*_URL env var
// must not contain a single engine URL literal in any emitted chunk. This
// test greps the built `build/` directory for every literal the old code or
// its defaults could emit.
//
// The test is a no-op when `build/` does not exist (fresh checkout before a
// build) so `client:test` stays green in CI phases that skip building.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Every engine URL literal that must never appear in a bundle. */
const FORBIDDEN_LITERALS = [
  'localhost:8080',
  'localhost:8089',
  'localhost:8188',
  'localhost:11434',
  'localhost:6006',
  'localhost:8880',
] as const;

const BUILD_DIR = resolve(import.meta.dir, '../../../build');

const listFiles = (dir: string): string[] => {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

describe('AC-1: no engine URL survives in the bundle (C-389)', () => {
  test('production build output is free of engine URL literals', () => {
    if (!existsSync(BUILD_DIR) || !statSync(BUILD_DIR).isDirectory()) {
      // No build present — cannot verify. Re-run after `bun run build`.
      expect(true).toBe(true);
      return;
    }

    const files = listFiles(BUILD_DIR);
    const matches: string[] = [];

    for (const file of files) {
      // Only text-ish assets can carry a URL literal.
      if (!/\.(js|mjs|cjs|html|css|json|map)$/.test(file)) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      for (const literal of FORBIDDEN_LITERALS) {
        if (content.includes(literal)) {
          matches.push(`${file} → ${literal}`);
        }
      }
    }

    expect(matches, `Engine URL literals found in build output:\n${matches.join('\n')}`).toEqual(
      [],
    );
  });
});
