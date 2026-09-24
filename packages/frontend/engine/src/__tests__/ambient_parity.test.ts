// packages/frontend/engine/src/__tests__/ambient_parity.test.ts
//
// C-545 — ambient parity for terrain, props, actors and enemies.
//
// Behavioural coverage for the one documented ambient policy:
//   • a neutral-grey terrain tile and a neutral-grey prop/actor receive the
//     same multiplier at noon / dawn / night / interior;
//   • interiors ignore the outdoor clock;
//   • an emissive prop (lit hearth/brazier) is untouched;
//   • a texture that loads AFTER the hour changed still gets the current tint;
//   • a transition (hour change or interior change) re-tints live entities.
//
// The tests use real PixiJS containers — container tint cascades to children,
// which is exactly the mechanism the engine relies on.

import { describe, expect, test } from 'bun:test';
import { Container, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { EngineBridge } from '../engine_bridge.ts';
import {
  ambientToHex,
  applyAmbientToEntity,
  NEUTRAL_SCENE_AMBIENT,
  resolveSceneAmbient,
} from '../environment/ambient_policy.ts';
import {
  COLOR_DAWN,
  COLOR_INTERIOR,
  COLOR_NIGHT_FLOOR,
  COLOR_NOON,
  ENV_UBO_OFFSETS,
} from '../environment/environment_ubo.ts';
import type { RenderEntry } from '../game_world/render_entry.ts';
import { SceneAmbientController } from '../game_world/scene_ambient.ts';
import type { PropFrameAnchor } from '../game_world/scene_transition.ts';
import type { GameWorld as GameWorldInstance, GameWorldOptions } from '../game_world.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';
import type { EntityCreatedMessage } from '../worker/worker_protocol.ts';

process.env.PUBLIC_APP_ID = 'client';
process.env.PUBLIC_MODE = 'testing';

const { MockEngineBridge } = await import('../engine_bridge.ts');
const { GameWorld } = await import('../game_world.ts');

/** Builds a worker-style environment UBO whose ambient is `rgb`. */
const ambientUbo = (rgb: readonly number[]): Float32Array => {
  const ubo = new Float32Array(12);
  ubo[ENV_UBO_OFFSETS.ambientColor + 0] = rgb[0] ?? 1;
  ubo[ENV_UBO_OFFSETS.ambientColor + 1] = rgb[1] ?? 1;
  ubo[ENV_UBO_OFFSETS.ambientColor + 2] = rgb[2] ?? 1;
  ubo[ENV_UBO_OFFSETS.ambientIntensity] = 1;
  return ubo;
};

const tilemapUniforms = (): UniformGroup =>
  new UniformGroup({
    uTint: { value: new Float32Array([0.1, 0.2, 0.3, 1]), type: 'vec4<f32>' },
  });

type GameWorldAmbientHarness = {
  _app: { stage: Container };
  _worldContainer: Container;
  _propFrameMeta: Map<string, PropFrameAnchor>;
  _renderEntries: Map<number, RenderEntry>;
  _sceneAmbient: SceneAmbientController;
  _handleEntityCreated(message: EntityCreatedMessage): void;
  _installScene(scene: {
    packConfig: undefined;
    terrainGrid: TerrainGrid;
    activePathGrid: TerrainGrid;
    propFrameMeta: Map<string, PropFrameAnchor>;
  }): void;
};

const createGameWorldAmbientHarness = (): GameWorldAmbientHarness => {
  const bridge: EngineBridge = new MockEngineBridge();
  const options: GameWorldOptions = {
    className: 'GameWorld',
    bridge,
    propFrameResolver: (frame) => ({ frame, texture: Texture.WHITE, source: 'hit' }),
  };
  const world = GameWorld.create(options) as unknown as GameWorldInstance;
  const harness = world as unknown as GameWorldAmbientHarness;
  const stage = new Container();
  harness._app = { stage };
  harness._worldContainer = new Container();
  stage.addChild(harness._worldContainer);
  return harness;
};

type LightingState = {
  name: string;
  options: { isInterior: boolean; environmentUbo: Float32Array | undefined };
  expected: readonly number[];
};

const LIGHTING_STATES: LightingState[] = [
  {
    name: 'noon',
    options: { isInterior: false, environmentUbo: ambientUbo(COLOR_NOON) },
    expected: COLOR_NOON,
  },
  {
    name: 'dawn',
    options: { isInterior: false, environmentUbo: ambientUbo(COLOR_DAWN) },
    expected: COLOR_DAWN,
  },
  {
    name: 'night',
    // The worker UBO already carries the C-417 night readability floor.
    options: { isInterior: false, environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR) },
    expected: COLOR_NIGHT_FLOOR,
  },
  {
    name: 'interior',
    // An interior resolves to the fixed warm colour regardless of the clock.
    options: { isInterior: true, environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR) },
    expected: COLOR_INTERIOR,
  },
];

const Epsilon = 0.001;

