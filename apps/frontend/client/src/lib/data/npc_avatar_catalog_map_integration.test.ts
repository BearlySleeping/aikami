// apps/frontend/client/src/lib/data/npc_avatar_catalog_map_integration.test.ts
//
// C-529: real map NPC → dialogue portrait resolution.
//
// The first human visual gate showed every tested NPC dialogue using generic
// stand-in art. The per-NPC unit tests passed because they stubbed a catalog
// that contained the portraits; the real failure was that the REHEARSAL ORIGIN
// did not serve them, so the resolver fell through to `gandalf`/`orc`/`aragon`.
//
// This test uses the REAL pack manifest and the REAL map spawn objects — no
// hand-written npcId list — and proves that when the candidate catalog serves
// the manifest-declared portraits, every story NPC resolves to its own bust and
// never to a stand-in. A second case proves the miss is recorded as a release
// diagnostic when the catalog does NOT serve them.

/** biome-ignore-all lint/style/useNamingConvention: content-pack NPC ids use snake_case by design */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentPackManifest } from '@aikami/schemas';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');

const resolvable = new Set<string>();
mock.module('$lib/services/assets/asset_store.svelte', () => ({
  assetStore: {
    resolveUrl: (tag: string) => (resolvable.has(tag) ? `blob:${tag}` : null),
  },
}));

const {
  configureNpcPortraitSource,
  getUnresolvedPackPortraitTags,
  resetPackPortraitDiagnostics,
  resolveNpcAvatarUrl,
} = await import('./npc_avatar_catalog.ts');

const manifest = JSON.parse(
  readFileSync(join(packRoot, 'manifest.json'), 'utf8'),
) as ContentPackManifest;

type SpawnObject = {
  type?: string;
  properties?: Array<{ name: string; value: unknown }>;
};

/** NPC ids placed by one map file. */
const npcIdsInMap = (file: string): string[] => {
  const map = JSON.parse(readFileSync(join(packRoot, 'maps', file), 'utf8')) as {
    layers?: Array<{ objects?: SpawnObject[] }>;
  };
  const ids: string[] = [];
  for (const layer of map.layers ?? []) {
    for (const object of layer.objects ?? []) {
      if (object.type !== 'npc') {
        continue;
      }
      const npcId = object.properties?.find((p) => p.name === 'npcId')?.value;
      if (typeof npcId === 'string') {
        ids.push(npcId);
      }
    }
  }
  return ids;
};

/** Every NPC id placed by any real map (npc spawn objects). */
const placedNpcIds = (): string[] => {
  const ids = new Set<string>();
  for (const file of readdirSync(join(packRoot, 'maps'))) {
    if (file.endsWith('.json')) {
      for (const id of npcIdsInMap(file)) {
        ids.add(id);
      }
    }
  }
  return [...ids].sort();
};

/** The tags a COMPLETE candidate catalog would carry, straight from the manifest. */
const candidatePortraitTags = (): string[] => {
  const tags: string[] = [];
  for (const [npcId, npc] of Object.entries(manifest.npcs)) {
    for (const variant of Object.keys(npc.portraits?.variants ?? {})) {
      tags.push(`portraits:emberwatch:${npcId}:${variant}`);
    }
  }
  return tags;
};

beforeEach(() => {
  resolvable.clear();
  resetPackPortraitDiagnostics();
  configureNpcPortraitSource(manifest);
});

describe('real map NPC → dialogue portrait resolution', () => {
  test('the maps place exactly the ten canonical story NPCs', () => {
    const ids = placedNpcIds();
    for (const expected of [
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
    ]) {
      expect(ids, expected).toContain(expected);
    }
    // Hostile combat NPCs are not placed as map spawns.
    expect(ids).not.toContain('ash_hound');
  });

  test('a complete candidate catalog resolves every placed NPC to its own bust', () => {
    for (const tag of candidatePortraitTags()) {
      resolvable.add(tag);
    }
    for (const npcId of placedNpcIds()) {
      const url = resolveNpcAvatarUrl({ npcId });
      expect(url, npcId).toBe(`blob:portraits:emberwatch:${npcId}:neutral`);
      // Never the legacy stand-ins.
      expect(url, npcId).not.toContain('/portraits/npc/gandalf/');
      expect(url, npcId).not.toContain('/portraits/npc/orc/');
      expect(url, npcId).not.toContain('/portraits/npc/aragon/');
    }
    expect(getUnresolvedPackPortraitTags()).toEqual([]);
  });

  test('a candidate catalog missing a portrait records it as a release diagnostic', () => {
    // Serve everything except Orra — the D2 failure class.
    for (const tag of candidatePortraitTags()) {
      if (!tag.startsWith('portraits:emberwatch:smith_orra:')) {
        resolvable.add(tag);
      }
    }

    const url = resolveNpcAvatarUrl({ npcId: 'smith_orra' });
    // Production keeps the stand-in fallback...
    expect(url).not.toBe('blob:portraits:emberwatch:smith_orra:neutral');
    // ...but the miss is now VISIBLE instead of silent.
    expect(getUnresolvedPackPortraitTags()).toContain('smith_orra:neutral');
  });
});
