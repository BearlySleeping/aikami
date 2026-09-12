// scripts/src/lib/catalog/__tests__/workspace.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { assetKey } from '../content_address.ts';
import {
  pullWorkspace,
  readWorkspaceSnapshot,
  selectWorkspaceEntries,
  snapshotWorkspace,
  syncWorkspace,
  workspaceStatus,
} from '../workspace.ts';
import {
  atomicWrite,
  checkRelativePath,
  digestBytes,
  entryWorkingPath,
  jsonBytes,
  withWorkspaceLock,
  workspacePath,
} from '../workspace_files.ts';
import { inspectWorkspaceImage, optimizeWorkspaceImage } from '../workspace_image.ts';
import {
  fetchWorkspaceSnapshot,
  mergeWorkspaceEntries,
  type WorkspaceEntry,
  type WorkspaceRemote,
  type WorkspaceSnapshot,
} from '../workspace_remote.ts';

const original = new TextEncoder().encode('old artwork');
const replacement = new TextEncoder().encode('new artwork');
const entry = (options?: Partial<WorkspaceEntry>): WorkspaceEntry => ({
  tag: 'sprites:tilesets:atlas.webp',
  hash: digestBytes(original),
  sizeBytes: original.length,
  ext: '.webp',
  category: 'tilesets',
  ...options,
});
const snapshot = (entries = [entry()]): WorkspaceSnapshot => ({
  version: 1,
  mode: 'production',
  bucket: 'test-catalog',
  originUrl: 'https://assets.example.test',
  consistency: 'legacy-observed',
  documents: [],
  entries,
  warnings: [],
});
const fakeRemote = () => {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const reads: string[] = [];
  const remote: WorkspaceRemote = {
    readObject: async (key) => {
      reads.push(key);
      return files.get(key);
    },
    putObject: async ({ key, body }) => {
      writes.push(key);
      files.set(key, body.slice());
    },
  };
  return { files, writes, reads, remote };
};