describe('C-545 — terrain and entities share one ambient multiplier', () => {
  for (const state of LIGHTING_STATES) {
    test(`${state.name}: a neutral-grey terrain tile and a neutral-grey prop match`, () => {
      // Terrain: drive the controller, then read back what it wrote into the
      // shader's uTint. The stub starts at a non-matching value so a controller
      // that failed to write cannot pass by accident.
      const uniforms = tilemapUniforms();
      const controller = new SceneAmbientController();
      controller.update({ ...state.options, tilemapUniforms: uniforms, freeze: false });
      const written = uniforms.uniforms.uTint as Float32Array;
      const [tr, tg, tb] = [written[0] ?? -1, written[1] ?? -1, written[2] ?? -1];

      expect(tr).toBeCloseTo(state.expected[0] ?? 1, 3);
      expect(tg).toBeCloseTo(state.expected[1] ?? 1, 3);
      expect(tb).toBeCloseTo(state.expected[2] ?? 1, 3);
      // The stub was actually overwritten (not left at its sentinel).
      expect(tr).not.toBe(-1);

      // Prop/actor: the SAME controller tints the container, packed to RGB.
      const prop = new Container();
      prop.addChild(new Sprite(Texture.WHITE));
      const entry: RenderEntry = {
        displayObject: prop,
        spawnOrder: 1,
        tint: 0xffffff,
        cullable: true,
      };
      controller.applyToEntries([entry]);

      // Channel-for-channel equality between the two consumption paths.
      const hex = prop.tint;
      expect((hex >> 16) & 0xff).toBe(Math.round(tr * 255));
      expect((hex >> 8) & 0xff).toBe(Math.round(tg * 255));
      expect(hex & 0xff).toBe(Math.round(tb * 255));

      // A 0.5 mid-grey texel and its prop counterpart darken identically.
      const grey = 0.5;
      const terrainGrey = grey * tr;
      const propGrey = grey * (((hex >> 16) & 0xff) / 255);
      expect(Math.abs(terrainGrey - propGrey)).toBeLessThan(Epsilon);
    });
  }

  test('interior ignores the outdoor clock', () => {
    const atNoon = resolveSceneAmbient({
      isInterior: true,
      environmentUbo: ambientUbo(COLOR_NOON),
    });
    const atMidnight = resolveSceneAmbient({
      isInterior: true,
      environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR),
    });
    expect(atNoon).toEqual(atMidnight);
    expect(atNoon.hex).toBe(
      ambientToHex(COLOR_INTERIOR[0] ?? 1, COLOR_INTERIOR[1] ?? 1, COLOR_INTERIOR[2] ?? 1),
    );
  });

  test('before the worker UBO arrives the scene stays neutral', () => {
    const ambient = resolveSceneAmbient({ isInterior: false, environmentUbo: undefined });
    expect(ambient).toEqual(NEUTRAL_SCENE_AMBIENT);
    expect(ambient.hex).toBe(0xffffff);
  });
});

describe('C-545 — emissive opt-out', () => {
  test('an emissive prop keeps its authored colour at night', () => {
    const nightAmbient = resolveSceneAmbient({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR),
    });
    const hearth = new Container();
    const sprite = new Sprite(Texture.WHITE);
    hearth.addChild(sprite);

    const changed = applyAmbientToEntity({
      displayObject: hearth,
      ambient: nightAmbient,
      exempt: true,
    });

    expect(changed).toBe(false);
    expect(hearth.tint).toBe(0xffffff);
    expect(sprite.getGlobalTint()).toBe(0xffffff);
  });

  test('re-announcing an ECS identity replaces its previous display', () => {
    const world = createGameWorldAmbientHarness();
    world._handleEntityCreated({ type: 'ENTITY_CREATED', eid: 42, tint: 0xffffff });
    const firstDisplay = world._renderEntries.get(42)?.displayObject;
    expect(firstDisplay).toBeDefined();

    world._handleEntityCreated({ type: 'ENTITY_CREATED', eid: 42, tint: 0xffffff });

    expect(firstDisplay?.destroyed).toBe(true);
    expect(
      world._worldContainer.children.filter((child) => child.label === 'entity-42'),
    ).toHaveLength(1);
  });

  test('GameWorld keeps an entity with emissive frame metadata untinted', () => {
    const world = createGameWorldAmbientHarness();
    world._propFrameMeta.set('prop_hearth.png', {
      anchorX: 0.5,
      anchorY: 1,
      emissive: true,
    });
    // A sibling prop whose frame carries no emissive metadata.
    world._propFrameMeta.set('prop_barrel.png', { anchorX: 0.5, anchorY: 1 });

    for (const [eid, frame] of [
      [42, 'prop_hearth.png'],
      [43, 'prop_barrel.png'],
    ] as const) {
      world._handleEntityCreated({ type: 'ENTITY_CREATED', eid, tint: 0xffffff, frame });
    }

    world._sceneAmbient.update({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR),
      tilemapUniforms: tilemapUniforms(),
      freeze: false,
    });
    world._sceneAmbient.applyToEntries(world._renderEntries.values());

    const nightHex = ambientToHex(
      COLOR_NIGHT_FLOOR[0] ?? 1,
      COLOR_NIGHT_FLOOR[1] ?? 1,
      COLOR_NIGHT_FLOOR[2] ?? 1,
    );
    // The emissive prop is untouched…
    expect(world._renderEntries.get(42)?.displayObject.tint).toBe(0xffffff);
    // …while its non-emissive sibling receives the SAME ambient as terrain.
    expect(world._renderEntries.get(43)?.displayObject.tint).toBe(nightHex);
  });
});

