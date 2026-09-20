// scripts/src/lib/catalog/__tests__/release_publication_failures.test.ts
//
// The failure-injection publication matrix.
//
// A release has to be able to make specific statements about what happened when
// a write fails, and every one of them is a statement about STRUCTURED state:
//
//   • before the pointer moves, the previous release is still authoritative,
//     fully resolvable, and no mutable alias has been touched;
//   • a pointer-write failure may leave immutable objects behind (they are
//     content-addressed and unreferenced) but must NOT activate anything;
//   • a post-pointer alias failure leaves the release ACTIVE and records the
//     degradation — it must not be reported as an activation failure;
//   • a post-pointer verification failure says "activation happened and
//     verification failed", never "nothing was written".
//
// Injecting at the storage boundary (a typed fake R2 client) rather than by
// matching subprocess output is what makes those assertions about state instead
// of about text.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishIndexAndActivate } from '../index_activation.ts';
import { runCatalogPublish } from '../pipeline.ts';
import { buildReceipt, resolveBaseRelease, verifyCandidate } from '../release.ts';
import {
  FakeR2Client as FakeClient,
  type FakeR2Client,
  makeFixtureGameData,
  noPreviousRelease,
} from './fixtures.ts';

const ORIGIN_URL = 'https://assets.example.test';
const RELEASE_POINTER_KEY = 'index/v1/release.json';
const MUTABLE_ALIAS_KEY = 'index/v1/pack_lock.json';

const config = () => ({
  accessKeyId: 'test',
  secretAccessKey: 'test',
  endpoint: 'https://test.r2.cloudflarestorage.com',
  bucket: 'aikami-catalog',
  originUrl: ORIGIN_URL,
});

describe('publication failure matrix — before the pointer moves', () => {
  let gameDataDir: string;
  let contentPacksDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = makeFixtureGameData();
    contentPacksDir = mkdtempSync(join(tmpdir(), 'catalog-failure-packs-'));
    client = new FakeClient();
  });

  afterEach(() => {
    client.failOnKey = undefined;
  });

  const publish = () =>
    runCatalogPublish({
      releaseReader: noPreviousRelease,
      config: config(),
      client,
      gameDataDir,
      contentPacksDir,
    });

  /** Seeds a stand-in for the previously published release pointer. */
  const seedPreviousPointer = async (marker: string): Promise<void> => {
    await client.putObject({
      key: RELEASE_POINTER_KEY,
      body: Buffer.from(JSON.stringify({ schemaVersion: 'catalog.release.v1', releaseId: marker })),
      contentType: 'application/json',
      cacheControl: 'public, max-age=60',
    });
  };

  const pointerBody = (): string =>
    Buffer.from(client.objects.get(RELEASE_POINTER_KEY)?.body ?? new Uint8Array()).toString();

  test('an asset-upload failure leaves the previous pointer untouched and nothing active', async () => {
    await seedPreviousPointer('previous-release');
    client.failOnKey = 'assets/';

    const report = await publish();

    expect(report.ok).toBe(false);
    expect(report.releaseWritten).toBe(false);
    expect(pointerBody()).toContain('previous-release');
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
    // A partial upload is allowed and expected: assets are content-addressed
    // and unreferenced until the pointer names them.
    expect([...client.objects.keys()].some((key) => key.startsWith('assets/'))).toBe(false);
  });

  test('a seed-upload failure blocks activation', async () => {
    await seedPreviousPointer('previous-release');
    client.failOnKey = 'seed/';

    const report = await publish();

    expect(report.ok).toBe(false);
    expect(report.releaseWritten).toBe(false);
    expect(pointerBody()).toContain('previous-release');
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
  });

  test('a catalog-shard failure never advances the pointer, but immutable objects may exist', async () => {
    await seedPreviousPointer('previous-release');
    // A shard key ends in `/<category>.json`; the root ends in `/catalog.json`.
    client.failOnKey = '/maps.json';

    const report = await publish();

    expect(report.ok).toBe(false);
    expect(report.releaseWritten).toBe(false);
    expect(pointerBody()).toContain('previous-release');
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
    // Immutable objects written before the failure are permitted; nothing
    // deletes them, and no reader can reach them without the pointer.
    expect(report.failedKeys.length).toBeGreaterThan(0);
  });

  test('a catalog-root failure never advances the pointer', async () => {
    await seedPreviousPointer('previous-release');
    client.failOnKey = '/catalog.json';

    const report = await publish();

    expect(report.ok).toBe(false);
    expect(report.releaseWritten).toBe(false);
    expect(pointerBody()).toContain('previous-release');
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
  });

  test('a release-pointer write failure leaves the previous pointer authoritative', async () => {
    await seedPreviousPointer('previous-release');
    client.failOnKey = RELEASE_POINTER_KEY;

    const report = await publish();

    expect(report.ok).toBe(false);
    expect(report.releaseWritten).toBe(false);
    expect(pointerBody()).toContain('previous-release');
    // The mutable alias must not move: it is advanced only after the pointer.
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
  });
});

