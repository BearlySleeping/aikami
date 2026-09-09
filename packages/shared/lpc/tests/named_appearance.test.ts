// packages/shared/lpc/tests/named_appearance.test.ts
//
// C-504 — named appearance identity + legacy migration (AC-1, AC-2, AC-3).
// Uses the PRODUCTION snapshot + buildLpcCatalog (the runtime catalog shape),
// never a /tmp audit file or a live CDN response.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildLpcCatalog } from '../src/lib/build_catalog.ts';
import {
  LEGACY_CATALOG_SNAPSHOT,
  LEGACY_CATALOG_SNAPSHOT_ID,
} from '../src/lib/legacy_catalog_snapshot.ts';
import {
  legacyToNamed,
  type NamedAppearance,
  namedToLayerIds,
  normalizeNamed,
  resolveNpcAppearance,
} from '../src/lib/named_appearance.ts';

type LegacySlot = { slot: string; label: string; assetIds: string[] };
type LegacyCatalog = { slots: LegacySlot[] };

/** Builds the derived runtime catalog from the verified legacy snapshot. */
const buildCatalog = () => {
  const entries: { tag: string; category: string; ext: string }[] = [];
  for (const [, assetIds] of Object.entries(LEGACY_CATALOG_SNAPSHOT)) {
    for (const assetId of assetIds) {
      const tagPath = assetId.replace(/\//g, ':');
      entries.push({ tag: `lpc:${tagPath}:walk`, category: 'lpc', ext: 'webp' });
    }
  }
  const result = buildLpcCatalog({ entries });
  return result.slots; // LpcSlotDefinition[] — fits AppearanceCatalog
};

describe('C-504 named appearance', () => {
  let catalog: ReturnType<typeof buildCatalog>;

  beforeAll(() => {
    catalog = buildCatalog();
  });

  test('production snapshot matches the verified test fixture', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('__fixtures__/legacy_catalog_order.json', import.meta.url), 'utf8'),
    ) as LegacyCatalog;
    for (const slot of fixture.slots) {
      expect(LEGACY_CATALOG_SNAPSHOT[slot.slot]).toEqual(slot.assetIds);
    }
  });

  test('AC-1: Rollo migrates to male body, male trousers, human male head', () => {
    const result = resolveNpcAppearance({
      input: [3, 123, 23, 22, 7, 95],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
      source: 'manifest:appearanceLayers',
      npcId: 'rollo_grasper',
    });
    expect(result.status).toBe('migrated');
    const comps = result.appearance?.components ?? [];
    expect(comps.find((c) => c.slot === 'body')?.assetId).toBe('body/bodies_male');
    expect(comps.find((c) => c.slot === 'legs')?.assetId).toBe('legs/pants_male');
    expect(comps.find((c) => c.slot === 'head')?.assetId).toBe('head/heads/human_male');
  });

  test('AC-1: merchant migrates to male body, male trousers, human male head', () => {
    const result = resolveNpcAppearance({
      input: [3, 91, 127, 22, 19, 95],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
      npcId: 'merchant',
    });
    expect(result.status).toBe('migrated');
    const comps = result.appearance?.components ?? [];
    expect(comps.find((c) => c.slot === 'body')?.assetId).toBe('body/bodies_male');
    expect(comps.find((c) => c.slot === 'head')?.assetId).toBe('head/heads/human_male');
  });

  test('AC-1: elder restores female body + elderly head', () => {
    const result = resolveNpcAppearance({
      input: [2, 3, 65, 21, 20, 97],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
      npcId: 'village_elder',
    });
    expect(result.status).toBe('migrated');
    const comps = result.appearance?.components ?? [];
    expect(comps.find((c) => c.slot === 'body')?.assetId).toBe('body/bodies_female');
    expect(comps.find((c) => c.slot === 'head')?.assetId).toBe('head/heads/human/female_elderly');
  });

  test('AC-2: catalog reorder/insertion does not change resolved named components', () => {
    // Insert an unrelated variant at the FRONT of the head slot and shuffle.
    const reordered = [...catalog];
    const headIdx = reordered.findIndex((s) => s.slot === 'head');
    const headSlot = reordered[headIdx];
    const reorderedHead = {
      ...headSlot,
      variants: [
        {
          assetId: 'head/heads/human/inserted_before',
          label: 'x',
          layerRole: 'front' as const,
          states: [],
        },
        ...headSlot.variants,
      ],
    };
    const reorderedCatalog = [
      ...reordered.slice(0, headIdx),
      reorderedHead,
      ...reordered.slice(headIdx + 1),
    ].sort((a, b) => (a.slot > b.slot ? 1 : -1));

    const before = resolveNpcAppearance({
      input: [3, 123, 23, 22, 7, 95],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    const after = resolveNpcAppearance({
      input: [3, 123, 23, 22, 7, 95],
      catalog: reorderedCatalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    expect(before.appearance?.components).toEqual(after.appearance?.components);
    // Named identity is identical; the numeric handle differs (head index shifted).
    expect(after.appearance?.components.find((c) => c.slot === 'head')?.assetId).toBe(
      'head/heads/human_male',
    );
  });

  test('AC-2: a named appearance persists no unversioned numeric positions', () => {
    const named: NamedAppearance = {
      formatVersion: 1,
      components: [
        { slot: 'body', assetId: 'body/bodies_male', layerRole: 'front' },
        { slot: 'head', assetId: 'head/heads/human_male', layerRole: 'front' },
      ],
    };
    const result = resolveNpcAppearance({ input: named, catalog });
    expect(result.status).toBe('named');
    expect(result.appearance?.formatVersion).toBe(1);
    expect(result.appearance?.components[0]).toEqual({
      slot: 'body',
      assetId: 'body/bodies_male',
      layerRole: 'front',
    });
    expect(result.layerIds).toBeDefined();
  });

  test('AC-2: missing referenced asset → diagnostic, never a positional substitute', () => {
    const named: NamedAppearance = {
      formatVersion: 1,
      components: [
        { slot: 'body', assetId: 'body/bodies_male', layerRole: 'front' },
        { slot: 'head', assetId: 'head/heads/does_not_exist', layerRole: 'front' },
      ],
    };
    const result = resolveNpcAppearance({ input: named, catalog });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.assetId).toBe('head/heads/does_not_exist');
  });

  test('AC-3: unknown provenance is preserved, never guessed', () => {
    const result = resolveNpcAppearance({
      input: [3, 123, 23, 22, 7, 95],
      catalog,
      snapshot: 'some-other-catalog',
      npcId: 'rollo_grasper',
    });
    expect(result.status).toBe('unknown-provenance');
    expect(result.appearance).toBeUndefined();
    expect(result.diagnostics[0]?.detail).toContain('unrecognized provenance');
  });

  test('AC-3: an out-of-range legacy index refuses partial migration', () => {
    const result = resolveNpcAppearance({
      input: [3, 123, 23, 99999, 7, 95],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    expect(result.status).toBe('invalid');
    expect(result.appearance).toBeUndefined();
  });

  test('AC-3: index 0 retains its intentionally-empty meaning', () => {
    const result = legacyToNamed([3, 0, 0, 22, 0, 95], {
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    expect(result.status).toBe('migrated');
    const comps = result.appearance?.components ?? [];
    expect(comps.find((c) => c.slot === 'hair')?.assetId).toBe('');
    expect(comps.find((c) => c.slot === 'feet')?.assetId).toBe('');
  });

  test('AC-3: migration is idempotent (named in → named out, unchanged)', () => {
    const first = resolveNpcAppearance({
      input: [3, 123, 23, 22, 7, 95],
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    const second = resolveNpcAppearance({
      input: first.appearance,
      catalog,
      snapshot: LEGACY_CATALOG_SNAPSHOT_ID,
    });
    expect(second.status).toBe('named');
    expect(second.appearance?.components).toEqual(first.appearance?.components);
  });

  test('missing layerRole normalizes to front', () => {
    const named = normalizeNamed({
      formatVersion: 1,
      components: [{ slot: 'body', assetId: 'body/bodies_male' } as never],
    });
    expect(named.appearance.components[0]?.layerRole).toBe('front');
  });

  test('rejects unsupported component slots', () => {
    const result = resolveNpcAppearance({
      input: {
        formatVersion: 1,
        components: [{ slot: 'cape', assetId: 'torso/chainmail_male' }],
      },
      catalog,
    });

    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some((diagnostic) => diagnostic.detail.includes('unsupported'))).toBe(
      true,
    );
  });

  test('rejects duplicate component slots', () => {
    const result = resolveNpcAppearance({
      input: {
        formatVersion: 1,
        components: [
          { slot: 'body', assetId: 'body/bodies_male' },
          { slot: 'body', assetId: 'body/bodies_female' },
        ],
      },
      catalog,
    });

    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some((diagnostic) => diagnostic.detail.includes('duplicate'))).toBe(
      true,
    );
  });

  test('namedToLayerIds derives deterministic engine indices (0 = empty)', () => {
    const named: NamedAppearance = {
      formatVersion: 1,
      components: [
        { slot: 'body', assetId: 'body/bodies_male', layerRole: 'front' },
        { slot: 'head', assetId: 'head/heads/human_male', layerRole: 'front' },
      ],
    };
    const a = namedToLayerIds(named, catalog);
    const b = namedToLayerIds(named, [...catalog].reverse());
    expect(a.layerIds).toEqual(b.layerIds);
    // body/bodies_male exists; torso/feet/legs/hair absent → 0 (empty).
    expect(a.layerIds[0]).toBeGreaterThan(0);
    expect(a.layerIds[2]).toBe(0); // torso
    expect(a.layerIds[4]).toBe(0); // feet
  });
});
