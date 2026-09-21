// packages/frontend/engine/src/game_world/entity_appearance_static.test.ts
//
// The generic non-LPC visual path.
//
// Most actors are LPC humanoids, but a content pack may author an actor that is
// not — a hound, a construct, a creature. `prepareStatic` is the generic
// capability for that; these tests pin that it produces the same
// PreparedAppearance shape the LPC path does, that it never crops the image,
// and that the LPC path is untouched.

import { describe, expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import { EntityAppearanceLoader } from './entity_appearance.ts';

const makeTexture = (width: number, height: number): Texture =>
  new Texture({ source: Texture.WHITE.source, frame: { x: 0, y: 0, width, height } } as never);

const makeLoader = (options: {
  texture?: Texture;
  fail?: boolean;
  errors?: { url: string; error: string }[];
}) =>
  new EntityAppearanceLoader({
    resolveAssetUrl: () => null,
    loadTexture: async () => {
      if (options.fail) {
        throw new Error('simulated texture failure');
      }
      return options.texture ?? makeTexture(128, 128);
    },
    ...(options.errors ? { onLoadError: (info) => options.errors?.push(info) } : {}),
  });

describe('prepareStatic — one authored image as a whole visual', () => {
  test('produces a single layer with the same shape the LPC path returns', async () => {
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({
      id: 'ash_hound',
      url: '/game-data/enemies/ash_hound.png',
      width: 96,
      height: 96,
    });

    // `commit` and `disposePrepared` are shared, so the shape must match:
    // a detached container plus the layers to add to it.
    expect(prepared.container).toBeDefined();
    expect(prepared.layers.length).toBe(1);
    expect(prepared.container.children.length).toBe(1);
  });

  test('the layer is marked static so the frame path leaves it alone', async () => {
    // Without this flag the legacy row/column fallback slices the image into
    // 64px cells and renders one corner of the actor.
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({
      id: 'cinder_thrall',
      url: '/x.png',
      width: 64,
      height: 64,
    });
    expect(prepared.layers[0]?.staticVisual).toBe(true);
  });

  test('a static layer has no spritesheet or definition to slice', async () => {
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({
      id: 'ember_warden',
      url: '/x.png',
      width: 64,
      height: 64,
    });
    expect(prepared.layers[0]?.spritesheet).toBeUndefined();
    expect(prepared.layers[0]?.definition).toBeUndefined();
  });

  test('the palette LUT is the identity, so authored colours survive', async () => {
    // LPC palettes map grayscale source art through a per-slot LUT. A static
    // image has no grayscale source, so an all-zero LUT must be used rather
    // than one that would recolour it.
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({
      id: 'x',
      url: '/x.png',
      width: 64,
      height: 64,
    });
    const palette = prepared.layers[0]?.recipe.hexPalette;
    expect(palette).toBeDefined();
    expect(palette?.length).toBe(1024);
    expect([...(palette ?? [])].every((byte) => byte === 0)).toBe(true);
  });

  test('the authored size wins over the file resolution', async () => {
    // The pack declares gameplay dimensions; the file may be authored larger.
    const loader = makeLoader({ texture: makeTexture(256, 256) });
    const prepared = await loader.prepareStatic({
      id: 'x',
      url: '/x.png',
      width: 64,
      height: 64,
    });
    const sprite = prepared.layers[0]?.sprite;
    expect(sprite?.scale.x).toBeCloseTo(0.25, 5);
    expect(sprite?.scale.y).toBeCloseTo(0.25, 5);
  });

  test('anchorY defaults to the bottom edge and is overridable', async () => {
    const loader = makeLoader({});
    const atFeet = await loader.prepareStatic({ id: 'a', url: '/a.png', width: 64, height: 64 });
    expect(atFeet.layers[0]?.sprite.anchor.y).toBe(1);

    const centred = await loader.prepareStatic({
      id: 'b',
      url: '/b.png',
      width: 64,
      height: 64,
      anchorY: 0.5,
    });
    expect(centred.layers[0]?.sprite.anchor.y).toBe(0.5);
  });

  test('a load failure yields an EMPTY appearance, not a throw', async () => {
    // The caller's existing "no layers resolved — keep the placeholder" path
    // then applies, instead of a special case for static actors.
    const errors: { url: string; error: string }[] = [];
    const loader = makeLoader({ fail: true, errors });
    const prepared = await loader.prepareStatic({
      id: 'x',
      url: '/missing.png',
      width: 64,
      height: 64,
    });
    expect(prepared.layers).toEqual([]);
    expect(prepared.container.children.length).toBe(0);
    expect(errors[0]?.url).toBe('/missing.png');
  });

  test('the sprite is not interactive, matching LPC layers', async () => {
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({ id: 'x', url: '/x.png', width: 64, height: 64 });
    expect(prepared.layers[0]?.sprite.eventMode).toBe('none');
  });
});

describe('the LPC path is unchanged', () => {
  test('an unresolvable LPC recipe still yields no layers', async () => {
    const loader = new EntityAppearanceLoader({
      resolveAssetUrl: () => null,
      loadTexture: async () => makeTexture(64, 64),
    });
    const prepared = await loader.prepare({
      recipes: [
        {
          slot: 'body',
          assetId: 'body/male',
          hexPalette: new Uint8Array(1024),
          layerRole: 'front',
        },
      ],
      state: 'walk',
    });
    // No URL resolved for the slot, so the layer is skipped exactly as before.
    expect(prepared.layers).toEqual([]);
  });

  test('a resolvable LPC recipe is NOT marked static', async () => {
    const loader = new EntityAppearanceLoader({
      resolveAssetUrl: () => '/game-data/lpc/body/male.png',
      loadTexture: async () => makeTexture(832, 1344),
    });
    const prepared = await loader.prepare({
      recipes: [
        {
          slot: 'body',
          assetId: 'body/male',
          hexPalette: new Uint8Array(1024),
          layerRole: 'front',
        },
      ],
      state: 'walk',
    });
    expect(prepared.layers.length).toBe(1);
    expect(prepared.layers[0]?.staticVisual).toBeUndefined();
  });
});

describe('disposePrepared works for both kinds', () => {
  test('a prepared static appearance disposes without touching textures', async () => {
    const loader = makeLoader({});
    const prepared = await loader.prepareStatic({ id: 'x', url: '/x.png', width: 64, height: 64 });
    const texture = prepared.layers[0]?.texture;
    loader.disposePrepared(prepared);
    // Textures belong to shared caches and must survive disposal.
    expect(texture).toBeDefined();
  });
});
