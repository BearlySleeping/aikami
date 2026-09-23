// scripts/src/lib/ops/emberwatch_candidate_plane.test.ts
//
// C-529: the local rehearsal origin must serve the COMPLETE candidate release
// plane. The first human visual gate booted an origin that overlaid the pack
// manifest, maps, audio and prop atlas — but NOT portraits — so every NPC
// dialogue rendered the legacy gandalf/orc/aragon stand-in while the candidate's
// own busts sat unserved.
//
// These tests are the regression guard: a manifest-declared portrait (or enemy
// visual) with no local override fails the suite.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectEmberwatchCandidateOverrides,
  collectRequiredEmberwatchCandidateTags,
  findPublishedSeedPath,
  missingCandidateOverrides,
  readPublishedSeedHashes,
} from './emberwatch_candidate_plane.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const tilesetRoot = join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets');

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** The ten canonical Emberwatch NPC ids — never guessed names. */
const CANONICAL_NPC_IDS = [
  'village_elder',
  'rollo_grasper',
  'merchant',
  'village_guard',
  'innkeeper_sella',
  'smith_orra',
  'cartographer_ivo',
  'shrine_keeper_nemi',
  'apprentice_tess',
  'woodcutter_ada',
] as const;

describe('emberwatch candidate plane', () => {
  test('every required candidate tag is served by a local override', () => {
    expect(missingCandidateOverrides(repository)).toEqual([]);
  });

  test('every override points at a file that exists', () => {
    const overrides = collectEmberwatchCandidateOverrides(repository);
    expect(overrides.length).toBeGreaterThan(0);
    const missingFiles = overrides.filter((override) => !existsSync(override.file));
    expect(missingFiles).toEqual([]);
  });

  test('an override whose file is missing does not count as served', () => {
    const isolatedRepository = mkdtempSync(join(tmpdir(), 'aikami-candidate-plane-'));
    try {
      const packRoot = join(isolatedRepository, 'content/packs/emberwatch');
      mkdirSync(packRoot, { recursive: true });
      writeFileSync(join(packRoot, 'manifest.json'), JSON.stringify({ maps: {}, npcs: {} }));

      expect(missingCandidateOverrides(isolatedRepository)).toEqual([
        'sprites:tilesets:props.json',
        'sprites:tilesets:props.webp',
      ]);
    } finally {
      rmSync(isolatedRepository, { recursive: true, force: true });
    }
  });

  test('all ten canonical NPCs declare a neutral portrait in the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
    ) as { npcs: Record<string, { portraits?: { variants?: Record<string, string> } }> };

    for (const npcId of CANONICAL_NPC_IDS) {
      const variants = manifest.npcs[npcId]?.portraits?.variants;
      expect(variants, npcId).toBeDefined();
      // Neutral is the one variant the schema requires; the resolver relies on
      // it as the universal fallback.
      expect(variants?.neutral, `${npcId} neutral`).toBe(
        `/game-data/portraits/emberwatch/${npcId}/neutral.png`,
      );
    }
  });

  test('every manifest-declared portrait variant is served locally', () => {
    const required = collectRequiredEmberwatchCandidateTags(repository);
    const served = new Set(collectEmberwatchCandidateOverrides(repository).map((o) => o.tag));
    const portraitTags = required.filter((tag) => tag.startsWith('portraits:emberwatch:'));
    // 10 NPCs + 4 extra authored emotions = 14 (matches offline_core).
    expect(portraitTags.length).toBe(14);
    for (const tag of portraitTags) {
      expect(served.has(tag), tag).toBe(true);
    }
  });

  test('enemy visuals are served locally, not proxied', () => {
    const served = new Set(collectEmberwatchCandidateOverrides(repository).map((o) => o.tag));
    for (const id of ['ash_hound', 'cinder_thrall', 'ember_warden']) {
      expect(served.has(`emberwatch:enemies:${id}`), id).toBe(true);
    }
  });
});