const metadataFixture = () => {
  const fixture = fakeRemote();
  const item = entry();
  const root = {
    schemaVersion: 1,
    originUrl: 'https://assets.example.test',
    publishedAt: '2026-09-11',
    totalCount: 1,
    categories: [{ id: 'tilesets', count: 1 }],
  };
  const shard = {
    ...root,
    id: 'tilesets',
    category: 'tilesets',
    entries: [
      { ...item, licenses: ['CC0'], authors: ['Artist'], sourceUrls: ['https://example.test'] },
    ],
  };
  const { categories: _categories, totalCount: _totalCount, ...validShard } = shard;
  fixture.files.set('index/v1/catalog.json', jsonBytes(root));
  fixture.files.set('index/v1/tilesets.json', jsonBytes(validShard));
  fixture.files.set(
    'seed/asset_seed.json',
    jsonBytes({
      sv: 1,
      r: [
        { t: item.tag, h: item.hash, s: item.sizeBytes, c: item.category, e: item.ext },
        { t: 'lpc:body:walk', h: item.hash, s: item.sizeBytes, c: 'lpc', e: '.webp' },
      ],
    }),
  );
  for (const name of [
    'offline_core',
    'asset_credits',
    'lpc_credits',
    'lpc_credits_supplement',
    'audio_tracks',
  ]) {
    fixture.files.set(`seed/${name}.json`, jsonBytes({}));
  }
  return fixture;
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'catalog-workspace-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const putWorking = async (bytes: Uint8Array) =>
  atomicWrite({ root, path: 'working/game-data/sprites/tilesets/atlas.webp', bytes });
const checkout = async () => {
  const fixture = fakeRemote();
  fixture.files.set(assetKey(entry()), original);
  await pullWorkspace({ root, remote: fixture.remote, entries: [entry()] });
  return fixture;
};

describe('safe paths and selection', () => {
  test.each([
    '../escape',
    '/absolute',
    'a/../../b',
    'a\\b',
    'a//b',
    'a/./b',
    'C:/secret',
    'a\u0000b',
  ])('rejects %j', (path) => {
    expect(() => checkRelativePath(path)).toThrow('Unsafe');
  });
  test('uses runtime path convention and separates tracked packs', () => {
    expect(entryWorkingPath(entry())).toBe('game-data/sprites/tilesets/atlas.webp');
    expect(
      entryWorkingPath(
        entry({ tag: 'emberwatch:maps:village', ext: '.json', category: 'contentPacks' }),
      ),
    ).toBe('content-packs/emberwatch/maps/village.json');
  });
  test('coalesces identical atlas aliases but refuses conflicting or case-colliding paths', () => {
    expect(
      mergeWorkspaceEntries([
        entry(),
        entry({ tag: 'sprites:tilesets:atlas', category: 'sprites' }),
      ]),
    ).toHaveLength(2);
    expect(() =>
      mergeWorkspaceEntries([entry(), entry({ hash: digestBytes(replacement) })]),
    ).toThrow('conflict');
    expect(() =>
      mergeWorkspaceEntries([entry(), entry({ tag: 'sprites:tilesets:Atlas.webp' })]),
    ).toThrow('collision');
    expect(() => mergeWorkspaceEntries([entry({ tag: 'sprites:..:escape' })])).toThrow('Unsafe');
  });
  test('selectors are explicit, namespace-boundary aware, and reject typos', () => {
    const entries = [
      entry({ tag: 'emberwatch:manifest' }),
      entry({ tag: 'emberwatcher:manifest' }),
    ];
    expect(
      selectWorkspaceEntries({ entries, tags: ['emberwatch'], categories: [], all: false }),
    ).toHaveLength(1);
    expect(() => selectWorkspaceEntries({ entries, tags: [], categories: [], all: false })).toThrow(
      'Select',
    );
    expect(() =>
      selectWorkspaceEntries({ entries, tags: ['typo'], categories: [], all: false }),
    ).toThrow('Unknown');
  });
  test('rejects symlink escape and overlapping writers', async () => {
    await symlink(tmpdir(), join(root, 'working'));
    await expect(workspacePath({ root, path: 'working/escape' })).rejects.toThrow('symlink');
    await withWorkspaceLock({
      root,
      run: async () => {
        await expect(withWorkspaceLock({ root, run: async () => undefined })).rejects.toThrow(
          'locked',
        );
      },
    });
    await expect(withWorkspaceLock({ root, run: async () => 'released' })).resolves.toBe(
      'released',
    );
  });
});

describe('remote inventory snapshots', () => {
  test('merges full seed coverage, retains credits, labels legacy consistency, performs no writes', async () => {
    const fixture = metadataFixture();
    const result = await fetchWorkspaceSnapshot({ remote: fixture.remote, ...snapshot() });
    expect(result.snapshot.entries).toHaveLength(2);
    expect(result.snapshot.warnings.join(' ')).toContain('union has 2');
    expect(result.documents.has('seed/asset_credits.json')).toBe(true);
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.reads.filter((key) => key === 'seed/asset_seed.json')).toHaveLength(2);
  });
  test('malformed release pointer never falls back to legacy', async () => {
    const fixture = metadataFixture();
    fixture.files.set('index/v1/release.json', jsonBytes({ invalid: true }));
    await expect(fetchWorkspaceSnapshot({ remote: fixture.remote, ...snapshot() })).rejects.toThrow(
      'Malformed',
    );
  });
  test('changed mutable metadata aborts without replacing local snapshot', async () => {
    const fixture = metadataFixture();
    await snapshotWorkspace({ root, remote: fixture.remote, ...snapshot() });
    const before = await readFile(join(root, 'current.json'), 'utf8');
    const read = fixture.remote.readObject;
    let reads = 0;
    fixture.remote.readObject = async (key) => {
      const bytes = await read(key);
      if (key === 'seed/asset_seed.json' && ++reads === 2) {
        return jsonBytes({ changed: true });
      }
      return bytes;
    };
    await expect(
      snapshotWorkspace({ root, remote: fixture.remote, ...snapshot() }),
    ).rejects.toThrow('changed');
    expect(await readFile(join(root, 'current.json'), 'utf8')).toBe(before);
  });
  test('snapshot target cannot silently change', async () => {
    const fixture = metadataFixture();
    await snapshotWorkspace({ root, remote: fixture.remote, ...snapshot() });
    await expect(
      snapshotWorkspace({ root, remote: fixture.remote, ...snapshot(), bucket: 'other' }),
    ).rejects.toThrow('target mismatch');
    expect((await readWorkspaceSnapshot(root)).entries).toHaveLength(2);
  });
  test('immutable release selects pinned documents and rejects hash mismatch', async () => {
    const fixture = metadataFixture();
    const pin = (key: string) => {
      const bytes = fixture.files.get(key);
      if (!bytes) {
        throw new Error(`missing fixture ${key}`);
      }
      const hash = digestBytes(bytes);
      const pinned = `revisions/${hash}/${key}`;
      fixture.files.set(pinned, bytes);
      return { key: pinned, hash };
    };
    const rootRef = pin('index/v1/catalog.json');
    const shard = pin('index/v1/tilesets.json');
    const seed = pin('seed/asset_seed.json');
    fixture.files.set(
      'index/v1/release.json',
      jsonBytes({
        schemaVersion: 'catalog.release.v1',
        releaseId: 'test',
        publishedAt: 'now',
        rootKey: rootRef.key,
        rootHash: rootRef.hash,
        shards: [{ category: 'tilesets', ...shard }],
        dependencies: [seed],
      }),
    );
    const result = await fetchWorkspaceSnapshot({ remote: fixture.remote, ...snapshot() });
    expect(result.snapshot.consistency).toBe('release');
    expect(fixture.reads).not.toContain('index/v1/catalog.json');
    fixture.files.set(seed.key, jsonBytes({ corrupted: true }));
    await expect(fetchWorkspaceSnapshot({ remote: fixture.remote, ...snapshot() })).rejects.toThrow(
      'integrity',
    );
  });
});

