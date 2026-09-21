// scripts/src/lib/catalog/__tests__/seed_determinism.test.ts
//
// The boot seed is a GENERATED artifact of the scan, and it must be
// reproducible: a candidate is sealed once and promoted unchanged, so two runs
// over the same source must produce the same bytes, and the same candidate must
// produce the same seed under staging and production.
//
// It also must not TRUNCATE. This checkout holds a few dozen tags while the
// published release carries ~12,700; uploading the local seed as-is would
// replace a complete boot seed with the local subset.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetHashesFile, AssetManifest } from '@aikami/types';
import { buildRows, buildSeedDocument } from '../../ops/generate_asset_seed.ts';
import {
  type CompactSeedDocument,
  mergeCompactSeeds,
  parseCompactSeed,
  serializeCompactSeed,
} from '../compact_seed.ts';
import { runSeedPublish } from '../seed_publish.ts';
import { FakeR2Client } from './fixtures.ts';

const row = (tag: string, hash: string) => ({
  t: tag,
  h: hash,
  s: 10,
  c: 'sprites',
  e: '.webp',
  l: ['MIT'],
});

const seedDoc = (rows: ReturnType<typeof row>[], overrides: Partial<CompactSeedDocument> = {}) => ({
  sv: 1 as const,
  g: '2026-01-01T00:00:00.000Z',
  o: '',
  r: rows,
  ...overrides,
});