describe('C-545 — deterministic ambient sampling', () => {
  test('frozen sampling waits for both terrain uniforms and the outdoor UBO', () => {
    const controller = new SceneAmbientController();
    const prop = new Container();
    const entry: RenderEntry = {
      displayObject: prop,
      spawnOrder: 1,
      tint: 0xffffff,
      cullable: true,
    };
    const nightUbo = ambientUbo(COLOR_NIGHT_FLOOR);

    controller.update({
      isInterior: false,
      environmentUbo: nightUbo,
      tilemapUniforms: undefined,
      freeze: true,
    });
    controller.applyToEntries([entry]);
    expect(prop.tint).toBe(0xffffff);

    const uniforms = tilemapUniforms();
    controller.update({
      isInterior: false,
      environmentUbo: undefined,
      tilemapUniforms: uniforms,
      freeze: true,
    });
    controller.applyToEntries([entry]);
    expect(uniforms.uniforms.uTint).toEqual(new Float32Array([0.1, 0.2, 0.3, 1]));
    expect(prop.tint).toBe(0xffffff);

    controller.update({
      isInterior: false,
      environmentUbo: nightUbo,
      tilemapUniforms: uniforms,
      freeze: true,
    });
    controller.applyToEntries([entry]);
    expect(prop.tint).toBe(
      ambientToHex(COLOR_NIGHT_FLOOR[0] ?? 1, COLOR_NIGHT_FLOOR[1] ?? 1, COLOR_NIGHT_FLOOR[2] ?? 1),
    );
  });

  test('installing a scene invalidates the frozen sample for its new terrain uniform', () => {
    const world = createGameWorldAmbientHarness();
    const oldUniforms = tilemapUniforms();
    world._sceneAmbient.update({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_NOON),
      tilemapUniforms: oldUniforms,
      freeze: true,
    });

    const terrainGrid: TerrainGrid = {
      width: 1,
      height: 1,
      tileSize: 32,
      cost: new Uint8Array([16]),
      blocksSight: new Uint8Array([0]),
    };
    world._installScene({
      packConfig: undefined,
      terrainGrid,
      activePathGrid: terrainGrid,
      propFrameMeta: new Map(),
    });

    const newUniforms = tilemapUniforms();
    world._sceneAmbient.update({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_NOON),
      tilemapUniforms: newUniforms,
      freeze: true,
    });
    const tint = newUniforms.uniforms.uTint as Float32Array;
    expect(tint[0]).toBeCloseTo(COLOR_NOON[0] ?? 1, 3);
  });
});

describe('C-545 — late-load textures and transitions', () => {
  test('a prop whose texture arrives after the hour changed gets the current tint', () => {
    const dawnAmbient = resolveSceneAmbient({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_DAWN),
    });
    const prop = new Container();
    const placeholder = new Sprite(Texture.WHITE);
    prop.addChild(placeholder);
    applyAmbientToEntity({ displayObject: prop, ambient: dawnAmbient });

    // The authored frame resolves later and replaces the placeholder.
    prop.removeChild(placeholder);
    placeholder.destroy();
    const lateTexture = new Sprite(Texture.WHITE);
    prop.addChild(lateTexture);

    expect(prop.tint).toBe(dawnAmbient.hex);
    expect(lateTexture.getGlobalTint()).toBe(dawnAmbient.hex);
  });

  test('an interior transition re-tints every live entity', () => {
    const prop = new Container();
    prop.addChild(new Sprite(Texture.WHITE));

    applyAmbientToEntity({
      displayObject: prop,
      ambient: resolveSceneAmbient({ isInterior: false, environmentUbo: ambientUbo(COLOR_NOON) }),
    });
    const noonHex = prop.tint;

    applyAmbientToEntity({
      displayObject: prop,
      ambient: resolveSceneAmbient({
        isInterior: false,
        environmentUbo: ambientUbo(COLOR_NIGHT_FLOOR),
      }),
    });
    const nightHex = prop.tint;

    applyAmbientToEntity({
      displayObject: prop,
      ambient: resolveSceneAmbient({ isInterior: true, environmentUbo: undefined }),
    });
    const interiorHex = prop.tint;

    expect(noonHex).not.toBe(nightHex);
    expect(nightHex).not.toBe(interiorHex);
    expect(interiorHex).toBe(
      ambientToHex(COLOR_INTERIOR[0] ?? 1, COLOR_INTERIOR[1] ?? 1, COLOR_INTERIOR[2] ?? 1),
    );
  });

  test('re-applying the same ambient is a no-op', () => {
    const ambient = resolveSceneAmbient({
      isInterior: false,
      environmentUbo: ambientUbo(COLOR_NOON),
    });
    const prop = new Container();
    applyAmbientToEntity({ displayObject: prop, ambient });
    expect(applyAmbientToEntity({ displayObject: prop, ambient })).toBe(false);
  });
});