describe('download, edit, and unpublished sync', () => {
  test('pull is resumable, coalesces aliases, and working copies are independent', async () => {
    const fixture = await checkout();
    await pullWorkspace({
      root,
      remote: fixture.remote,
      entries: [entry(), entry({ tag: 'sprites:tilesets:atlas', category: 'sprites' })],
    });
    expect(fixture.reads).toHaveLength(1);
    await putWorking(replacement);
    expect(digestBytes(await readFile(join(root, 'objects', assetKey(entry()))))).toBe(
      entry().hash,
    );
    expect((await workspaceStatus({ root, snapshot: snapshot() }))[0]?.state).toBe('modified');
    expect(
      (await pullWorkspace({ root, remote: fixture.remote, entries: [entry()] })).conflicts,
    ).toHaveLength(1);
    expect(
      digestBytes(await readFile(join(root, 'working/game-data/sprites/tilesets/atlas.webp'))),
    ).toBe(digestBytes(replacement));
  });
  test('corrupt cache is repaired; corrupt remote is never accepted', async () => {
    const fixture = await checkout();
    await writeFile(join(root, 'objects', assetKey(entry())), 'corrupt');
    expect(
      (await pullWorkspace({ root, remote: fixture.remote, entries: [entry()] })).downloaded,
    ).toBe(1);
    const badEntry = entry({
      tag: 'sprites:new',
      hash: digestBytes(replacement),
      sizeBytes: replacement.length,
    });
    fixture.files.set(assetKey(badEntry), original);
    await expect(
      pullWorkspace({ root, remote: fixture.remote, entries: [badEntry] }),
    ).rejects.toThrow('integrity');
    expect(await Bun.file(join(root, 'objects', assetKey(badEntry))).exists()).toBe(false);
  });
  test('clean remote update fast-forwards; two-sided edits are conflicts', async () => {
    const fixture = await checkout();
    const next = entry({ hash: digestBytes(replacement), sizeBytes: replacement.length });
    fixture.files.set(assetKey(next), replacement);
    expect((await workspaceStatus({ root, snapshot: snapshot([next]) }))[0]?.state).toBe(
      'remote-changed',
    );
    await putWorking(new TextEncoder().encode('local edit'));
    expect((await workspaceStatus({ root, snapshot: snapshot([next]) }))[0]?.state).toBe(
      'conflict',
    );
    await putWorking(original);
    expect((await pullWorkspace({ root, remote: fixture.remote, entries: [next] })).updated).toBe(
      1,
    );
    expect((await workspaceStatus({ root, snapshot: snapshot([next]) }))[0]?.state).toBe('clean');
  });
  test('dry run is offline and never uploads; missing files never become deletions', async () => {
    const fixture = await checkout();
    await putWorking(replacement);
    const result = await syncWorkspace({ root, snapshot: snapshot(), apply: false });
    expect(result.changes[0]?.state).toBe('modified');
    expect(fixture.writes).toHaveLength(0);
    await rm(join(root, 'working/game-data/sprites/tilesets/atlas.webp'));
    const missing = await syncWorkspace({ root, snapshot: snapshot(), apply: false });
    const plan = await Bun.file(join(root, missing.planPath)).json();
    expect(plan.items).toHaveLength(0);
    expect(plan.deletions).toEqual([]);
    expect(plan.missingLocal).toHaveLength(1);
  });
  test('apply requires the exact bucket and writes only immutable assets', async () => {
    const fixture = await checkout();
    await putWorking(replacement);
    await expect(
      syncWorkspace({
        root,
        snapshot: snapshot(),
        remote: fixture.remote,
        apply: true,
        confirmBucket: 'wrong',
      }),
    ).rejects.toThrow('matching');
    expect(fixture.writes).toHaveLength(0);
    const result = await syncWorkspace({
      root,
      snapshot: snapshot(),
      remote: fixture.remote,
      apply: true,
      confirmBucket: 'test-catalog',
    });
    expect(result.uploaded).toBe(1);
    expect(fixture.writes.every((key) => key.startsWith('assets/'))).toBe(true);
    expect((await workspaceStatus({ root, snapshot: snapshot() }))[0]?.state).toBe('modified');
    const retry = await syncWorkspace({
      root,
      snapshot: snapshot(),
      remote: fixture.remote,
      apply: true,
      confirmBucket: 'test-catalog',
    });
    expect(retry.skipped).toBe(1);
    expect(fixture.writes).toHaveLength(1);
  });
  test('apply blocks conflicts and corrupt existing content addresses', async () => {
    const fixture = await checkout();
    await putWorking(replacement);
    await expect(
      syncWorkspace({
        root,
        snapshot: snapshot([entry({ hash: 'a'.repeat(64) })]),
        remote: fixture.remote,
        apply: true,
        confirmBucket: 'test-catalog',
      }),
    ).rejects.toThrow('conflicts');
    fixture.files.set(assetKey({ hash: digestBytes(replacement), ext: '.webp' }), original);
    await expect(
      syncWorkspace({
        root,
        snapshot: snapshot(),
        remote: fixture.remote,
        apply: true,
        confirmBucket: 'test-catalog',
      }),
    ).rejects.toThrow('content-address');
    expect(fixture.writes).toHaveLength(0);
  });
  test('new files are staged but unsupported files and symlinks fail closed', async () => {
    const fixture = await checkout();
    await atomicWrite({ root, path: 'working/game-data/props/new.webp', bytes: replacement });
    expect(
      (await workspaceStatus({ root, snapshot: snapshot() })).find((change) =>
        change.path.endsWith('new.webp'),
      )?.state,
    ).toBe('new');
    await atomicWrite({ root, path: 'working/game-data/secret.env', bytes: replacement });
    await expect(syncWorkspace({ root, snapshot: snapshot(), apply: false })).rejects.toThrow(
      'format',
    );
    await rm(join(root, 'working/game-data/secret.env'));
    await symlink(join(root, 'current.json'), join(root, 'working/leak.json'));
    await expect(
      syncWorkspace({ root, snapshot: snapshot(), remote: fixture.remote, apply: false }),
    ).rejects.toThrow('symlink');
  });
});