describe('the seed document is a pure function of its inputs', () => {
  test('row order does not change the bytes', () => {
    const rows = [row('b', '2'.repeat(64)), row('a', '1'.repeat(64)), row('c', '3'.repeat(64))];
    const forward = serializeCompactSeed(
      buildSeedDocument({ rows, scannedAt: '2026-01-01T00:00:00.000Z', origin: '' }),
    );
    const reversed = serializeCompactSeed(
      buildSeedDocument({
        rows: [...rows].reverse(),
        scannedAt: '2026-01-01T00:00:00.000Z',
        origin: '',
      }),
    );
    expect(new TextDecoder().decode(forward)).toBe(new TextDecoder().decode(reversed));
  });

  test('repeating the build with unchanged inputs produces identical bytes', () => {
    const rows = [row('a', '1'.repeat(64)), row('b', '2'.repeat(64))];
    const first = serializeCompactSeed(
      buildSeedDocument({ rows, scannedAt: '2026-01-01T00:00:00.000Z', origin: '' }),
    );
    const second = serializeCompactSeed(
      buildSeedDocument({ rows, scannedAt: '2026-01-01T00:00:00.000Z', origin: '' }),
    );
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  test('the origin stamp is an explicit input, not the environment', () => {
    // A candidate is promoted unchanged, so the seed must not embed a
    // mode-specific asset base URL. `o` defaults to empty and is only ever set
    // by an explicit argument.
    const rows = [row('a', '1'.repeat(64))];
    const empty = buildSeedDocument({ rows, scannedAt: 'g', origin: '' });
    const explicit = buildSeedDocument({ rows, scannedAt: 'g', origin: 'https://x.test' });
    expect(empty.o).toBe('');
    expect(explicit.o).toBe('https://x.test');
  });

  test('buildRows is deterministic and skips tags with no hash entry', () => {
    const manifest = {
      scannedAt: '2026-01-01T00:00:00.000Z',
      assets: {
        'b:tag': { category: 'sprites', ext: '.webp', path: 'sprites/b.webp' },
        'a:tag': { category: 'sprites', ext: '.webp', path: 'sprites/a.webp' },
        'no:hash': { category: 'sprites', ext: '.webp', path: 'sprites/n.webp' },
      },
    } as unknown as AssetManifest;
    const hashes = {
      scannedAt: '2026-01-01T00:00:00.000Z',
      hashes: {
        'b:tag': { hash: 'b'.repeat(64), sizeBytes: 2 },
        'a:tag': { hash: 'a'.repeat(64), sizeBytes: 1 },
      },
    } as unknown as AssetHashesFile;
    const credits = { credits: {} };

    const first = buildRows({ manifest, hashes, credits });
    const second = buildRows({ manifest, hashes, credits });

    expect(first.rows.map((r) => r.t)).toEqual(['a:tag', 'b:tag']);
    expect(first.skipped).toEqual(['no:hash']);
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(second.rows));
  });
});

describe('merging a carried seed preserves inventory', () => {
  test('rows are unioned by tag, and a local row wins for its own tag', () => {
    const local = seedDoc([row('shared', 'l'.repeat(64)), row('local-only', 'x'.repeat(64))]);
    const carried = seedDoc([row('shared', 'c'.repeat(64)), row('carried-only', 'y'.repeat(64))]);

    const merged = mergeCompactSeeds({ local, carried });

    expect(merged.r.map((r) => r.t)).toEqual(['carried-only', 'local-only', 'shared']);
    expect(merged.r.find((r) => r.t === 'shared')?.h).toBe('l'.repeat(64));
  });

  test('a carried row the candidate cannot produce survives', () => {
    const merged = mergeCompactSeeds({
      local: seedDoc([row('a', '1'.repeat(64))]),
      carried: seedDoc([row('legacy:lpc:sheet', '9'.repeat(64))]),
    });
    expect(merged.r.map((r) => r.t)).toContain('legacy:lpc:sheet');
  });

  test('a document that is not a compact seed is refused', () => {
    expect(() => parseCompactSeed(new TextEncoder().encode('{"seed":true}'), 'fixture')).toThrow(
      /no `r` row array/,
    );
    expect(() => parseCompactSeed(new TextEncoder().encode('{not json'), 'fixture')).toThrow(
      /not valid JSON/,
    );
  });

  test('every compact document and row field is runtime-validated', () => {
    const validRow = row('a', '1'.repeat(64));
    const valid = seedDoc([validRow]);
    for (const invalid of [
      { ...valid, sv: 2 },
      { ...valid, g: 1 },
      { ...valid, o: null },
      { ...valid, r: [{ ...validRow, h: 42 }] },
      { ...valid, r: [{ ...validRow, l: ['MIT', 42] }] },
    ]) {
      expect(() =>
        parseCompactSeed(new TextEncoder().encode(JSON.stringify(invalid)), 'fixture'),
      ).toThrow(/not a compact seed document/);
    }
  });
});

describe('runSeedPublish', () => {
  let gameDataDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = mkdtempSync(join(tmpdir(), 'aikami-seed-'));
    mkdirSync(gameDataDir, { recursive: true });
    client = new FakeR2Client();
  });

  afterEach(() => {
    rmSync(gameDataDir, { recursive: true, force: true });
  });

  const writeSeed = (rows: ReturnType<typeof row>[]): void => {
    writeFileSync(join(gameDataDir, 'asset_seed.json'), JSON.stringify(seedDoc(rows)));
  };

  const writeOtherSeedFiles = (): void => {
    writeFileSync(
      join(gameDataDir, 'offline_core.json'),
      JSON.stringify({ schemaVersion: 1, tags: [] }),
    );
    writeFileSync(join(gameDataDir, 'asset_credits.json'), JSON.stringify({ credits: {} }));
    writeFileSync(join(gameDataDir, 'lpc_credits.json'), JSON.stringify({ credits: [] }));
    writeFileSync(
      join(gameDataDir, 'lpc_credits_supplement.json'),
      JSON.stringify({ credits: [] }),
    );
    writeFileSync(join(gameDataDir, 'audio_tracks.json'), JSON.stringify({ tracks: [] }));
  };

  const publishedSeed = (): CompactSeedDocument => {
    const key = [...client.objects.keys()].find((candidate) =>
      candidate.endsWith('/asset_seed.json'),
    );
    if (!key) {
      throw new Error('no seed was published');
    }
    return parseCompactSeed(client.objects.get(key)?.body as Uint8Array, 'published seed');
  };

  test('a complete candidate reports failed: 0', async () => {
    writeSeed([row('a', '1'.repeat(64))]);
    writeOtherSeedFiles();

    const report = await runSeedPublish({ client, gameDataDir });

    expect(report.failed).toBe(0);
    expect(report.objects).toHaveLength(6);
  });

  test('the published seed unions the candidate rows with the carried ones', async () => {
    writeSeed([row('local', '1'.repeat(64))]);
    writeOtherSeedFiles();
    const carried = serializeCompactSeed(seedDoc([row('legacy:one', '2'.repeat(64))]));

    const report = await runSeedPublish({
      client,
      gameDataDir,
      carriedDependencies: new Map([['seed/abc/asset_seed.json', carried]]),
    });

    expect(report.failed).toBe(0);
    const tags = publishedSeed().r.map((r) => r.t);
    expect(tags).toEqual(['legacy:one', 'local']);
  });

  test('a missing seed is caught BEFORE publication, not published as a hole', async () => {
    // No local seed and nothing carried: the release would be incomplete.
    writeOtherSeedFiles();

    const report = await runSeedPublish({ client, gameDataDir });

    expect(report.failed).toBeGreaterThan(0);
    expect(client.objects.has('seed/asset_seed.json')).toBe(false);
  });

  test('an unparseable local seed is a failure, not a silent skip', async () => {
    writeFileSync(join(gameDataDir, 'asset_seed.json'), JSON.stringify({ seed: true }));
    writeOtherSeedFiles();

    const report = await runSeedPublish({ client, gameDataDir });

    expect(report.failed).toBeGreaterThan(0);
  });

  test('the same inputs publish the same bytes', async () => {
    writeSeed([row('a', '1'.repeat(64)), row('b', '2'.repeat(64))]);
    writeOtherSeedFiles();

    await runSeedPublish({ client, gameDataDir });
    const first = publishedSeed();
    const firstKey = [...client.objects.keys()].find((k) => k.endsWith('/asset_seed.json'));

    const second = new FakeR2Client();
    await runSeedPublish({ client: second, gameDataDir });
    const secondKey = [...second.objects.keys()].find((k) => k.endsWith('/asset_seed.json'));

    expect(secondKey).toBe(firstKey);
    expect(JSON.stringify(publishedSeed())).toBe(JSON.stringify(first));
  });

  test('a carried seed that cannot be parsed fails rather than dropping rows', async () => {
    writeSeed([row('local', '1'.repeat(64))]);
    writeOtherSeedFiles();

    const report = await runSeedPublish({
      client,
      gameDataDir,
      carriedDependencies: new Map([
        ['seed/abc/asset_seed.json', new TextEncoder().encode('{"seed":true}')],
      ]),
    });

    expect(report.failed).toBeGreaterThan(0);
  });

  test('an invalid carried-only seed is refused before publication', async () => {
    writeOtherSeedFiles();

    const report = await runSeedPublish({
      client,
      gameDataDir,
      carriedDependencies: new Map([
        [
          'seed/abc/asset_seed.json',
          new TextEncoder().encode(JSON.stringify({ sv: 1, g: 'x', o: '', r: [{}] })),
        ],
      ]),
    });

    expect(report.failed).toBeGreaterThan(0);
    expect(report.objects.some((entry) => entry.key.endsWith('/asset_seed.json'))).toBe(false);
  });

  test('the published seed is compact — no pretty-printing', async () => {
    writeSeed([row('a', '1'.repeat(64))]);
    writeOtherSeedFiles();

    await runSeedPublish({ client, gameDataDir });
    const key = [...client.objects.keys()].find((k) => k.endsWith('/asset_seed.json'));
    const body = new TextDecoder().decode(client.objects.get(key as string)?.body);

    expect(body).not.toContain('\n');
    expect(JSON.parse(body).r).toHaveLength(1);
    expect(readFileSync(join(gameDataDir, 'asset_seed.json'), 'utf8')).toContain('"a"');
  });
});
