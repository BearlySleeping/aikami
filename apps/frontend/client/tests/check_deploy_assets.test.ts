// apps/frontend/client/tests/check_deploy_assets.test.ts
//
// Focused tests for the deployment-asset guard (scripts/check_deploy_assets.ts).
//
// The guard is the last line of defence between a generated `build/` and
// `wrangler deploy`: Cloudflare rejects any static asset above 25 MiB, and ORT
// WASM must never appear in the client output at all. These tests pin the
// boundary behaviour so a future change cannot silently loosen it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeDeployAssets,
  CLOUDFLARE_MAX_ASSET_BYTES,
  findDuplicateBinaries,
  isOrtWasm,
  MAX_ASSET_BYTES,
  toMib,
} from '../scripts/check_deploy_assets.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aikami-deploy-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a file of exactly `bytes` zeros, creating parent directories. */
const writeSized = (relativePath: string, bytes: number, fill = 0): void => {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, fill));
};

describe('isOrtWasm', () => {
  test('matches the emitted ORT wasm filenames', () => {
    expect(isOrtWasm('ort-wasm-simd-threaded.jsep.wasm')).toBe(true);
    expect(isOrtWasm('_app/immutable/assets/ort-wasm-simd-threaded.asyncify.CxOG5pUO.wasm')).toBe(
      true,
    );
    expect(
      isOrtWasm('_app/immutable/workers/assets/ort-wasm-simd-threaded.asyncify-D5D0fo7z.wasm'),
    ).toBe(true);
  });

  test('does not match unrelated binaries', () => {
    expect(isOrtWasm('sqlite3.5oONAuZq.wasm')).toBe(false);
    expect(isOrtWasm('ort-wasm-simd-threaded.jsep.mjs')).toBe(false);
    expect(isOrtWasm('my-ort-thing.wasm')).toBe(false);
  });
});

describe('analyzeDeployAssets — asset ceiling', () => {
  test('passes for a small output tree', () => {
    writeSized('index.html', 1024);
    writeSized('_app/immutable/chunks/a.js', 2048);
    const report = analyzeDeployAssets(root);
    expect(report.ok).toBe(true);
    expect(report.oversized).toEqual([]);
    expect(report.assets).toHaveLength(2);
  });

  test('fails exactly at the 24 MiB ceiling (inclusive)', () => {
    writeSized('large.bin', MAX_ASSET_BYTES);
    const report = analyzeDeployAssets(root);
    expect(report.ok).toBe(false);
    expect(report.oversized).toHaveLength(1);
    expect(report.oversized[0].bytes).toBe(MAX_ASSET_BYTES);
  });

  test('passes one byte below the ceiling', () => {
    writeSized('large.bin', MAX_ASSET_BYTES - 1);
    const report = analyzeDeployAssets(root);
    expect(report.ok).toBe(true);
    expect(report.oversized).toEqual([]);
  });

  test('fails one byte above the ceiling', () => {
    writeSized('large.bin', MAX_ASSET_BYTES + 1);
    const report = analyzeDeployAssets(root);
    expect(report.ok).toBe(false);
  });

  test('the Aikami ceiling is stricter than Cloudflare’s', () => {
    expect(MAX_ASSET_BYTES).toBeLessThan(CLOUDFLARE_MAX_ASSET_BYTES);
    expect(toMib(MAX_ASSET_BYTES)).toBe(24);
  });

  test('reports exact raw bytes, not just MiB', () => {
    writeSized('_app/immutable/assets/huge.js', MAX_ASSET_BYTES + 1234);
    const report = analyzeDeployAssets(root);
    expect(report.oversized[0].bytes).toBe(MAX_ASSET_BYTES + 1234);
    expect(report.oversized[0].relativePath).toBe('_app/immutable/assets/huge.js');
  });
});

describe('analyzeDeployAssets — nested directories', () => {
  test('recurses through the adapter output layout', () => {
    writeSized('_app/immutable/entry/start.js', 10);
    writeSized('_app/immutable/chunks/nested/deep/b.js', 10);
    writeSized('workers/assets/c.js', 10);
    const report = analyzeDeployAssets(root);
    expect(report.assets.map((asset) => asset.relativePath).sort()).toEqual([
      '_app/immutable/chunks/nested/deep/b.js',
      '_app/immutable/entry/start.js',
      'workers/assets/c.js',
    ]);
  });

  test('detects an oversized file in a nested directory', () => {
    writeSized(
      '_app/immutable/workers/assets/ort-wasm-simd-threaded.asyncify-D5D0fo7z.wasm',
      MAX_ASSET_BYTES + 1,
    );
    const report = analyzeDeployAssets(root);
    expect(report.oversized).toHaveLength(1);
    expect(report.ortLeaks).toHaveLength(1);
    expect(report.ok).toBe(false);
  });
});