describe('lossless image preparation', () => {
  test('inspection records alpha coverage and produces an offline preview', async () => {
    const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 20, 40, 80, 128, 0, 0, 0, 0]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
      .png()
      .toBuffer();
    await atomicWrite({ root, path: 'working/game-data/props/test.png', bytes });
    const result = await inspectWorkspaceImage({ root, input: 'game-data/props/test.png' });
    expect(result.transparentPixels).toBe(2);
    expect(result.partialAlphaPixels).toBe(1);
    expect(await Bun.file(join(root, result.preview)).exists()).toBe(true);
    expect(digestBytes(await readFile(join(root, 'working/game-data/props/test.png')))).toBe(
      digestBytes(bytes),
    );
  });
  test('opaque props fail; opaque terrain is allowed', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    await atomicWrite({ root, path: 'imports/input.png', bytes });
    const options = { root, input: 'input.png', output: 'game-data/props/test.webp' };
    await expect(optimizeWorkspaceImage({ ...options, kind: 'prop' })).rejects.toThrow('opaque');
    expect((await optimizeWorkspaceImage({ ...options, kind: 'terrain' })).hasTransparency).toBe(
      false,
    );
  });
  test('real alpha and dimensions survive optimization; different output is not overwritten', async () => {
    const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 20, 40, 80, 128, 0, 0, 0, 0]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
      .png()
      .toBuffer();
    await atomicWrite({ root, path: 'imports/input.png', bytes });
    const options = {
      root,
      input: 'input.png',
      output: 'game-data/props/test.webp',
      kind: 'prop' as const,
    };
    const result = await optimizeWorkspaceImage(options);
    expect(result.hasTransparency).toBe(true);
    expect(result.width).toBe(2);
    await atomicWrite({ root, path: 'working/game-data/props/test.webp', bytes: original });
    await expect(optimizeWorkspaceImage(options)).rejects.toThrow('already exists');
  });
});
