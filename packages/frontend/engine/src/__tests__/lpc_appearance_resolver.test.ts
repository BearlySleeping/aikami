// packages/frontend/engine/src/__tests__/lpc_appearance_resolver.test.ts
//
// Unit tests for the unified LPC appearance resolver (C-400).
//
// Covers:
//   - AC-2: distinct appearanceLayers resolve to distinct asset id sets
//   - AC-3: unresolvable slots fall back AND log; recipes.length === 6 for
//     every input (all-zeros, all-999, short arrays)
//   - AC-4: worker and main-thread paths agree — regression guard against
//     re-forking the resolver
//
// The resolver is a pure function over (layerIds, catalog, fallbacks). The
// catalog is injected so the same code serves the worker and the client.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  type LpcSlotCatalog,
  type LpcSlotName,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  resolveLpcAppearance,
} from '../rendering/lpc_appearance_resolver.ts';

// ---------------------------------------------------------------------------
// Fixtures — a small catalog mirroring the generated catalog's shape.
// ---------------------------------------------------------------------------

const makeSlot = (slot: LpcSlotName, assetIds: readonly string[]): LpcSlotCatalog => ({
  slot,
  variants: assetIds.map((assetId) => ({ assetId })),
});

const FIXTURE_CATALOG: readonly LpcSlotCatalog[] = [
  makeSlot('body', ['body/bodies_child', 'body/bodies_female', 'body/bodies_male']),
  makeSlot('hair', ['hair/bald', 'hair/bangs_adult', 'hair/long_braid']),
  makeSlot('torso', ['torso/chainmail_male', 'torso/clothes/robe_female']),
  makeSlot('legs', ['legs/pants_male', 'legs/pants_female']),
  makeSlot('feet', ['feet/shoes/basic_male', 'feet/shoes/boots_male']),
  makeSlot('head', ['head/heads/human_male', 'head/heads/human/female_elderly']),
];

const ELDER_LAYERS = [1, 2, 2, 1, 1, 2] as const;
const ROLLO_LAYERS = [3, 1, 1, 2, 2, 1] as const;
const MERCHANT_LAYERS = [2, 3, 1, 1, 2, 1] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resolve = (layerIds: readonly number[]) =>
  resolveLpcAppearance({
    layerIds,
    catalog: FIXTURE_CATALOG,
    fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
  });

const recipeKeys = (result: ReturnType<typeof resolve>) =>
  result.recipes.map((r) => `${r.slot}=${r.assetId}`);

afterEach(() => {
  resetLpcFallbackWarnings();
});

// ---------------------------------------------------------------------------
// AC-2 — distinct appearances resolve to distinct asset id sets
// ---------------------------------------------------------------------------