describe('analyzeDeployAssets — ORT leakage', () => {
  test('fails on a tiny ORT wasm regardless of size', () => {
    // A small ORT wasm must still fail: ORT belongs on the distribution plane.
    writeSized('_app/immutable/assets/ort-wasm-simd-threaded.jsep.wasm', 64);
    const report = analyzeDeployAssets(root);
    expect(report.ok).toBe(false);
    expect(report.ortLeaks).toHaveLength(1);
    expect(report.ortLeaks[0].relativePath).toBe(
      '_app/immutable/assets/ort-wasm-simd-threaded.jsep.wasm',
    );
    // Also proves it is not merely an oversized-asset failure.
    expect(report.oversized).toEqual([]);
  });

  test('flags ORT leakage under worker assets too', () => {
    writeSized('_app/immutable/workers/assets/ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm', 128);
    const report = analyzeDeployAssets(root);
    expect(report.ortLeaks).toHaveLength(1);
    expect(report.ok).toBe(false);
  });
});

describe('duplicate detection', () => {
  test('detects identical large binaries at multiple paths', () => {
    // Same content above the 1 MiB hashing threshold, emitted twice.
    writeSized(
      '_app/immutable/assets/ort-wasm-simd-threaded.asyncify.CxOG5pUO.wasm',
      2 * 1024 * 1024,
      7,
    );
    writeSized(
      '_app/immutable/workers/assets/ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm',
      2 * 1024 * 1024,
      7,
    );
    const report = analyzeDeployAssets(root);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0].relativePaths).toHaveLength(2);
    expect(report.ok).toBe(false);
  });

  test('ignores identical small files below the threshold', () => {
    writeSized('a.js', 100, 3);
    writeSized('b.js', 100, 3);
    const report = analyzeDeployAssets(root);
    expect(report.duplicates).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('does not group different content at the same size', () => {
    writeSized('a.bin', 2 * 1024 * 1024, 1);
    writeSized('b.bin', 2 * 1024 * 1024, 2);
    const report = analyzeDeployAssets(root);
    expect(report.duplicates).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('findDuplicateBinaries returns the sha256 and byte size', () => {
    writeSized('a.bin', 2 * 1024 * 1024, 9);
    writeSized('b.bin', 2 * 1024 * 1024, 9);
    const groups = findDuplicateBinaries(root, analyzeDeployAssets(root).assets);
    expect(groups).toHaveLength(1);
    expect(groups[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(groups[0].bytes).toBe(2 * 1024 * 1024);
    expect(groups[0].relativePaths).toEqual(['a.bin', 'b.bin']);
  });
});

describe('dev-route leakage', () => {
  test('fails when the (dev) route group output is present', () => {
    writeSized('dev/sandbox/index.html', 100);
    const report = analyzeDeployAssets(root);
    expect(report.devRouteLeaks).toEqual(['dev']);
    expect(report.ok).toBe(false);
  });

  test('passes when dev routes are explicitly allowed', () => {
    writeSized('dev/sandbox/index.html', 100);
    const report = analyzeDeployAssets(root, { allowDevRoutes: true });
    expect(report.devRouteLeaks).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('does not flag a nested path that merely contains "dev"', () => {
    writeSized('_app/immutable/dev-tools.js', 10);
    writeSized('developer/index.html', 10);
    const report = analyzeDeployAssets(root);
    expect(report.devRouteLeaks).toEqual([]);
  });
});

describe('largest-assets report', () => {
  test('is sorted descending and capped', () => {
    for (let index = 0; index < 25; index++) {
      writeSized(`file-${index}.bin`, (index + 1) * 10);
    }
    const report = analyzeDeployAssets(root);
    expect(report.largest).toHaveLength(20);
    for (let index = 1; index < report.largest.length; index++) {
      expect(report.largest[index - 1].bytes).toBeGreaterThanOrEqual(report.largest[index].bytes);
    }
    expect(report.largest[0].relativePath).toBe('file-24.bin');
  });

  test('totals every file’s bytes', () => {
    writeSized('a', 100);
    writeSized('nested/b', 250);
    expect(analyzeDeployAssets(root).totalBytes).toBe(350);
  });
});