describe('publication failure matrix — after the pointer moves', () => {
  let gameDataDir: string;
  let contentPacksDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = makeFixtureGameData();
    contentPacksDir = mkdtempSync(join(tmpdir(), 'catalog-failure-packs-'));
    client = new FakeClient();
  });

  afterEach(() => {
    client.failOnKey = undefined;
  });

  const publish = () =>
    runCatalogPublish({
      releaseReader: noPreviousRelease,
      config: config(),
      client,
      gameDataDir,
      contentPacksDir,
    });

  /**
   * Drives the activation phase directly.
   *
   * The alias only moves when the publisher produced a pack lock, which needs a
   * conforming pack manifest with image pins. Injecting at the activation
   * boundary keeps this about the alias contract instead of about pack fixtures.
   */
  const activate = (options: { packLockBody: Buffer | undefined; failOnKey?: string }) => {
    client.failOnKey = options.failOnKey;
    return publishIndexAndActivate({
      client,
      root: {
        schemaVersion: 1,
        publishedAt: '2026-09-20T00:00:00.000Z',
        originUrl: ORIGIN_URL,
        totalCount: 1,
        categories: [{ id: 'maps', count: 1 }],
      } as never,
      shards: [
        { id: 'maps', category: 'maps', key: 'index/v1/maps.json', json: '{"a":1}', gzipBytes: 7 },
      ] as never,
      releaseId: '2026-09-20T00:00:00.000Z',
      seedReport: { uploaded: 0, carried: 0, failed: 0, objects: [] },
      packLockReport: {
        written: true,
        key: 'index/v1/revisions/aaaa/pack_lock.json',
        hash: 'a'.repeat(64),
        assetPins: 1,
        audioPins: 0,
      },
      packLockBody: options.packLockBody,
    });
  };

  test('a post-activation alias failure keeps the release ACTIVE and records the degradation', async () => {
    const activation = await activate({
      packLockBody: Buffer.from('{"lock":true}'),
      failOnKey: MUTABLE_ALIAS_KEY,
    });

    // The immutable release is complete and active: the pointer moved.
    expect(activation.releaseWritten).toBe(true);
    expect(client.objects.has(RELEASE_POINTER_KEY)).toBe(true);
    // The alias is a separate, degraded concern — never an activation failure.
    expect(activation.legacyAlias.written).toBe(false);
    expect(activation.legacyAlias.error).toBeDefined();
    expect(activation.packLock.legacyAliasWritten).toBe(false);
  });

  test('a successful activation advances the alias only after the pointer', async () => {
    const activation = await activate({ packLockBody: Buffer.from('{"lock":true}') });

    expect(activation.releaseWritten).toBe(true);
    expect(activation.legacyAlias.written).toBe(true);
    const pointerIndex = client.putKeys.indexOf(RELEASE_POINTER_KEY);
    const aliasIndex = client.putKeys.indexOf(MUTABLE_ALIAS_KEY);
    expect(pointerIndex).toBeGreaterThanOrEqual(0);
    expect(aliasIndex).toBeGreaterThan(pointerIndex);
  });

  test('no pack lock body means no alias write, and the release still activates', async () => {
    const activation = await activate({ packLockBody: undefined });

    expect(activation.releaseWritten).toBe(true);
    expect(activation.legacyAlias.written).toBe(false);
    expect(client.objects.has(MUTABLE_ALIAS_KEY)).toBe(false);
  });

  test('a first publish with no previous pointer activates against nothing', async () => {
    const report = await publish();

    expect(report.ok).toBe(true);
    expect(report.releaseWritten).toBe(true);
    expect(client.objects.has(RELEASE_POINTER_KEY)).toBe(true);
    expect(report.releaseId).toBeDefined();
  });

  test('a pointer write that succeeds but whose release id is absent cannot fabricate one', async () => {
    // The publisher always supplies its own id; the receipt must use THAT id,
    // not a timestamp invented at receipt-building time.
    const report = await publish();
    const receipt = buildReceipt({
      candidate: {} as never,
      plan: {
        planHash: 'p',
        target: { mode: 'staging', bucket: 'b', originUrl: ORIGIN_URL },
      } as never,
      report,
      previousReleaseId: '',
      phases: [],
      startedAt: '2026-09-20T00:00:00.000Z',
      verified: true,
      verificationError: '',
    });
    expect(receipt.releaseId).toBe(report.releaseId ?? '');
    expect(receipt.releaseId.length).toBeGreaterThan(0);
  });
});

describe('publication failure matrix — typed phase failures', () => {
  test('a candidate whose content no longer re-derives is refused', () => {
    const sealed = {
      schemaVersion: 'candidate.lock.v2',
      lockHash: 'deadbeef',
      source: { commit: 'c', tree: 't' },
    } as never;
    const result = verifyCandidate({ sealed, rebuild: () => sealed });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('unreachable');
    }
    expect(result.error).toContain('modified');
  });

  test('an unverifiable base release refuses instead of being treated as absent', async () => {
    const result = await resolveBaseRelease({
      originUrl: ORIGIN_URL,
      reader: async () => {
        throw new Error('pointer is corrupt');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('unreachable');
    }
    expect(result.phase).toBe('resolveBaseRelease');
    expect(result.error).toContain('could not be verified');
  });

  test('a first publish resolves an explicitly absent base release', async () => {
    const result = await resolveBaseRelease({
      originUrl: ORIGIN_URL,
      reader: noPreviousRelease,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('unreachable');
    }
    expect(result.value.base).toBeNull();
    expect(result.value.carriedEntries).toEqual([]);
  });
});
