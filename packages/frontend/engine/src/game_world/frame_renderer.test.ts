// packages/frontend/engine/src/game_world/frame_renderer.test.ts

import { describe, expect, test } from 'bun:test';
import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { Application } from 'pixi.js';
import { Container } from 'pixi.js';
import { AnimationController } from '../rendering/animation_controller.ts';
import type { StateUpdateMessage } from '../worker/worker_protocol.ts';
import { FrameRenderer, type FrameRenderOptions } from './frame_renderer.ts';
import { RenderBufferPool } from './render_buffer_pool.ts';
import type { RenderEntry } from './render_entry.ts';

const fakeApp = (): Application =>
  ({
    screen: { width: 800, height: 600 },
    renderer: { resolution: 1 },
    canvas: { width: 800, height: 600 },
    // guard-ignore lint/type-safety/casting: minimal Application surface used by the renderer
  }) as unknown as Application;

const feed = (
  pool: RenderBufferPool,
  values: [number, number],
  options?: { tick?: number; simTimeMs?: number; now?: number },
): void => {
  // Entity 1 starts at index 3 (COMPONENT_STRIDE = 3).
  const floats = new Float32Array(5);
  floats[3] = values[0];
  floats[4] = values[1];
  const buffer = floats.buffer;
  const message: StateUpdateMessage = {
    type: 'STATE_UPDATE',
    buffer,
    tick: options?.tick ?? 1,
    simTimeMs: options?.simTimeMs ?? 10,
    stepMs: 16,
  };
  pool.ingest({
    message,
    previousCamera: { x: 0, y: 0 },
    now: options?.now ?? 0,
    recycle: () => {},
  });
};

const makeEntry = (): RenderEntry => ({
  displayObject: new Container(),
  spawnOrder: 1,
  animationController: new AnimationController(),
  tint: 0xffffff,
  cullable: true,
});

const defaultOptions = (
  pool: RenderBufferPool,
  entries: Map<number, RenderEntry>,
): FrameRenderOptions => ({
  app: fakeApp(),
  worldContainer: new Container(),
  renderEntries: entries,
  bufferPool: pool,
  camera: { x: 0, y: 0, zoom: 1 },
  deltaMs: 16,
  playerEntityId: 1,
  playerVisibleByMask: 0,
  npcCount: 0,
  npcAppearance: {},
  tilemapChunks: undefined,
  onRenderLog: () => {},
});

describe('FrameRenderer — entity transform', () => {
  test('no-ops until a state buffer arrives', () => {
    const renderer = new FrameRenderer({});
    const pool = new RenderBufferPool();
    const entry = makeEntry();
    renderer.render(defaultOptions(pool, new Map([[1, entry]])));
    expect(entry.displayObject.x).toBe(0);
  });

  test('applies interpolated positions and z-depth to entries', () => {
    const renderer = new FrameRenderer({});
    const pool = new RenderBufferPool();
    feed(pool, [123, 456]);
    const entry = makeEntry();
    const options = defaultOptions(pool, new Map([[1, entry]]));
    renderer.render(options);

    expect(entry.displayObject.x).toBe(123);
    expect(entry.displayObject.y).toBe(456);
    expect(entry.displayObject.zIndex).toBeGreaterThan(0);
    expect(entry.displayObject.visible).toBe(true);
  });
});

describe('FrameRenderer — camera transform', () => {
  test('centers the world container on the camera at the zoomed scale', () => {
    const renderer = new FrameRenderer({});
    const pool = new RenderBufferPool();
    feed(pool, [0, 0]);
    const worldContainer = new Container();
    const options = {
      ...defaultOptions(pool, new Map()),
      worldContainer,
      camera: { x: 100, y: 50, zoom: 1.5 },
    };
    const scale = BASE_WORLD_SCALE * 1.5;
    renderer.render(options);

    // screen center minus camera*scale, snapped to whole device pixels.
    expect(worldContainer.x).toBeCloseTo(800 / 2 - 100 * scale, 0);
    expect(worldContainer.y).toBeCloseTo(600 / 2 - 50 * scale, 0);
    expect(worldContainer.scale.x).toBe(scale);
  });
});

describe('FrameRenderer — diagnostics throttle', () => {
  test('logs at most once per interval', () => {
    const renderer = new FrameRenderer({ now: () => 2000 });
    const pool = new RenderBufferPool();
    feed(pool, [1, 1]);
    const logs: string[] = [];
    const options = defaultOptions(pool, new Map([[1, makeEntry()]]));
    options.onRenderLog = (message) => logs.push(message);

    renderer.render(options);
    renderer.render(options);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('visible');
  });
});
