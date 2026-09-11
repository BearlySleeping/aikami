// packages/frontend/engine/src/rendering/component_composer.test.ts
//
// Component composition tests (C-496 AC-2).
//
// Asserts the engine consumes component definitions: rig/body/pose
// compatibility rejection, deterministic multi-pass ordering independent of
// input order, and rear `/behind` + front passes emitted exactly once.

import { describe, expect, test } from 'bun:test';
import type { LpcLayerRecipe } from '@aikami/lpc';
import type { ComponentDefinition } from '@aikami/schemas';
import { composeComponentPasses, composeLpcRecipePasses } from './component_composer.ts';

const baseProps = {
  identity: { schemaVersion: 'visual.definition.1' as const, id: 'x', revision: 'r' },
  images: [
    {
      id: 'img',
      artifactRef: 'a',
      width: 64,
      height: 64,
      colorEncoding: 'rgba' as const,
      alpha: true,
    },
  ],
  frames: [
    {
      id: 'f0',
      imageId: 'img',
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      logicalWidth: 64,
      logicalHeight: 64,
      trimX: 0,
      trimY: 0,
      originX: -32,
      originY: -32,
    },
  ],
  clips: [{ name: 'idle.down', frames: [{ frameId: 'f0', durationMs: 100 }], loop: true }],
  presentation: { pixelDensity: 1, sampling: 'nearest' as const, colorOperation: 'none' as const },
  provenance: { source: 'fixture', licenses: ['MIT'] },
};

const makeComponent = (
  overrides: Partial<ComponentDefinition['component']> & { id: string },
): ComponentDefinition => {
  const { id, ...rest } = overrides;
  return {
    kind: 'component',
    ...baseProps,
    component: {
      id,
      rigProfile: 'universal',
      bodyProfile: 'adult',
      poseProfile: 'lpc.v1',
      order: 0,
      passes: [{ passId: 'front', clipName: 'idle.down', depth: 10, visible: true }],
      ...rest,
    },
  };
};

describe('composeComponentPasses (AC-2)', () => {
  test('compatible components emit passes in deterministic order', () => {
    const hat = makeComponent({ id: 'hat', order: 0 });
    const body = makeComponent({ id: 'body', order: 1 });
    const result = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [body, hat], // input order deliberately reversed
    });
    expect(result.rejected).toEqual([]);
    expect(result.passes.map((p) => p.componentId)).toEqual(['hat', 'body']);
  });

  test('rear `/behind` pass and front pass are both emitted once, ordered by depth', () => {
    const hat = makeComponent({
      id: 'hat',
      order: 0,
      passes: [
        { passId: 'behind', clipName: 'idle.down', depth: 2, visible: true },
        { passId: 'front', clipName: 'idle.down', depth: 10, visible: true },
      ],
    });
    const result = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [hat],
    });
    expect(result.passes.map((p) => p.passId)).toEqual(['behind', 'front']);
    // Each pass emitted exactly once.
    expect(result.passes.filter((p) => p.passId === 'behind')).toHaveLength(1);
    expect(result.passes.filter((p) => p.passId === 'front')).toHaveLength(1);
  });

  test('incompatible rig/body/pose is rejected with an actionable diagnostic', () => {
    const hat = makeComponent({ id: 'hat', rigProfile: 'child' });
    const result = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [hat],
    });
    expect(result.passes).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("rig 'child' != host 'universal'");
  });

  test('deterministic ordering is independent of async load order', () => {
    const a = makeComponent({
      id: 'a',
      order: 0,
      passes: [{ passId: 'p', clipName: 'idle.down', depth: 5, visible: true }],
    });
    const b = makeComponent({
      id: 'b',
      order: 0,
      passes: [{ passId: 'p', clipName: 'idle.down', depth: 3, visible: true }],
    });
    const c = makeComponent({
      id: 'c',
      order: 2,
      passes: [{ passId: 'p', clipName: 'idle.down', depth: 1, visible: true }],
    });

    const forward = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [c, a, b],
    });
    const reverse = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [b, c, a],
    });
    // Equal order → tie-break by depth (a:5, b:3 → b first).
    expect(forward.passes.map((p) => p.componentId)).toEqual(['b', 'a', 'c']);
    expect(reverse.passes.map((p) => p.componentId)).toEqual(['b', 'a', 'c']);
  });

  test('equal primary keys use component and pass ids as deterministic tie-breakers', () => {
    const alpha = makeComponent({
      id: 'alpha',
      passes: [
        { passId: 'front', clipName: 'idle.down', depth: 5, visible: true },
        { passId: 'behind', clipName: 'idle.down', depth: 5, visible: true },
      ],
    });
    const beta = makeComponent({
      id: 'beta',
      passes: [{ passId: 'front', clipName: 'idle.down', depth: 5, visible: true }],
    });

    const result = composeComponentPasses({
      hostRig: 'universal',
      hostBody: 'adult',
      hostPose: 'lpc.v1',
      components: [beta, alpha],
    });

    expect(result.passes.map((pass) => `${pass.componentId}:${pass.passId}`)).toEqual([
      'alpha:behind',
      'alpha:front',
      'beta:front',
    ]);
  });

  test('composeLpcRecipePasses produces a deterministic back-to-front render order (production consumer)', () => {
    const recipe = (slot: string, layerRole: 'behind' | 'front'): LpcLayerRecipe => ({
      slot,
      assetId: `${slot}.1`,
      hexPalette: new Uint8Array(1024),
      layerRole,
    });
    const recipes = [
      recipe('body', 'front'),
      recipe('hair', 'front'),
      recipe('cape', 'behind'), // rear pass must render behind body/hair
    ];
    const composition = composeLpcRecipePasses({ recipes });
    // All recipes render; rear `/behind` cape is ordered before front layers.
    expect(composition.order).toHaveLength(3);
    const capeIndex = recipes.findIndex((r) => r.slot === 'cape');
    const bodyIndex = recipes.findIndex((r) => r.slot === 'body');
    expect(composition.order.indexOf(capeIndex)).toBeLessThan(composition.order.indexOf(bodyIndex));
    // Deterministic regardless of input order.
    const reversedRecipes = [...recipes].reverse();
    const reversed = composeLpcRecipePasses({ recipes: reversedRecipes });
    const capes = reversed.order.map((i) => reversedRecipes[i].slot);
    expect(capes[0]).toBe('cape');
  });

  test('composeLpcRecipePasses preserves separate identities for duplicate slots', () => {
    const recipes: LpcLayerRecipe[] = [
      {
        slot: 'hair',
        assetId: 'hair/back',
        hexPalette: new Uint8Array(1024),
        layerRole: 'front',
      },
      {
        slot: 'hair',
        assetId: 'hair/front',
        hexPalette: new Uint8Array(1024),
        layerRole: 'front',
      },
    ];

    const composition = composeLpcRecipePasses({ recipes });

    expect(composition.order).toEqual([0, 1]);
    expect(new Set(composition.passes.map((pass) => pass.componentId)).size).toBe(2);
  });
});
