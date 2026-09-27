// apps/frontend/client/src/lib/utils/appearance_layers.test.ts
//
// Unit tests for the base-appearance → layer-index projection.
//
// The regression this guards: the boot path used to carry a literal
// `{ body: 3, hair: 3, legs: 22, head: 95 }` fallback table. With an empty
// catalog every slot missed and the character rendered as
// `appearanceLayers = [3, 3, 0, 22, 0, 95]` — a bare chest on a CHILD body.
// Indices must now be derived from assets the catalog actually serves, and an
// unresolvable slot must be omitted and reported, never invented.

import { describe, expect, test } from 'bun:test';
import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import { APPEARANCE_LAYER_SLOT_ORDER, buildAppearanceLayerIndices } from './appearance_layers';

type Slot = { slot: string; variants: readonly { assetId: string }[] };

/** A catalog slot holding `assetIds` in the given order. */
const slot = (name: string, assetIds: readonly string[]): Slot => ({
  slot: name,
  variants: assetIds.map((assetId) => ({ assetId })),
});

/**
 * A catalog that serves every {@link DEFAULT_LPC_RECIPE} asset, plus the child
 * / `female_small` assets the old magic indices used to land on.
 */
const catalogWithDefaults = (): Slot[] => [
  slot('body', ['body/bodies_male', 'body/bodies_female', 'body/bodies_child']),
  slot('hair', ['hair/bangs_adult', 'hair/bangs_child']),
  slot('torso', ['torso/clothes/longsleeve/longsleeve_male']),
  slot('legs', ['legs/pants_male', 'legs/pants_child']),
  slot('feet', ['feet/shoes/basic_male']),
  slot('head', ['head/heads/human_male', 'head/heads/human/female_small']),
];

describe('buildAppearanceLayerIndices', () => {
  test('resolves each recipe asset to its 1-indexed variant position', () => {
    const slots = catalogWithDefaults();
    const { layers, unresolved } = buildAppearanceLayerIndices({
      slots,
      recipe: {
        body: 'body/bodies_female',
        hair: 'hair/bangs_adult',
        torso: 'torso/clothes/longsleeve/longsleeve_male',
        legs: 'legs/pants_male',
        feet: 'feet/shoes/basic_male',
        head: 'head/heads/human_male',
      },
    });

    // body index 2 → layer 2; the rest sit at variant 0 → layer 1.
    expect(layers).toEqual([2, 1, 1, 1, 1, 1]);
    expect(unresolved).toEqual([]);
  });

  test('emits one layer per engine slot, in APPEARANCE_LAYER_SLOT_ORDER order', () => {
    const { layers } = buildAppearanceLayerIndices({
      slots: catalogWithDefaults(),
      recipe: DEFAULT_LPC_RECIPE,
    });

    expect(layers).toHaveLength(APPEARANCE_LAYER_SLOT_ORDER.length);
    expect(APPEARANCE_LAYER_SLOT_ORDER).toEqual(['body', 'hair', 'torso', 'legs', 'feet', 'head']);
  });

  test('an EMPTY catalog yields all-zero layers — never a guessed index', () => {
    const { layers, unresolved } = buildAppearanceLayerIndices({
      slots: [],
      recipe: DEFAULT_LPC_RECIPE,
    });

    expect(layers).toEqual([0, 0, 0, 0, 0, 0]);
    // Every requested slot is reported, so the caller can warn loudly.
    expect(unresolved.map((miss) => miss.slot)).toEqual([
      'body',
      'hair',
      'torso',
      'legs',
      'feet',
      'head',
    ]);
    expect(unresolved.every((miss) => miss.reason === 'slot-missing-from-catalog')).toBe(true);
  });

  test('no layer resolves to a *_child / *_small asset for an adult recipe', () => {
    const slots = catalogWithDefaults();
    const { layers } = buildAppearanceLayerIndices({ slots, recipe: DEFAULT_LPC_RECIPE });

    APPEARANCE_LAYER_SLOT_ORDER.forEach((slotName, i) => {
      const layer = layers[i] ?? 0;
      const assetId = slots.find((s) => s.slot === slotName)?.variants[layer - 1]?.assetId;
      expect(assetId ?? '').not.toMatch(/child|small/);
    });
  });

  test('an unresolvable asset falls back to DEFAULT_LPC_RECIPE for that slot', () => {
    const slots = catalogWithDefaults();
    const { layers } = buildAppearanceLayerIndices({
      slots,
      // `body` names an asset this catalog does not serve.
      recipe: { ...DEFAULT_LPC_RECIPE, body: 'body/bodies_elf' },
    });

    // DEFAULT_LPC_RECIPE.body is bodies_male → variant 0 → layer 1.
    expect(layers[0]).toBe(1);
  });

  test('a slot absent from the recipe resolves the default rather than 0', () => {
    const slots = catalogWithDefaults();
    const recipe: Record<string, string> = { ...DEFAULT_LPC_RECIPE };
    delete recipe.torso;

    const { layers, unresolved } = buildAppearanceLayerIndices({ slots, recipe });

    // A missing slot is not a miss — the default is substituted and nothing is
    // reported, so the character is never left bare-chested.
    expect(layers[2]).toBe(1);
    expect(unresolved).toEqual([]);
  });

  test('reports a slot that neither the recipe nor the default can resolve', () => {
    // A catalog with a `torso` slot that serves neither the recipe's asset nor
    // the default one.
    const slots = [
      slot('body', ['body/bodies_male']),
      slot('hair', ['hair/bangs_adult']),
      slot('torso', ['torso/chainmail_male']),
      slot('legs', ['legs/pants_male']),
      slot('feet', ['feet/shoes/basic_male']),
      slot('head', ['head/heads/human_male']),
    ];

    const { layers, unresolved } = buildAppearanceLayerIndices({
      slots,
      recipe: { ...DEFAULT_LPC_RECIPE, torso: 'torso/clothes/robe_female' },
    });

    expect(layers[2]).toBe(0);
    expect(unresolved).toEqual([
      {
        slot: 'torso',
        requestedAssetId: 'torso/clothes/robe_female',
        reason: 'asset-missing-from-catalog',
      },
    ]);
  });

  test('is deterministic — repeated calls on the same input agree', () => {
    const slots = catalogWithDefaults();
    const recipe = { ...DEFAULT_LPC_RECIPE, head: 'head/heads/human/female_small' };
    const first = buildAppearanceLayerIndices({ slots, recipe });
    const second = buildAppearanceLayerIndices({ slots, recipe });

    expect(first.layers).toEqual(second.layers);
    expect(first.unresolved).toEqual(second.unresolved);
  });
});
