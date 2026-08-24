// scripts/src/lib/catalog/__tests__/publish_preflight.test.ts
//
// Attribution preflight gate tests (C-395 AC-4, integration level).
//
// The gate must fire BEFORE the upload phase and the index must not be
// written. A test that only asserts the exit code does not prove the gate
// fired before uploading — these assert all three: non-zero result, zero
// objects uploaded, and no index object written. Plus the hardening rule:
// no entry is silently assigned a permissive licence or a silently-empty
// authors array.

import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runCatalogPublish } from '../pipeline.ts';
import { runAttributionPreflight } from '../preflight.ts';
import { FakeR2Client, makeFixtureContentPacks, makeFixtureGameData } from './fixtures.ts';

describe('attribution preflight (AC-4)', () => {
  let gameDataDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = makeFixtureGameData();
    client = new FakeR2Client();
  });

  const config = () => ({
    accessKeyId: 'test',
    secretAccessKey: 'test',
    endpoint: 'https://test.r2.cloudflarestorage.com',
    bucket: 'aikami-catalog',
    originUrl: 'https://assets.example.test',
  });

  test('passes when every catalog tag resolves to attribution', () => {
    const result = runAttributionPreflight({
      entries: [
        {
          tag: 'lpc:hat:magic:celestial_adult:thrust',
          path: 'lpc/hat/magic/celestial_adult.thrust.webp',
        },
        { tag: 'music:exploration:bgm_explore', path: 'music/exploration/bgm_explore.webm' },
      ],
      creditsByTag: {
        'lpc:hat:magic:celestial_adult:thrust': {
          licenses: ['OGA-BY 3.0'],
          authors: ['bluecarrot16'],
        },
        'music:exploration:bgm_explore': { licenses: ['MIT'], authors: ['Aikami Studio'] },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.unresolvedTags).toEqual([]);
    expect(result.checkedCount).toBe(2);
  });

  test('fails with the unresolved tag named, and only that tag', () => {
    const result = runAttributionPreflight({
      entries: [
        { tag: 'lpc:ok', path: 'lpc/ok.webp' },
        { tag: 'music:bad', path: 'music/bad.webm' },
      ],
      creditsByTag: {
        'lpc:ok': { licenses: ['OGA-BY 3.0'], authors: ['bluecarrot16'] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.unresolvedTags).toEqual(['music:bad']);
  });

  test('fails on a credit with empty licenses AND empty authors — never silent (AC-4)', () => {
    const result = runAttributionPreflight({
      entries: [{ tag: 'music:silent', path: 'music/silent.webm' }],
      creditsByTag: {
        'music:silent': { licenses: [], authors: [] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.incompleteAttributionTags).toEqual(['music:silent']);
  });

  test('a credit with a permissive license but empty authors fails — no silent authorship (AC-4)', () => {
    const result = runAttributionPreflight({
      entries: [{ tag: 'sprites:anon', path: 'sprites/anon.webp' }],
      creditsByTag: {
        'sprites:anon': { licenses: ['CC0'], authors: [] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.incompleteAttributionTags).toEqual(['sprites:anon']);
  });

  test('a credit with authors but no license fails — the declaration must assert both', () => {
    const result = runAttributionPreflight({
      entries: [{ tag: 'music:no-license', path: 'music/no-license.webm' }],
      creditsByTag: {
        'music:no-license': { licenses: [], authors: ['Aikami Studio'] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.incompleteAttributionTags).toEqual(['music:no-license']);
  });

  test('covers EVERY catalog asset, not just lpc: tags (AC-4 scope)', () => {
    const result = runAttributionPreflight({
      entries: [
        { tag: 'lpc:fine', path: 'lpc/fine.webp' },
        { tag: 'music:uncovered', path: 'music/uncovered.webm' },
        { tag: 'sprites:uncovered', path: 'sprites/uncovered.webp' },
      ],
      creditsByTag: {
        'lpc:fine': { licenses: ['OGA-BY 3.0'], authors: ['bluecarrot16'] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.unresolvedTags).toContain('music:uncovered');
    expect(result.unresolvedTags).toContain('sprites:uncovered');
  });

  test('pipeline: preflight failure ⇒ non-zero result, ZERO uploads, NO index object (integration)', async () => {
    // Strip one credit from the fixture's asset_credits.json.
    const creditsPath = join(gameDataDir, 'asset_credits.json');
    const { readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const credits = JSON.parse(readFileSync(creditsPath, 'utf8'));
    delete credits.credits['music:exploration:bgm_explore'];
    writeFileSync(creditsPath, JSON.stringify(credits));

    const report = await runCatalogPublish({ config: config(), client, gameDataDir });

    // 1. non-zero result
    expect(report.ok).toBe(false);
    // 2. zero objects uploaded — the gate fired before the upload phase
    expect(report.uploaded).toBe(0);
    expect(report.skipped).toBe(0);
    expect(client.putCount).toBe(0);
    expect(client.objects.size).toBe(0);
    // 3. no index object written
    expect(report.rootKey).toBe('index/v1/catalog.json');
    expect(client.objects.has('index/v1/catalog.json')).toBe(false);
    // 4. the run names the unresolved tag
    expect(report.unresolvedTags).toContain('music:exploration:bgm_explore');
  });

  // C-433: tilesets are now catalog assets (reversing C-395 exclusion).
  test('tilesets and maps are now included in the catalog entry list (C-433)', () => {
    const { loadCatalogEntries } =
      require('../catalog_entries.ts') as typeof import('../catalog_entries.ts');
    const entries = loadCatalogEntries({ gameDataDir });
    const tags = entries.map((e) => e.tag);
    expect(tags).toContain('lpc:hat:magic:celestial_adult:thrust');
    expect(tags).toContain('music:exploration:bgm_explore');
    // C-433: tilesets are now included.
    expect(tags).toContain('sprites:tilesets:atlas.webp');
    expect(tags).toContain('sprites:tilesets:atlas.json');
    // C-433: maps are now included.
    expect(tags).toContain('maps:sandbox_zone_a');
  });

  // C-433: content-packs loaded from a separate root.
  test('content-packs are loaded from a separate root (C-433)', () => {
    const { loadCatalogEntries } =
      require('../catalog_entries.ts') as typeof import('../catalog_entries.ts');
    const entries = loadCatalogEntries({ gameDataDir, contentPacksDir: makeFixtureContentPacks() });
    const tags = entries.map((e) => e.tag);
    expect(tags).toContain('index.json');
    expect(tags).toContain('emberwatch:manifest.json');
    expect(tags).toContain('emberwatch:maps:inn.json');
  });

  // Regression test: invalid game-data manifest must rethrow, not be silently skipped.
  test('invalid game-data manifest throws error (regression)', () => {
    const { mkdtempSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const invalidDir = mkdtempSync(join(tmpdir(), 'catalog-invalid-manifest-'));
    writeFileSync(join(invalidDir, 'manifest.json'), 'invalid-json{');

    const { loadCatalogEntries } =
      require('../catalog_entries.ts') as typeof import('../catalog_entries.ts');
    expect(() => loadCatalogEntries({ gameDataDir: invalidDir })).toThrow();
  });

  // C-433: new categories pass attribution preflight.
  test('new categories pass attribution preflight when credits are declared (C-433)', () => {
    const result = runAttributionPreflight({
      entries: [
        { tag: 'maps:sandbox_zone_a', path: 'maps/sandbox_zone_a.json' },
        { tag: 'sprites:tilesets:atlas.webp', path: 'sprites/tilesets/atlas.webp' },
        { tag: 'index.json', path: 'index.json' },
      ],
      creditsByTag: {
        'maps:sandbox_zone_a': { licenses: ['MIT'], authors: ['Aikami Studio'] },
        'sprites:tilesets:atlas.webp': { licenses: ['MIT'], authors: ['Aikami Studio'] },
        'index.json': { licenses: ['MIT'], authors: ['Aikami Studio'] },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.unresolvedTags).toEqual([]);
  });
});
