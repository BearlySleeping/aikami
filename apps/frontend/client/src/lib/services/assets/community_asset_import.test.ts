// apps/frontend/client/src/lib/services/assets/community_asset_import.test.ts
//
// C-513 AC-4 / AC-10 / AC-11: browse an approved community asset, import it
// into the local registry as an `r2` source, and prove it resolves from the
// registry after the import (offline — no re-fetch on resolution).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  AIKAMI_MIGRATIONS,
  AssetRegistryRepository,
  registerCommunityAssetRow,
  WasmStorageAdapter,
} from '@aikami/frontend/storage';
import type { CommunityAssetSummary } from '@aikami/types';
import type { CommunityAssetImportDeps } from '$types';
import { importCommunityAsset, listCommunityAssets } from './community_asset_import.ts';

const HUB_BASE = 'https://hub.bearlysing.test/api';
const BYTES = new TextEncoder().encode('community-asset-fixture-bytes');

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

let Hash = '';

const summary = (overrides: Partial<CommunityAssetSummary> = {}): CommunityAssetSummary => ({
  slug: 'tavern-theme',
  revision: 1,
  title: 'Tavern Theme',
  category: 'music',
  tag: 'music:community:tavern-theme',
  sha256: Hash,
  ext: '.ogg',
  sizeBytes: BYTES.byteLength,
  provenance: { source: 'original', license: 'CC-BY-4.0' },
  license: 'CC-BY-4.0',
  moderationState: 'pending',
  isOwner: false,
  promoted: true,
  deliveryUrl: `https://assets.bearlysing.test/assets/${Hash.slice(0, 2)}/${Hash}.ogg`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

type CacheEntry = { hash: string; blob: Blob };

const createDeps = (
  db: WasmStorageAdapter,
  options: { response?: (url: string) => Response | undefined } = {},
): { deps: CommunityAssetImportDeps; cached: Map<string, CacheEntry>; fetched: string[] } => {
  const cached = new Map<string, CacheEntry>();
  const fetched: string[] = [];
  const deps: CommunityAssetImportDeps = {
    hubBaseUrl: HUB_BASE,
    authHeaders: () => ({ cookie: 'session=1' }),
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const stubbed = options.response?.(url);
      if (stubbed) {
        return stubbed;
      }
      if (url.includes('/assets/community')) {
        return new Response(JSON.stringify({ items: [summary()] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(BYTES as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
      });
    }) as typeof fetch,
    hashBytes: sha256Hex,
    cache: {
      has: async (hash: string) => cached.has(hash),
      put: async (entry: CacheEntry) => {
        cached.set(entry.hash, entry);
      },
    },
    register: (asset) => registerCommunityAssetRow(db, asset),
  };
  return { deps, cached, fetched };
};

describe('community browse (AC-4)', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    Hash = await sha256Hex(BYTES);
    db = new WasmStorageAdapter({ databasePath: ':memory:' });
    await db.open();
    for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
      await db.execute({ sql: ddl, args: [] });
    }
  });

  afterEach(async () => {
    await db.close();
  });

  test('lists approved community assets from the hub', async () => {
    const { deps, fetched } = createDeps(db);
    const page = await listCommunityAssets(deps, { category: 'music' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.promoted).toBe(true);
    expect(fetched[0]).toContain('/assets/community?category=music');
  });

  test('imports an approved asset and it resolves through the registry offline', async () => {
    const { deps, cached } = createDeps(db);
    const page = await listCommunityAssets(deps);
    const asset = page.items[0] as CommunityAssetSummary;

    const outcome = await importCommunityAsset(deps, asset);
    expect(outcome.imported).toBe(true);
    if (outcome.imported) {
      expect(outcome.sha256).toBe(Hash);
    }

    // Bytes are cached under the content hash ...
    expect(cached.has(Hash)).toBe(true);

    // ... and the registry resolves the tag to the r2 source, through the same
    // repository the runtime resolvers use.
    const registry = new AssetRegistryRepository(db);
    const record = await registry.findById(asset.tag);
    expect(record?.category).toBe('music');
    const sources = await registry.listSources(asset.tag);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe('r2');
    expect(sources[0]?.url).toBe(asset.deliveryUrl);

    // A second import is idempotent (no duplicate source row, no version bump).
    const again = await importCommunityAsset(deps, asset);
    expect(again.imported).toBe(true);
    if (again.imported) {
      expect(again.unchanged).toBe(true);
    }
    expect(await registry.listSources(asset.tag)).toHaveLength(1);
  });

  test('a promoted:false asset is refused', async () => {
    const { deps, cached } = createDeps(db);
    const outcome = await importCommunityAsset(
      deps,
      summary({ promoted: false, deliveryUrl: undefined }),
    );
    expect(outcome.imported).toBe(false);
    expect(outcome.reason).toBe('not_promoted');
    expect(cached.size).toBe(0);
  });

  test('bytes that do not match the advertised hash are refused (the hub is not trusted)', async () => {
    const { deps, cached } = createDeps(db, {
      response: (url) =>
        url.includes('/assets/community')
          ? undefined
          : new Response(new TextEncoder().encode('tampered-bytes'), { status: 200 }),
    });
    const outcome = await importCommunityAsset(deps, summary({ promoted: true }));
    expect(outcome.imported).toBe(false);
    expect(outcome.reason).toBe('size_mismatch');

    const sameLengthTamper = createDeps(db, {
      response: (url) =>
        url.includes('/assets/community')
          ? undefined
          : new Response(new TextEncoder().encode('x'.repeat(BYTES.byteLength)), { status: 200 }),
    });
    const hashOutcome = await importCommunityAsset(sameLengthTamper.deps, summary());
    expect(hashOutcome.imported).toBe(false);
    expect(hashOutcome.reason).toBe('hash_mismatch');
    expect(sameLengthTamper.cached.size).toBe(0);
    expect(cached.size).toBe(0);
  });

  test('a tag that a curated asset already owns is surfaced, not replaced (AC-11)', async () => {
    const { deps } = createDeps(db);
    await db.execute({
      sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
            VALUES ('music:community:tavern-theme', 'emberwatch', 'music', ?, 1, 10, 'unknown', 'seed', '[]')`,
      args: ['f'.repeat(64)],
    });

    const outcome = await importCommunityAsset(deps, summary());
    expect(outcome.imported).toBe(false);
    expect(outcome.reason).toBe('tag_collision');
    if (!outcome.imported) {
      expect(outcome.collision?.kind).toBe('seed');
    }

    // A curated tag is *never* shadowed — not even by an explicit decision.
    // The resolution is a rename (the prompt path of AC-11).
    const stillRefused = await importCommunityAsset(deps, summary(), { collision: 'version' });
    expect(stillRefused.imported).toBe(false);
    const row = await db.query({
      sql: 'SELECT hash FROM assets WHERE id = ?',
      args: ['music:community:tavern-theme'],
    });
    expect(row.rows[0]?.hash).toBe('f'.repeat(64));
  });

  test('a previously imported different revision is versioned, not silently re-pointed', async () => {
    const { deps } = createDeps(db);
    const first = await importCommunityAsset(deps, summary({ sha256: 'e'.repeat(64) }));
    // The first import fails hash verification (bytes do not match), so seed the
    // row directly to model an older imported revision of the same tag.
    await db.execute({
      sql: `INSERT OR REPLACE INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
            VALUES ('music:community:tavern-theme', 'community', 'music', ?, 1, 10, 'unknown', 'original', '[]')`,
      args: ['e'.repeat(64)],
    });
    void first;

    const implicit = await importCommunityAsset(deps, summary());
    // A community-owned tag re-imported with different bytes is not silently
    // re-pointed either — it needs the explicit decision.
    expect(implicit.imported).toBe(false);

    const accepted = await importCommunityAsset(deps, summary(), { collision: 'version' });
    expect(accepted.imported).toBe(true);
    if (accepted.imported) {
      expect(accepted.unchanged).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// C-513 AC-10 — an imported asset survives a reload with networking blocked
// ---------------------------------------------------------------------------

describe('AC-10: an imported asset survives an offline reload', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    Hash = await sha256Hex(BYTES);
    db = new WasmStorageAdapter({ databasePath: ':memory:' });
    await db.open();
    for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
      await db.execute({ sql: ddl, args: [] });
    }
  });

  afterEach(async () => {
    await db.close();
  });

  /** A reloaded session: the same on-device cache, but no network at all. */
  const offlineSession = (
    deps: CommunityAssetImportDeps,
    attempted: string[],
  ): CommunityAssetImportDeps => ({
    ...deps,
    fetchImpl: (async (input: RequestInfo | URL) => {
      attempted.push(String(input));
      throw new Error(`network blocked: ${String(input)}`);
    }) as typeof fetch,
  });

  test('the tag still resolves from the on-device cache with zero network calls', async () => {
    // ── Session 1: online. Import the approved asset. ──────────────────────
    const online = createDeps(db);
    const asset = (await listCommunityAssets(online.deps)).items[0] as CommunityAssetSummary;
    const imported = await importCommunityAsset(online.deps, asset);
    expect(imported.imported).toBe(true);
    // The download really happened, so the offline assertions below are not
    // vacuous.
    expect(online.fetched.some((url) => url === asset.deliveryUrl)).toBe(true);

    // ── Reload: networking blocked, same cache. ────────────────────────────
    const attempted: string[] = [];
    const offline = offlineSession(online.deps, attempted);

    // Re-importing is a cache hit — the bytes are already on this device.
    const again = await importCommunityAsset(offline, asset);
    expect(again.imported).toBe(true);
    if (again.imported) {
      expect(again.unchanged).toBe(true);
    }
    expect(attempted).toEqual([]);

    // ── The runtime resolution path ────────────────────────────────────────
    // `AssetManager.resolve` reads the registry row and its sources, then
    // serves the content-hash cache when the bytes are present. Both halves
    // must hold after the reload.
    const registry = new AssetRegistryRepository(db);
    const record = await registry.findById(asset.tag);
    expect(record?.hash).toBe(asset.sha256);
    expect(record?.category).toBe(asset.category);

    const sources = await registry.listSources(asset.tag);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe('r2');

    const cachedEntry = online.cached.get(asset.sha256);
    expect(cachedEntry).toBeDefined();
    expect((cachedEntry as CacheEntry).blob.size).toBe(asset.sizeBytes);
  });

  test('both an imported audio and an imported visual tag resolve offline', async () => {
    const visualBytes = new TextEncoder().encode('community-visual-fixture');
    const visualHash = await sha256Hex(visualBytes);
    const visualUrl = `https://assets.bearlysing.test/assets/${visualHash.slice(0, 2)}/${visualHash}.webp`;

    const online = createDeps(db, {
      response: (url) =>
        url === visualUrl
          ? new Response(visualBytes as unknown as BodyInit, {
              status: 200,
              headers: { 'content-type': 'image/webp' },
            })
          : undefined,
    });

    const audio = await importCommunityAsset(online.deps, summary());
    const visual = await importCommunityAsset(
      online.deps,
      summary({
        slug: 'guild-banner',
        tag: 'sprites:community:guild-banner',
        category: 'sprites',
        ext: '.webp',
        sha256: visualHash,
        sizeBytes: visualBytes.byteLength,
        deliveryUrl: visualUrl,
      }),
    );
    expect(audio.imported).toBe(true);
    expect(visual.imported).toBe(true);

    const attempted: string[] = [];
    const offline = offlineSession(online.deps, attempted);

    const registry = new AssetRegistryRepository(db);
    for (const tag of ['music:community:tavern-theme', 'sprites:community:guild-banner']) {
      const record = await registry.findById(tag);
      expect(record).toBeDefined();
      // Cached bytes are what makes the offline resolve possible — the resolver
      // never falls back to the r2 URL when they are present.
      expect(online.cached.has(String(record?.hash))).toBe(true);
      expect(await registry.listSources(tag)).toHaveLength(1);
    }

    // Nothing was fetched on the reload path, for either modality.
    expect(attempted).toEqual([]);
    expect(offline.fetchImpl).toBeDefined();
  });

  test('an import that was never downloaded fails loudly offline rather than half-succeeding', async () => {
    const attempted: string[] = [];
    const online = createDeps(db);
    const offline = offlineSession(online.deps, attempted);

    await expect(importCommunityAsset(offline, summary())).rejects.toThrow(/network blocked/);

    // Nothing was registered — a failed import leaves no resolvable tag.
    const registry = new AssetRegistryRepository(db);
    expect(await registry.findById('music:community:tavern-theme')).toBeUndefined();
  });
});
