// scripts/src/lib/ops/__tests__/generate_asset_seed.test.ts
//
// Content-pack rows are optional ONLY when the content-packs manifest is
// genuinely absent. Once the manifest exists, a malformed manifest, a missing
// `asset_hashes.json`, or a corrupt sidecar must FAIL generation — not quietly
// drop every content-pack row and still write a boot seed with a hole in it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLocalRows } from '../generate_asset_seed.ts';

const manifest = { scannedAt: '2026-01-01T00:00:00.000Z', assets: {} };
const hashes = { scannedAt: '2026-01-01T00:00:00.000Z', hashes: {} };
const credits = { credits: {} };

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value));

let root: string;
let scanDir: string;
let packsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aikami-seed-gen-'));
  scanDir = join(root, 'game-data');
  packsDir = join(root, 'packs');
  mkdirSync(scanDir, { recursive: true });
  mkdirSync(packsDir, { recursive: true });
  writeJson(join(scanDir, 'manifest.json'), manifest);
  writeJson(join(scanDir, 'asset_hashes.json'), hashes);
  writeJson(join(scanDir, 'asset_credits.json'), credits);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const build = () =>
  buildLocalRows({
    manifestPath: join(scanDir, 'manifest.json'),
    hashesPath: join(scanDir, 'asset_hashes.json'),
    contentPacksDir: packsDir,
  });

describe('content-pack rows are optional only when the manifest is absent', () => {
  test('an absent content-packs manifest skips content-pack rows without failing', async () => {
    const result = await build();
    expect(result.rows).toEqual([]);
  });

  test('a malformed content-packs manifest fails generation', async () => {
    writeFileSync(join(packsDir, 'manifest.json'), '{not json');
    await expect(build()).rejects.toThrow();
  });

  test('a present manifest whose hash sidecar is missing fails generation', async () => {
    writeJson(join(packsDir, 'manifest.json'), manifest);
    // asset_hashes.json intentionally absent.
    await expect(build()).rejects.toThrow();
  });

  test('a malformed content-packs hash sidecar fails generation', async () => {
    writeJson(join(packsDir, 'manifest.json'), manifest);
    writeFileSync(join(packsDir, 'asset_hashes.json'), '{not json');
    writeJson(join(packsDir, 'asset_credits.json'), credits);
    await expect(build()).rejects.toThrow();
  });

  test('a malformed content-packs credits sidecar fails generation', async () => {
    writeJson(join(packsDir, 'manifest.json'), manifest);
    writeJson(join(packsDir, 'asset_hashes.json'), hashes);
    writeFileSync(join(packsDir, 'asset_credits.json'), '{not json');
    await expect(build()).rejects.toThrow();
  });
});
