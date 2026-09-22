// scripts/src/lib/ops/emberwatch_legacy_props.test.ts

import { describe, expect, test } from 'bun:test';
import {
  buildLegacyPropManifest,
  checkLegacyPropManifest,
  compareLegacyPropManifests,
  type LegacyPropManifest,
} from './emberwatch_legacy_props.ts';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';

/**
 * A synthetic non-empty manifest for the comparison-logic tests. The committed
 * manifest is empty now that every legacy frame is replaced, so the mutation
 * cases need a fixture to mutate.
 */
const fixtureManifest = (): LegacyPropManifest => ({
  schemaVersion: 1,
  kind: 'emberwatch-legacy-prop-replacements',
  generatedBy: 'scripts/src/lib/ops/emberwatch_legacy_props.ts',
  policy: 'fixture',
  counts: { legacyFrames: 1, replacementFrames: 1, placedProps: 1 },
  items: [
    {
      frame: 'crate.png',
      replacementFrame: 'prop_crate.png',
      briefJobId: 'crate',
      targetCanvas: [48, 48],
      preparationProfile: 'prop-luminance-alpha-ground',
      propIds: ['inn_crate'],
      maps: ['inn'],
      acceptance: [
        'standalone PNG or WebP with native alpha under content/packs/emberwatch/props/',
      ],
    },
  ],
});

describe('emberwatch legacy prop replacements', () => {
  test('covers exactly the legacy grid-atlas allowlist', () => {
    const manifest = buildLegacyPropManifest();
    expect(new Set(manifest.items.map((item) => item.frame))).toEqual(
      new Set(LEGACY_GRID_PROP_FRAMES),
    );
    expect(manifest.counts.legacyFrames).toBe(LEGACY_GRID_PROP_FRAMES.size);
  });

  test('every missing frame names an asset-brief generation job', () => {
    const manifest = buildLegacyPropManifest();
    for (const item of manifest.items) {
      expect(item.briefJobId, item.frame).not.toBeNull();
      expect(item.replacementFrame.endsWith('.png'), item.frame).toBe(true);
      expect(item.acceptance.length).toBeGreaterThan(0);
    }
  });

  test('the committed manifest is current', () => {
    expect(checkLegacyPropManifest()).toEqual({ ok: true, reasons: [] });
  });

  test('the manifest is deterministic', () => {
    expect(JSON.stringify(buildLegacyPropManifest())).toBe(
      JSON.stringify(buildLegacyPropManifest()),
    );
  });

  test('a freshly generated manifest compares clean', () => {
    const wanted = buildLegacyPropManifest();
    expect(compareLegacyPropManifests(wanted, buildLegacyPropManifest())).toEqual([]);
  });

  test('stale acceptance criteria fail the check', () => {
    const wanted = fixtureManifest();
    const declared = structuredClone(wanted);
    const first = declared.items[0];
    if (!first) {
      throw new Error('fixture manifest has no items');
    }
    first.acceptance = [...first.acceptance, 'stale extra gate'];
    const reasons = compareLegacyPropManifests(declared, wanted);
    expect(reasons).toContain(
      'manifest contents do not match the current generated replacement manifest',
    );
  });

  test('a stale target canvas fails the check', () => {
    const wanted = fixtureManifest();
    const declared = structuredClone(wanted);
    const first = declared.items[0];
    if (!first) {
      throw new Error('fixture manifest has no items');
    }
    first.targetCanvas = [9999, 9999];
    const reasons = compareLegacyPropManifests(declared, wanted);
    expect(reasons).toContain(
      'manifest contents do not match the current generated replacement manifest',
    );
  });

  test('a stale propId or map fails the check', () => {
    const wanted = fixtureManifest();
    const declared = structuredClone(wanted);
    const first = declared.items[0];
    if (!first) {
      throw new Error('fixture manifest has no items');
    }
    first.propIds = [...first.propIds, 'ghost_prop'];
    first.maps = [...first.maps, 'ghost_map'];
    const reasons = compareLegacyPropManifests(declared, wanted);
    expect(reasons).toContain(
      'manifest contents do not match the current generated replacement manifest',
    );
  });
});
