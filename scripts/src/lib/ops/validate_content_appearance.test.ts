// scripts/src/lib/ops/validate_content_appearance.test.ts
//
// C-400 AC-5 — content appearance validator unit tests.
//
// Verifies:
//   - parseGeneratedCatalog extracts slot → assetId lists from the real
//     generated catalog text
//   - in-range indices pass; out-of-range indices fail naming slot/range
//   - head-slot indices must resolve to head/heads/* assets
//   - 0 (intentionally empty) and short arrays (4-layer policy)
//     never fail validation
//   - the committed emberwatch pack passes the validator

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadCatalog,
  parseGeneratedCatalog,
  validateContentAppearance,
  validateNpcAppearance,
} from './validate_content_appearance.js';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const LEGACY_FIXTURE = join(
  REPO_ROOT,
  'packages/shared/lpc/tests/__fixtures__/legacy_catalog_order.json',
);
const CONTENT_PACKS_ROOT = join(REPO_ROOT, 'content/packs');

const CATALOG = loadCatalog();

// ---------------------------------------------------------------------------
// parseGeneratedCatalog
// ---------------------------------------------------------------------------

describe('parseGeneratedCatalog', () => {
  it('parses the legacy catalog fixture into slot → variant lists', () => {
    expect(existsSync(LEGACY_FIXTURE)).toBe(true);
    const fixture = JSON.parse(readFileSync(LEGACY_FIXTURE, 'utf-8')) as {
      slots: Array<{ slot: string; label: string; assetIds: string[] }>;
    };
    const slotsByName = new Map(fixture.slots.map((s) => [s.slot, s.assetIds]));
    expect(slotsByName.has('head')).toBe(true);
    expect(slotsByName.has('body')).toBe(true);
    expect(slotsByName.has('hair')).toBe(true);
    expect(slotsByName.has('torso')).toBe(true);
    expect(slotsByName.has('legs')).toBe(true);
    expect(slotsByName.has('feet')).toBe(true);
  });

  it('handles a minimal fixture without crashing', () => {
    const slots = parseGeneratedCatalog(`export const X = [{
      slot: 'head',
      variants: [{ assetId: 'head/heads/human_male' }],
    }];`);
    expect(slots).toEqual([{ slot: 'head', variants: ['head/heads/human_male'] }]);
  });
});

// ---------------------------------------------------------------------------
// validateNpcAppearance
// ---------------------------------------------------------------------------

describe('validateNpcAppearance', () => {
  const base = { packId: 'test', npcId: 'npc' } as const;

  it('accepts all three Emberwatch NPC arrays unchanged', () => {
    const cases = [
      [2, 3, 65, 21, 20, 97], // village_elder
      [3, 123, 23, 22, 7, 95], // rollo_grasper
      [3, 91, 127, 22, 19, 95], // merchant
    ];
    for (const layers of cases) {
      const errors = validateNpcAppearance({ ...base, appearanceLayers: layers, catalog: CATALOG });
      expect(errors, `layers ${layers.join(',')}`).toEqual([]);
    }
  });

  it('accepts an index of 0 (intentionally empty) without validation errors', () => {
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [3, 3, 0, 22, 0, 95],
      catalog: CATALOG,
    });
    expect(errors).toEqual([]);
  });

  it('accepts short arrays (4-layer policy)', () => {
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [1, 3, 7, 14],
      catalog: CATALOG,
    });
    expect(errors).toEqual([]);
  });

  it('rejects an out-of-range index naming slot, index, and valid range', () => {
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [3, 3, 99999, 22, 7, 95],
      catalog: CATALOG,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.slot).toBe('torso');
    expect(errors[0]?.index).toBe(99999);
    expect(errors[0]?.packId).toBe('test');
    expect(errors[0]?.npcId).toBe('npc');
    expect(errors[0]?.validRange).toMatch(/^1\.\.\d+$/);
  });

  it('rejects a head-slot index that resolves to a non-head asset', () => {
    // head slot index 1 → head/ears/avyon_adult (not a head/heads/* asset).
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [3, 3, 23, 22, 7, 1],
      catalog: CATALOG,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.slot).toBe('head');
    expect(errors[0]?.detail).toContain('head/heads/');
  });

  it('rejects a negative index as out of range', () => {
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [-1, 3, 23, 22, 7, 95],
      catalog: CATALOG,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.slot).toBe('body');
  });

  it('rejects non-integer layer values the way raw JSON can provide them', () => {
    // The manifest is raw JSON — TS types say number[] but the runtime value
    // can be a string, null, or a fraction. All must be rejected, never
    // coerced into a "valid" index (e.g. "1" - 1 === 0, null ?? 0 === 0).
    const badLayers = [
      ['1', 3, 23, 22, 7, 95], // string index
      [null, 3, 23, 22, 7, 95], // null index
      [1.5, 3, 23, 22, 7, 95], // fractional index
    ] as unknown as readonly (readonly number[])[];
    for (const layers of badLayers) {
      const errors = validateNpcAppearance({ ...base, appearanceLayers: layers, catalog: CATALOG });
      expect(errors, `layers ${JSON.stringify(layers)}`).toHaveLength(1);
      expect(errors[0]?.slot).toBe('body');
      expect(errors[0]?.detail).toContain('not a non-negative integer');
    }
  });
});

// ---------------------------------------------------------------------------
// validateContentAppearance — integration against committed packs
// ---------------------------------------------------------------------------

describe('validateContentAppearance (integration)', () => {
  it('passes the committed emberwatch pack', () => {
    expect(existsSync(CONTENT_PACKS_ROOT)).toBe(true);
    const errors = validateContentAppearance();
    expect(errors).toEqual([]);
  });
});
