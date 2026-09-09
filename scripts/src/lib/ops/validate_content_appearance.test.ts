// scripts/src/lib/ops/validate_content_appearance.test.ts
//
// C-504 AC-4 — content appearance validator unit tests (runtime parity).
//
// Verifies:
//   - loadCatalog returns the DERIVED catalog (the shape /game resolves)
//   - legacy appearanceLayers migrate to the intended named identities
//   - 0 (intentionally empty) and short arrays never fail validation
//   - out-of-range / negative / non-integer legacy values fail naming slot
//   - a named appearance referencing a missing asset fails with a diagnostic
//   - the committed emberwatch pack passes the validator

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLpcCatalog, LEGACY_CATALOG_SNAPSHOT } from '@aikami/lpc';
import {
  loadCatalog,
  validateContentAppearance,
  validateNpcAppearance,
} from './validate_content_appearance.js';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTENT_PACKS_ROOT = join(REPO_ROOT, 'content/packs');

const CATALOG = loadCatalog();

// ---------------------------------------------------------------------------
// loadCatalog
// ---------------------------------------------------------------------------

describe('loadCatalog', () => {
  it('builds the derived runtime catalog from the verified snapshot', () => {
    const slots = CATALOG.map((s) => s.slot);
    expect(slots).toContain('head');
    expect(slots).toContain('body');
    expect(slots).toContain('hair');
    expect(slots).toContain('torso');
    expect(slots).toContain('legs');
    expect(slots).toContain('feet');
  });

  it('AC-4: derived-catalog asset-ID universe equals the verified snapshot universe', () => {
    // The runtime `getLpcCatalog()` builds from asset-store seed rows that are
    // generated from the SAME LPC collection as the legacy snapshot. The
    // validator's derived catalog is a deterministic permutation (lexicographic)
    // of that universe, so position-independent named resolution holds as long
    // as the two sets agree. Assert set equality here (the committed contract).
    const entries: { tag: string; category: string; ext: string }[] = [];
    for (const [, assetIds] of Object.entries(LEGACY_CATALOG_SNAPSHOT)) {
      for (const assetId of assetIds) {
        entries.push({
          tag: `lpc:${assetId.replace(/\//g, ':')}:walk`,
          category: 'lpc',
          ext: 'webp',
        });
      }
    }
    const derivedAll = new Set(buildLpcCatalog({ entries }).allAssetIds);
    const snapshotAll = new Set(Object.values(LEGACY_CATALOG_SNAPSHOT).flat());
    expect(derivedAll.size).toBe(snapshotAll.size);
    for (const id of snapshotAll) {
      expect(derivedAll.has(id), `missing from derived catalog: ${id}`).toBe(true);
    }
    for (const id of derivedAll) {
      expect(snapshotAll.has(id), `unexpected in derived catalog: ${id}`).toBe(true);
    }
  });

  it('AC-4: every named appearance assetId referenced by committed packs exists in the runtime catalog universe', () => {
    // Every named assetId the validator approves must exist in the universe the
    // runtime catalog (and therefore the seed) is generated from — otherwise
    // `/game` would resolve to a fallback the validator accepted.
    const catalogIds = new Set(CATALOG.flatMap((s) => s.variants.map((v) => v.assetId)));
    const packsRoot = join(REPO_ROOT, 'content/packs');
    if (!existsSync(packsRoot)) {
      return;
    }
    for (const packName of ['emberwatch']) {
      const manifestPath = join(packsRoot, packName, 'manifest.json');
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        npcs?: Record<
          string,
          { appearance?: { components?: Array<{ assetId?: string }> } } | undefined
        >;
      };
      for (const [npcId, npc] of Object.entries(manifest.npcs ?? {})) {
        for (const component of npc?.appearance?.components ?? []) {
          if (component.assetId && component.assetId !== '') {
            expect(
              catalogIds.has(component.assetId),
              `${npcId} references ${component.assetId}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// validateNpcAppearance
// ---------------------------------------------------------------------------

describe('validateNpcAppearance', () => {
  const base = { packId: 'test', npcId: 'npc' } as const;

  it('accepts all three Emberwatch NPC legacy arrays (migrated identities)', () => {
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

  it('accepts named appearance for the shipped NPCs', () => {
    const named = {
      formatVersion: 1,
      components: [
        { slot: 'body', assetId: 'body/bodies_male', layerRole: 'front' },
        { slot: 'head', assetId: 'head/heads/human_male', layerRole: 'front' },
      ],
    } as const;
    const errors = validateNpcAppearance({ ...base, appearance: named, catalog: CATALOG });
    expect(errors).toEqual([]);
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

  it('rejects an out-of-range legacy index naming slot and snapshot', () => {
    const errors = validateNpcAppearance({
      ...base,
      appearanceLayers: [3, 3, 99999, 22, 7, 95],
      catalog: CATALOG,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.slot).toBe('torso');
    expect(errors[0]?.snapshot).toBe('legacy-catalog-order-v1');
    expect(errors[0]?.packId).toBe('test');
    expect(errors[0]?.npcId).toBe('npc');
    expect(errors[0]?.detail).toContain('outside the verified snapshot range');
  });

  it('rejects a named appearance that references a missing asset', () => {
    const named = {
      formatVersion: 1,
      components: [
        { slot: 'body', assetId: 'body/bodies_male' },
        { slot: 'head', assetId: 'head/heads/does_not_exist' },
      ],
    } as const;
    const errors = validateNpcAppearance({ ...base, appearance: named, catalog: CATALOG });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.slot).toBe('head');
    expect(errors[0]?.assetId).toBe('head/heads/does_not_exist');
    expect(errors[0]?.source).toBe('manifest:appearance');
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
