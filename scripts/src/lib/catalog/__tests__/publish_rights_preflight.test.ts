// scripts/src/lib/catalog/__tests__/publish_rights_preflight.test.ts
//
// C-518 AC-5 (production path): the catalog publication preflight requests
// missing rights evidence from `runCatalogPublish` — the real publish entry
// point — and refuses BEFORE any object is uploaded.
//
// The evidence comes from the catalog's own `asset_credits.json` `rights`
// block. A catalog that declares no rights block keeps the pre-C-518
// behaviour (asserted by publish_preflight.test.ts).

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCatalogPublish } from '../pipeline.ts';
import { FakeR2Client, makeFixtureGameData } from './fixtures.ts';

type RightsEvidence = {
  evidenceUrl?: string;
  evidenceVersion?: string;
  evidenceDate?: string;
  scopes?: Partial<Record<'inference' | 'gameInclusion' | 'standaloneDistribution', string>>;
};

const ALLOWED: RightsEvidence = {
  evidenceUrl: 'https://example.test/model-card',
  evidenceVersion: 'v1.2.0',
  evidenceDate: '2026-09-13',
  scopes: { gameInclusion: 'allowed', standaloneDistribution: 'allowed' },
};

/** An empty content-packs root: this test publishes the game-data fixture only. */
const emptyContentPacksDir = (): string => mkdtempSync(join(tmpdir(), 'catalog-rights-no-packs-'));

const config = () => ({
  accessKeyId: 'test',
  secretAccessKey: 'test',
  endpoint: 'https://test.r2.cloudflarestorage.com',
  bucket: 'aikami-catalog',
  originUrl: 'https://assets.example.test',
});

const creditsOf = (gameDataDir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(gameDataDir, 'asset_credits.json'), 'utf8')).credits as Record<
    string,
    unknown
  >;

const writeRights = (gameDataDir: string, rights: Record<string, RightsEvidence>): void => {
  writeFileSync(
    join(gameDataDir, 'asset_credits.json'),
    JSON.stringify({ credits: creditsOf(gameDataDir), rights }),
  );
};

describe('C-518 AC-5: the publish preflight requests missing rights evidence', () => {
  test('a declared rights block with a missing tag refuses before uploading', async () => {
    const gameDataDir = makeFixtureGameData();
    const client = new FakeR2Client();
    writeRights(gameDataDir, { 'lpc:hat:magic:celestial_adult:thrust': ALLOWED });

    const report = await runCatalogPublish({
      config: config(),
      client,
      gameDataDir,
      contentPacksDir: emptyContentPacksDir(),
    });

    expect(report.ok).toBe(false);
    // The gate fired before the upload phase — nothing was written at all.
    expect(report.uploaded).toBe(0);
    expect(client.putCount).toBe(0);
    expect(client.objects.size).toBe(0);
    // The tag that has evidence is not named; the other catalog tags are.
    expect(report.missingRightsEvidenceTags).not.toContain('lpc:hat:magic:celestial_adult:thrust');
    expect(report.missingRightsEvidenceTags).toContain('music:exploration:bgm_explore');
    expect(report.incompleteRightsTags).toEqual([]);
  });

  test('a complete rights block publishes', async () => {
    const gameDataDir = makeFixtureGameData();
    const client = new FakeR2Client();
    const rights = Object.fromEntries(
      Object.keys(creditsOf(gameDataDir)).map((tag) => [tag, ALLOWED]),
    );
    writeRights(gameDataDir, rights);

    const report = await runCatalogPublish({
      config: config(),
      client,
      gameDataDir,
      contentPacksDir: emptyContentPacksDir(),
    });

    expect(report.missingRightsEvidenceTags).toEqual([]);
    expect(report.incompleteRightsTags).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('an `unknown` scope is incomplete evidence, not permission', async () => {
    const gameDataDir = makeFixtureGameData();
    const client = new FakeR2Client();
    const rights = Object.fromEntries(
      Object.keys(creditsOf(gameDataDir)).map((tag) => [
        tag,
        { ...ALLOWED, scopes: { gameInclusion: 'allowed', standaloneDistribution: 'unknown' } },
      ]),
    );
    writeRights(gameDataDir, rights);

    const report = await runCatalogPublish({
      config: config(),
      client,
      gameDataDir,
      contentPacksDir: emptyContentPacksDir(),
    });

    expect(report.ok).toBe(false);
    expect(report.incompleteRightsTags).toContain('music:exploration:bgm_explore');
    expect(report.missingRightsEvidenceTags).toEqual([]);
    expect(client.putCount).toBe(0);
  });

  test('undated evidence cannot substantiate publication', async () => {
    const gameDataDir = makeFixtureGameData();
    const client = new FakeR2Client();
    const rights = Object.fromEntries(
      Object.keys(creditsOf(gameDataDir)).map((tag) => [
        tag,
        { evidenceUrl: ALLOWED.evidenceUrl, scopes: ALLOWED.scopes },
      ]),
    );
    writeRights(gameDataDir, rights);

    const report = await runCatalogPublish({
      config: config(),
      client,
      gameDataDir,
      contentPacksDir: emptyContentPacksDir(),
    });
    expect(report.ok).toBe(false);
    expect(report.incompleteRightsTags).toContain('music:exploration:bgm_explore');
  });
});
