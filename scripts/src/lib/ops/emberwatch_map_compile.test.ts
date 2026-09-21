// scripts/src/lib/ops/emberwatch_map_compile.test.ts
//
// Semantic source → runtime map compile stability.
//
// Proves two things the authoring workflow depends on:
//   1. the builders' in-memory JSON is exactly the committed runtime map;
//   2. running the emitter twice produces byte-identical output ("clean
//      regeneration twice"), so a polish edit cannot hide nondeterminism.

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapJson, EMBERWATCH_MAP_BUILDERS } from './generate_emberwatch_maps.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const committedDir = join(repository, 'content/packs/emberwatch/maps');
const generator = join(repository, 'scripts/src/lib/ops/generate_emberwatch_maps.ts');

const mapIds = Object.keys(EMBERWATCH_MAP_BUILDERS);

describe('emberwatch map compile stability', () => {
  test('every builder compiles to the committed runtime map', () => {
    for (const mapId of mapIds) {
      const built = EMBERWATCH_MAP_BUILDERS[mapId];
      if (!built) {
        continue;
      }
      const { json } = buildMapJson(built());
      const committed = readFileSync(join(committedDir, `${mapId}.json`), 'utf8');
      expect(`${JSON.stringify(json, null, 2)}\n`, mapId).toBe(committed);
    }
  });

  test('regenerating twice is byte-identical and matches the committed maps', () => {
    const first = mkdtempSync(join(tmpdir(), 'emberwatch-maps-a-'));
    const second = mkdtempSync(join(tmpdir(), 'emberwatch-maps-b-'));
    try {
      const run = (outDir: string): void => {
        execFileSync('bun', [generator], {
          cwd: repository,
          env: { ...process.env, EMBERWATCH_MAP_OUT: outDir },
          stdio: 'pipe',
        });
      };
      run(first);
      run(second);
      for (const mapId of mapIds) {
        const a = readFileSync(join(first, `${mapId}.json`), 'utf8');
        const b = readFileSync(join(second, `${mapId}.json`), 'utf8');
        const committed = readFileSync(join(committedDir, `${mapId}.json`), 'utf8');
        expect(a, `${mapId} run A vs B`).toBe(b);
        expect(a, `${mapId} run A vs committed`).toBe(committed);
      }
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