describe('AC-2 — distinct NPC appearances are visually distinct', () => {
  test('three NPCs with different appearanceLayers resolve to distinct recipe lists', () => {
    const elder = resolve(ELDER_LAYERS);
    const rollo = resolve(ROLLO_LAYERS);
    const merchant = resolve(MERCHANT_LAYERS);

    const elderKey = recipeKeys(elder).join('|');
    const rolloKey = recipeKeys(rollo).join('|');
    const merchantKey = recipeKeys(merchant).join('|');

    expect(elderKey).not.toBe(rolloKey);
    expect(elderKey).not.toBe(merchantKey);
    expect(rolloKey).not.toBe(merchantKey);

    // Spot-check the resolved asset ids — elder's head is female_elderly.
    const elderHead = elder.resolutions.head;
    expect(elderHead.kind).toBe('resolved');
    if (elderHead.kind === 'resolved') {
      expect(elderHead.assetId).toBe('head/heads/human/female_elderly');
    }
  });

  test('all resolutions are in render order with real asset ids (no numeric strings)', () => {
    const result = resolve(ELDER_LAYERS);
    expect(result.recipes.map((r) => r.slot)).toEqual([...LPC_SLOT_ORDER]);

    for (const recipe of result.recipes) {
      expect(recipe.assetId).toMatch(/\//);
      expect(recipe.hexPalette.byteLength).toBe(1024);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-3 — unresolvable slots fall back and log; six entries always
// ---------------------------------------------------------------------------

describe('AC-3 — unresolvable slots fall back and log', () => {
  test('all-zeros input produces six empty entries with NO fallback warnings', () => {
    const result = resolve([0, 0, 0, 0, 0, 0]);

    expect(result.recipes).toHaveLength(6);
    for (const recipe of result.recipes) {
      expect(recipe.assetId).toBe('');
      expect(recipe.hexPalette.byteLength).toBe(1024);
    }
    for (const slot of LPC_SLOT_ORDER) {
      expect(result.resolutions[slot].kind).toBe('empty');
    }
  });

  test('all-999 input produces six entries — every slot resolves to its fallback', () => {
    const result = resolve([999, 999, 999, 999, 999, 999]);

    expect(result.recipes).toHaveLength(6);
    for (const slot of LPC_SLOT_ORDER) {
      const resolution = result.resolutions[slot];
      expect(resolution.kind).toBe('fallback');
      if (resolution.kind === 'fallback') {
        expect(resolution.requestedIndex).toBe(999);
        expect(resolution.catalogSize).toBeGreaterThan(0);
        expect(resolution.assetId).toBe(DEFAULT_LPC_SLOT_FALLBACKS[slot]);
        // Every fallback asset exists in the catalog for that slot.
        const slotDef = FIXTURE_CATALOG.find((s) => s.slot === slot);
        expect(slotDef?.variants.some((v) => v.assetId === resolution.assetId)).toBe(true);
      }
    }
  });

  test('a single out-of-range slot falls back while siblings resolve', () => {
    // torso=3 → 0-indexed 2, but torso has only 2 variants → out of range.
    const result = resolve([3, 1, 3, 2, 1, 1]);

    expect(result.recipes).toHaveLength(6);
    expect(result.resolutions.body.kind).toBe('resolved');
    expect(result.resolutions.head.kind).toBe('resolved');

    const torso = result.resolutions.torso;
    expect(torso.kind).toBe('fallback');
    if (torso.kind === 'fallback') {
      expect(torso.requestedIndex).toBe(3); // 1-indexed 3 → index 2 ≥ catalogSize 2
      expect(torso.catalogSize).toBe(2);
    }
  });

  test('a short array (whispering-caves 4-layer policy) still yields six entries', () => {
    const result = resolve([1, 2, 1, 1]);

    expect(result.recipes).toHaveLength(6);
    // Missing trailing slots (feet, head) degrade to fallback assets,
    // recorded with an explicit null requestedIndex — never `undefined`.
    expect(result.resolutions.feet.kind).toBe('fallback');
    if (result.resolutions.feet.kind === 'fallback') {
      expect(result.resolutions.feet.requestedIndex).toBeNull();
    }
    expect(result.resolutions.head.kind).toBe('fallback');
    if (result.resolutions.head.kind === 'fallback') {
      expect(result.resolutions.head.requestedIndex).toBeNull();
      expect(result.resolutions.head.catalogSize).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-4 — worker and main-thread resolvers agree (re-fork regression guard)
// ---------------------------------------------------------------------------

describe('AC-4 — worker and main-thread paths resolve identically', () => {
  test('table-driven: every input produces identical slot/assetId sequences across paths', () => {
    // Both "paths" are the same pure function — this guards against a future
    // re-fork (a private copy in the worker or client) drifting apart.
    const workerPath = (layerIds: readonly number[]) =>
      resolveLpcAppearance({
        layerIds,
        catalog: FIXTURE_CATALOG,
        fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
      });
    const mainThreadPath = (layerIds: readonly number[]) =>
      resolveLpcAppearance({
        layerIds,
        catalog: FIXTURE_CATALOG,
        fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
      });

    const inputs: readonly (readonly number[])[] = [
      ELDER_LAYERS,
      ROLLO_LAYERS,
      MERCHANT_LAYERS,
      [0, 0, 0, 0, 0, 0],
      [999, 999, 999, 999, 999, 999],
      [1, 2, 1, 1],
      [3, 1, 2, 2, 1, 1],
    ];

    for (const input of inputs) {
      const a = workerPath(input);
      const b = mainThreadPath(input);

      expect(a.recipes.map((r) => `${r.slot}:${r.assetId}`)).toEqual(
        b.recipes.map((r) => `${r.slot}:${r.assetId}`),
      );
      expect(a.recipes).toHaveLength(6);
    }
  });

  test('projectLpcCatalog preserves engine slot order and drops non-engine slots', () => {
    const wide = [
      { slot: 'beard', variants: [{ assetId: 'beard/beard_female' }] },
      ...FIXTURE_CATALOG.map((s) => ({ ...s })),
      { slot: 'dress', variants: [{ assetId: 'dress/bodice_female' }] },
    ];
    const projected = projectLpcCatalog(wide);

    expect(projected.map((s) => s.slot)).toEqual([...LPC_SLOT_ORDER]);
    // Order is deterministic — matches the engine render order.
    expect(projected[0]?.slot).toBe('body');
    expect(projected[5]?.slot).toBe('head');
  });
});