describe('terrain atlas is conditional on the published bytes (C-548)', () => {
  const ATLAS_WEBP = 'sprites:tilesets:atlas.webp';
  const ATLAS_JSON = 'sprites:tilesets:atlas.json';

  test('an atlas matching the published seed is neither required nor overridden', () => {
    const published = new Map([
      [ATLAS_WEBP, sha256(join(tilesetRoot, 'atlas.webp'))],
      [ATLAS_JSON, sha256(join(tilesetRoot, 'atlas.json'))],
    ]);
    const overridden = collectEmberwatchCandidateOverrides(repository, published).map((o) => o.tag);
    expect(overridden).not.toContain(ATLAS_WEBP);
    expect(overridden).not.toContain(ATLAS_JSON);
    const required = collectRequiredEmberwatchCandidateTags(repository, published);
    expect(required).not.toContain(ATLAS_WEBP);
    expect(required).not.toContain(ATLAS_JSON);
    expect(missingCandidateOverrides(repository, published)).toEqual([]);
  });

  test('an atlas diverging from the published seed is required and overridden', () => {
    const published = new Map([
      [ATLAS_WEBP, 'stale-hash'],
      [ATLAS_JSON, 'stale-hash'],
    ]);
    const overridden = collectEmberwatchCandidateOverrides(repository, published).map((o) => o.tag);
    expect(overridden).toContain(ATLAS_WEBP);
    expect(overridden).toContain(ATLAS_JSON);
    const required = collectRequiredEmberwatchCandidateTags(repository, published);
    expect(required).toContain(ATLAS_WEBP);
    expect(required).toContain(ATLAS_JSON);
    expect(missingCandidateOverrides(repository, published)).toEqual([]);
  });

  test('an unknown published hash defaults to serving the local atlas', () => {
    const published = new Map<string, string>();
    const overridden = collectEmberwatchCandidateOverrides(repository, published).map((o) => o.tag);
    expect(overridden).toContain(ATLAS_WEBP);
    expect(overridden).toContain(ATLAS_JSON);
    // Without a published hash the atlas is still satisfied locally.
    expect(missingCandidateOverrides(repository, published)).toEqual([]);
  });
});

describe('published seed resolution', () => {
  test('readPublishedSeedHashes parses tag→hash rows and tolerates absence', () => {
    expect(readPublishedSeedHashes(join(repository, 'no-such-seed.json')).size).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), 'aikami-seed-'));
    try {
      const seedPath = join(dir, 'asset_seed.json');
      writeFileSync(
        seedPath,
        JSON.stringify({
          r: [{ t: 'a', h: '1' }, { t: 'b', h: '2' }, { t: 'no-hash' }, { h: 'no-tag' }],
        }),
      );
      const hashes = readPublishedSeedHashes(seedPath);
      expect(hashes.get('a')).toBe('1');
      expect(hashes.get('b')).toBe('2');
      expect(hashes.size).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('findPublishedSeedPath picks the newest snapshot by mtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'aikami-snapshots-'));
    try {
      const base = join(root, '.local/catalog/production/snapshots');
      const older = join(base, 'older');
      const newer = join(base, 'newer');
      for (const dir of [older, newer]) {
        mkdirSync(join(dir, 'remote/seed'), { recursive: true });
        writeFileSync(join(dir, 'remote/seed/asset_seed.json'), JSON.stringify({ r: [] }));
      }
      const past = new Date('2020-01-01T00:00:00Z');
      const future = new Date('2030-01-01T00:00:00Z');
      // Set the directory mtimes explicitly so recency is deterministic.
      utimesSync(older, past, past);
      utimesSync(newer, future, future);

      expect(findPublishedSeedPath(root)).toBe(join(newer, 'remote/seed/asset_seed.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('findPublishedSeedPath resolves a release snapshot content-addressed seed', () => {
    const root = mkdtempSync(join(tmpdir(), 'aikami-release-snapshot-'));
    try {
      const snapshotDir = join(root, '.local/catalog/production/snapshots/release-digest');
      const seedHash = 'a'.repeat(64);
      mkdirSync(join(snapshotDir, 'remote/seed', seedHash), { recursive: true });
      writeFileSync(
        join(snapshotDir, 'remote/seed', seedHash, 'asset_seed.json'),
        JSON.stringify({ r: [] }),
      );
      expect(findPublishedSeedPath(root)).toBe(
        join(snapshotDir, 'remote/seed', seedHash, 'asset_seed.json'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('findPublishedSeedPath is undefined when no snapshot exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'aikami-no-snapshots-'));
    try {
      expect(findPublishedSeedPath(root)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
