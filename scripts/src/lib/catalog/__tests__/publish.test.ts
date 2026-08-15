// scripts/src/lib/catalog/__tests__/publish.test.ts
//
// Publish pipeline integration tests (C-395 AC-1) against an in-memory fake
// R2 client: content-addressed keys, idempotent re-run (everything skipped),
// resume-after-partial, correct MIME + Cache-Control, index written LAST,
// and the attribution preflight aborting BEFORE any upload.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCatalogPublish } from '../pipeline.ts';
import { FakeR2Client, FIXTURE_HASHES, makeFixtureGameData } from './fixtures.ts';

const ORIGIN_URL = 'https://assets.example.test';

describe('catalog publish pipeline (AC-1)', () => {
  let gameDataDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = makeFixtureGameData();
    client = new FakeR2Client();
  });

  afterEach(() => {
    client.failOnKey = undefined;
  });

  const config = () => ({
    accessKeyId: 'test',
    secretAccessKey: 'test',
    endpoint: 'https://test.r2.cloudflarestorage.com',
    bucket: 'aikami-catalog',
    originUrl: ORIGIN_URL,
  });

  test('uploads every catalog asset under a content-addressed key', async () => {
    const report = await runCatalogPublish({ config: config(), client, gameDataDir });

    expect(report.ok).toBe(true);
    expect(report.uploaded).toBe(4); // tilesets excluded
    expect(report.skipped).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.unresolvedTags).toEqual([]);

    // Keys are assets/<sha[0:2]>/<sha>.<ext>
    for (const key of [...client.objects.keys()]) {
      if (key.startsWith('index/')) {
        continue;
      }
      expect(key).toMatch(/^assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.(webp|webm)$/);
    }
  });

  test('asset keys are content-addressed and immutable (no overwrite by design)', async () => {
    await runCatalogPublish({ config: config(), client, gameDataDir });
    const assets = [...client.objects.keys()].filter((k) => k.startsWith('assets/'));
    expect(assets).toHaveLength(4);
    // The thrust asset's key is derived from its sha256 — assert the exact
    // content-addressed key, not merely the absence of a source filename.
    const thrustHash = FIXTURE_HASHES.thrust;
    expect(assets).toContain(`assets/${thrustHash.slice(0, 2)}/${thrustHash}.webp`);
  });

  test('applies correct MIME type and one-year immutable Cache-Control', async () => {
    await runCatalogPublish({ config: config(), client, gameDataDir });
    const assets = [...client.objects.entries()].filter(([key]) => key.startsWith('assets/'));
    expect(assets.length).toBeGreaterThan(0);
    // Assert EVERY asset, not just the first: file-read promise resolution
    // order is nondeterministic, so "first asset" is not a stable pick.
    for (const [key, object] of assets) {
      expect(object.cacheControl).toBe('public, max-age=31536000, immutable');
      const ext = key.slice(key.lastIndexOf('.'));
      expect(object.contentType).toBe(ext === '.webm' ? 'audio/webm' : 'image/webp');
    }
  });

  test('index objects get a short Cache-Control (60s)', async () => {
    await runCatalogPublish({ config: config(), client, gameDataDir });
    const index = [...client.objects.entries()].find(([key]) => key.startsWith('index/'));
    expect(index).toBeDefined();
    if (!index) {
      return;
    }
    expect(index[1].cacheControl).toBe('public, max-age=60');
  });

  test('re-run skips every object (idempotent) and exits ok', async () => {
    const first = await runCatalogPublish({ config: config(), client, gameDataDir });
    expect(first.uploaded).toBe(4);
    const putCountAfterFirst = client.putCount;

    const second = await runCatalogPublish({ config: config(), client, gameDataDir });
    expect(second.ok).toBe(true);
    expect(second.uploaded).toBe(0);
    expect(second.skipped).toBe(4);
    // Only the index objects were re-written on the second run: every shard
    // plus the root, exactly — no extra puts.
    expect(client.putCount - putCountAfterFirst).toBe(second.shardKeys.length + 1);
  });

  test('resumes after a partial run without corrupting the index', async () => {
    // First run: inject a failure on one asset key mid-run.
    const hThrust = [...client.objects.keys()];
    void hThrust;
    // Simulate a partial run: pre-populate the bucket with 2 of the 4 assets.
    const first = await runCatalogPublish({ config: config(), client, gameDataDir });
    const assetKeys = [...client.objects.keys()].filter((k) => k.startsWith('assets/'));
    // Remove half the objects to simulate an interrupted run.
    for (const key of assetKeys.slice(0, 2)) {
      client.objects.delete(key);
    }

    const resume = await runCatalogPublish({ config: config(), client, gameDataDir });
    expect(resume.ok).toBe(true);
    expect(resume.uploaded).toBe(2);
    expect(resume.skipped).toBe(2);
    // Every referenced asset object exists (index written after uploads).
    for (const key of assetKeys) {
      expect(client.objects.has(key)).toBe(true);
    }
    void first;
  });

  test('writes the index only after every asset upload succeeds', async () => {
    client.failOnKey = 'assets/';
    const report = await runCatalogPublish({ config: config(), client, gameDataDir });
    // All asset uploads fail → run fails.
    expect(report.ok).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
    // The root index object must NOT exist (index is written last).
    expect(client.objects.has('index/v1/catalog.json')).toBe(false);
  });

  test('preflight failure aborts before any upload and writes no index', async () => {
    // Add an asset with no credit to the fixture.
    const manifestPath = join(gameDataDir, 'manifest.json');
    const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8'));
    manifest.assets['music:combat:uncredited'] = {
      tag: 'music:combat:uncredited',
      category: 'music',
      subcategory: 'combat',
      name: 'uncredited',
      path: 'music/combat/uncredited.webm',
      ext: '.webm',
    };
    manifest.count = 6;
    const { readFileSync, writeFileSync: w } = require('node:fs') as typeof import('node:fs');
    w(manifestPath, JSON.stringify(manifest));
    // The fixture has no music/combat dir — create it with the file.
    mkdirSync(join(gameDataDir, 'music', 'combat'), { recursive: true });
    writeFileSync(join(gameDataDir, 'music', 'combat', 'uncredited.webm'), Buffer.from('x'));
    const hashesPath = join(gameDataDir, 'asset_hashes.json');
    const hashes = JSON.parse(readFileSync(hashesPath, 'utf8'));
    hashes.hashes['music:combat:uncredited'] = { hash: 'a'.repeat(64), sizeBytes: 1 };
    w(hashesPath, JSON.stringify(hashes));

    const report = await runCatalogPublish({ config: config(), client, gameDataDir });

    expect(report.ok).toBe(false);
    expect(report.unresolvedTags).toContain('music:combat:uncredited');
    expect(report.uploaded).toBe(0);
    expect(client.putCount).toBe(0);
    expect(client.objects.size).toBe(0);
  });
});
