// packages/frontend/engine/src/game_world/debug_scene_overlay.test.ts
//
// Unit tests for the generic debug-scene projection: board geometry, token
// placement on the authoritative cell, and layer gating. These are the
// invariants a synthetic battlefield depends on, so they are asserted directly
// against the pure shape builders.
import { describe, expect, test } from 'bun:test';
import { Container } from 'pixi.js';
import {
  buildDebugSceneActorShapes,
  buildDebugSceneBoardShapes,
  clearDebugScene,
  type DebugSceneOverlayLayers,
  type DebugSceneShape,
  type DebugSceneSpec,
  renderDebugScene,
} from './debug_scene_overlay.ts';

const textOf = (shapes: readonly DebugSceneShape[]): string[] =>
  shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []));

const layers = (overrides: Partial<DebugSceneOverlayLayers> = {}): DebugSceneOverlayLayers => ({
  grid: true,
  coordinates: true,
  blocked: true,
  actorIds: false,
  reachable: false,
  targets: false,
  objects: true,
  worldOrigin: false,
  ...overrides,
});

const spec = (overrides: Partial<DebugSceneSpec> = {}): DebugSceneSpec => ({
  width: 8,
  height: 8,
  tileSize: 32,
  blockedCells: [],
  layers: layers(),
  ...overrides,
});

describe('debug_scene_overlay — board shapes', () => {
  test('the ground rect matches the declared board size', () => {
    const shapes = buildDebugSceneBoardShapes(spec({ width: 10, height: 8 }));
    const ground = shapes[0];
    expect(ground?.kind).toBe('rect');
    if (ground?.kind !== 'rect') {
      throw new Error('expected a ground rect');
    }
    expect(ground.width).toBe(10 * 32);
    expect(ground.height).toBe(8 * 32);
  });

  test('blocked cells are drawn only when the layer is enabled', () => {
    const blocked = [{ x: 2, y: 3 }];
    const enabled = buildDebugSceneBoardShapes(
      spec({ blockedCells: blocked, layers: layers({ blocked: true }) }),
    );
    const disabled = buildDebugSceneBoardShapes(
      spec({ blockedCells: blocked, layers: layers({ blocked: false }) }),
    );
    expect(enabled.length).toBeGreaterThan(disabled.length);

    const blockedRect = enabled.find(
      (shape) => shape.kind === 'rect' && shape.x === 2 * 32 && shape.y === 3 * 32,
    );
    expect(blockedRect).toBeDefined();
  });
});

describe('debug_scene_overlay — actor tokens', () => {
  test('a token centre is exactly the authoritative cell centre', () => {
    const shapes = buildDebugSceneActorShapes(
      spec({
        actors: [
          {
            id: 'goblin',
            label: 'Goblin',
            cell: { x: 4, y: 2 },
            team: 'enemy',
            hp: 6,
            maxHp: 12,
            active: false,
            selected: false,
            downed: false,
            defeated: false,
          },
        ],
      }),
    );
    const token = shapes.find((shape) => shape.kind === 'point' && shape.radius === 32 * 0.32);
    expect(token).toBeDefined();
    if (token?.kind !== 'point') {
      throw new Error('expected a token point');
    }
    expect(token.x).toBe((4 + 0.5) * 32);
    expect(token.y).toBe((2 + 0.5) * 32);
  });

  test('an active actor gets a distinct stroked ring', () => {
    const base = {
      id: 'player',
      label: 'Player',
      cell: { x: 0, y: 0 },
      team: 'player' as const,
      hp: 10,
      maxHp: 10,
      selected: false,
      downed: false,
      defeated: false,
    };
    const activeShapes = buildDebugSceneActorShapes(spec({ actors: [{ ...base, active: true }] }));
    const inactiveShapes = buildDebugSceneActorShapes(
      spec({ actors: [{ ...base, active: false }] }),
    );
    const activeToken = activeShapes.find(
      (shape) => shape.kind === 'point' && shape.radius === 32 * 0.32,
    );
    const inactiveToken = inactiveShapes.find(
      (shape) => shape.kind === 'point' && shape.radius === 32 * 0.32,
    );
    if (activeToken?.kind !== 'point' || inactiveToken?.kind !== 'point') {
      throw new Error('expected both tokens');
    }
    expect(activeToken.strokeWidth).toBeGreaterThan(inactiveToken.strokeWidth ?? 0);
  });

  test('actor ids appear only when the actorIds layer is enabled', () => {
    const actor = {
      id: 'emberwatch:goblin-1',
      label: 'Goblin',
      cell: { x: 1, y: 1 },
      team: 'enemy' as const,
      hp: 5,
      maxHp: 5,
      active: false,
      selected: false,
      downed: false,
      defeated: false,
    };
    const withIds = buildDebugSceneActorShapes(
      spec({ actors: [actor], layers: layers({ actorIds: true }) }),
    );
    const withoutIds = buildDebugSceneActorShapes(
      spec({ actors: [actor], layers: layers({ actorIds: false }) }),
    );
    expect(textOf(withIds).some((text) => text.includes('emberwatch:goblin-1'))).toBe(true);
    expect(textOf(withoutIds)).toEqual(['Goblin']);
  });

  test('defeated is the terminal label when an actor is also downed', () => {
    const actor = {
      id: 'goblin',
      label: 'Goblin',
      cell: { x: 1, y: 1 },
      team: 'enemy' as const,
      hp: 0,
      maxHp: 5,
      active: false,
      selected: false,
      downed: true,
      defeated: true,
    };
    const defeated = textOf(buildDebugSceneActorShapes(spec({ actors: [actor] })));
    const downed = textOf(
      buildDebugSceneActorShapes(spec({ actors: [{ ...actor, defeated: false }] })),
    );

    expect(defeated).toContain('Goblin (defeated)');
    expect(defeated).not.toContain('Goblin (downed)');
    expect(downed).toContain('Goblin (downed)');
  });
});

describe('debug_scene_overlay — rendering', () => {
  test('renders board and token layers and replaces the previous scene', () => {
    const worldContainer = new Container();
    renderDebugScene({ container: worldContainer, spec: spec() });
    expect(
      worldContainer.children.filter((child) => child.label?.startsWith('debug-scene')),
    ).toHaveLength(2);

    renderDebugScene({ container: worldContainer, spec: spec({ width: 4, height: 4 }) });
    expect(
      worldContainer.children.filter((child) => child.label?.startsWith('debug-scene')),
    ).toHaveLength(2);
  });

  test('clearDebugScene removes every debug-scene child', () => {
    const worldContainer = new Container();
    renderDebugScene({ container: worldContainer, spec: spec() });
    clearDebugScene(worldContainer);
    expect(
      worldContainer.children.filter((child) => child.label?.startsWith('debug-scene')),
    ).toHaveLength(0);
  });
});
