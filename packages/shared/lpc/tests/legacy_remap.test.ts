// packages/shared/lpc/tests/legacy_remap.test.ts
//
// AC-3: Verifies the legacy remap table restores index equivalence.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildLpcCatalog } from '../src/lib/build_catalog.ts';
import { LEGACY_INDEX_REMAP } from '../src/lib/legacy_remap.ts';

interface LegacySlot {
  slot: string;
  label: string;
  assetIds: string[];
}

interface LegacyCatalog {
  slots: LegacySlot[];
}

describe('legacy remap table', () => {
  let legacyCatalog: LegacyCatalog;

  beforeAll(() => {
    const raw = readFileSync(
      new URL('__fixtures__/legacy_catalog_order.json', import.meta.url),
      'utf8',
    );
    legacyCatalog = JSON.parse(raw) as LegacyCatalog;
  });

  test('remap table covers all slots with ordering differences', () => {
    const entries: { tag: string; category: string; ext: string }[] = [];
    for (const slot of legacyCatalog.slots) {
      for (const assetId of slot.assetIds) {
        const tagPath = assetId.replace(/\//g, ':');
        entries.push({ tag: `lpc:${tagPath}:walk`, category: 'lpc', ext: 'webp' });
      }
    }

    const result = buildLpcCatalog({ entries });

    const mismatchedSlots = legacyCatalog.slots.filter((legacySlot) => {
      const derivedSlot = result.slots.find((s) => s.slot === legacySlot.slot);
      if (!derivedSlot) return false;
      const derivedAssetIds = derivedSlot.variants.map((v) => v.assetId);
      return JSON.stringify(derivedAssetIds) !== JSON.stringify(legacySlot.assetIds);
    });

    for (const slot of mismatchedSlots) {
      expect(LEGACY_INDEX_REMAP[slot.slot]).toBeDefined();
    }
  });

  test('remap table restores index equivalence', () => {
    const entries: { tag: string; category: string; ext: string }[] = [];
    for (const slot of legacyCatalog.slots) {
      for (const assetId of slot.assetIds) {
        const tagPath = assetId.replace(/\//g, ':');
        entries.push({ tag: `lpc:${tagPath}:walk`, category: 'lpc', ext: 'webp' });
      }
    }

    const result = buildLpcCatalog({ entries });

    for (const legacySlot of legacyCatalog.slots) {
      const derivedSlot = result.slots.find((s) => s.slot === legacySlot.slot);
      if (!derivedSlot) continue;

      const remap = LEGACY_INDEX_REMAP[legacySlot.slot];
      if (!remap) {
        // Slot order matches — no remap needed
        const derivedAssetIds = derivedSlot.variants.map((v) => v.assetId);
        expect(derivedAssetIds).toEqual(legacySlot.assetIds);
        continue;
      }

      // Apply remap: for each legacy 1-indexed index, verify the remapped
      // index points to the same assetId in the derived catalog
      for (let legacyIdx = 0; legacyIdx < legacySlot.assetIds.length; legacyIdx++) {
        const legacyAssetId = legacySlot.assetIds[legacyIdx];
        const legacyIndex = legacyIdx + 1; // 1-indexed
        const derivedIndex = remap[legacyIndex];
        if (derivedIndex !== undefined) {
          const derivedAssetId = derivedSlot.variants[derivedIndex - 1]?.assetId;
          expect(derivedAssetId).toBe(legacyAssetId);
        } else {
          // No remap needed for this index — it's the same in both orders
          const derivedAssetId = derivedSlot.variants[legacyIdx]?.assetId;
          expect(derivedAssetId).toBe(legacyAssetId);
        }
      }
    }
  });

  test('remap table has no duplicate target indices per slot', () => {
    for (const [slot, remap] of Object.entries(LEGACY_INDEX_REMAP)) {
      const targets = Object.values(remap);
      const uniqueTargets = new Set(targets);
      expect(uniqueTargets.size).toBe(targets.length);
    }
  });
});
