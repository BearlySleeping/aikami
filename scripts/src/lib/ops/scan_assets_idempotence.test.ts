// scripts/src/lib/ops/scan_assets_idempotence.test.ts
//
// The release model is: clean committed source -> deterministic rebuild ->
// seal. That only holds if regenerating the committed sidecars from identical
// inputs produces identical bytes.
//
// `scan_assets.ts` used to stamp `scannedAt: new Date().toISOString()` into
// every sidecar unconditionally, so a second otherwise-identical scan changed
// tracked files purely because time had passed. The candidate could then never
// be sealed from a clean tree in the same workflow that generated it.
//
// These tests run the real script against the real committed tree and assert
// that it is a no-op. They are integration tests on purpose: the property is
// about the files on disk, not about a helper's return value.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_PACKS_DIR, GAME_DATA_DIR } from '../catalog/config.ts';

/** Every sidecar `scan_assets.ts` generates, for both scan roots. */
const GENERATED_FILES = [
  join(GAME_DATA_DIR, 'manifest.json'),
  join(GAME_DATA_DIR, 'asset_hashes.json'),
  join(GAME_DATA_DIR, 'asset_credits.json'),
  join(CONTENT_PACKS_DIR, 'manifest.json'),
  join(CONTENT_PACKS_DIR, 'asset_hashes.json'),
  join(CONTENT_PACKS_DIR, 'asset_credits.json'),
];

const snapshot = (): Record<string, string> =>
  Object.fromEntries(GENERATED_FILES.map((path) => [path, readFileSync(path, 'utf8')]));

const runScan = (): void => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', join(import.meta.dirname, 'scan_assets.ts')],
    cwd: join(import.meta.dirname, '../../../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`scan_assets failed:\n${result.stderr.toString()}`);
  }
};

describe('scan_assets is byte-stable on identical inputs', () => {
  test('a scan of the committed tree rewrites nothing', () => {
    const before = snapshot();
    runScan();
    const after = snapshot();

    for (const path of GENERATED_FILES) {
      expect(after[path], `${path} changed on an otherwise identical scan`).toBe(before[path]);
    }
  }, 120_000);

  test('two consecutive scans produce identical bytes', () => {
    runScan();
    const first = snapshot();
    runScan();
    const second = snapshot();

    for (const path of GENERATED_FILES) {
      expect(second[path], `${path} differs between two consecutive scans`).toBe(first[path]);
    }
  }, 180_000);

  test('scannedAt is preserved rather than advanced when nothing changed', () => {
    const before = JSON.parse(readFileSync(join(GAME_DATA_DIR, 'manifest.json'), 'utf8')) as {
      scannedAt: string;
    };
    runScan();
    const after = JSON.parse(readFileSync(join(GAME_DATA_DIR, 'manifest.json'), 'utf8')) as {
      scannedAt: string;
    };
    expect(after.scannedAt).toBe(before.scannedAt);
  }, 120_000);
});
