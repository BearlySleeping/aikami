// packages/frontend/engine/src/game_world/diagnostics.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  exposeEngineState,
  isE2ETestMode,
  isVisualScreenshotMode,
  publishEntityPosition,
  publishPlayerDebug,
  publishPlayerVisibleByMask,
  resetEntityPositions,
  resetVisualScreenshotModeCache,
} from './diagnostics.ts';

type FakeWindow = {
  n?: boolean;
  location: { search: string };
  [key: string]: unknown;
};

const globalWithWindow = globalThis as unknown as { window?: FakeWindow };

const setWindow = (value: FakeWindow | undefined): void => {
  globalWithWindow.window = value;
};

const makeWindow = (search = ''): FakeWindow => ({ location: { search } });

const debugRecord = (): Record<string, unknown> => {
  const fakeWindow = globalWithWindow.window;
  if (!fakeWindow) {
    throw new Error('test window not installed');
  }
  return (fakeWindow.__AIKAMI_DEBUG__ ?? {}) as Record<string, unknown>;
};

const engineStateGlobal = (): unknown => globalWithWindow.window?.__AIKAMI_ENGINE_STATE__;

describe('diagnostics — mode detection', () => {
  afterEach(() => {
    setWindow(undefined);
    resetVisualScreenshotModeCache();
  });

  test('E2E mode is off outside a browser', () => {
    setWindow(undefined);
    expect(isE2ETestMode()).toBe(false);
  });

  test('E2E mode reads the window.n Playwright flag', () => {
    setWindow({ ...makeWindow(), n: true });
    expect(isE2ETestMode()).toBe(true);
  });

  test('E2E mode reads the ?e2e=true param', () => {
    setWindow(makeWindow('?e2e=true'));
    expect(isE2ETestMode()).toBe(true);
  });

  test('screenshot mode is off by default and memoized', () => {
    const fake = makeWindow('?screenshot=true');
    setWindow(fake);
    expect(isVisualScreenshotMode()).toBe(true);
    // Mutating the URL after the first read must not change the cached result —
    // the page URL cannot change without a reload.
    fake.location.search = '';
    expect(isVisualScreenshotMode()).toBe(true);
  });
});

describe('diagnostics — debug globals', () => {
  beforeEach(() => {
    setWindow(makeWindow());
    resetEntityPositions();
  });

  afterEach(() => {
    setWindow(undefined);
    resetEntityPositions();
  });

  test('exposeEngineState writes the engine state global', () => {
    exposeEngineState({
      frozen: true,
      entityCount: 3,
      npcCount: 2,
      playerEntityId: 1,
      cameraX: 10,
      cameraY: 20,
    });
    const state = engineStateGlobal();
    expect(state).toEqual({
      frozen: true,
      entityCount: 3,
      npcCount: 2,
      playerEntityId: 1,
      cameraX: 10,
      cameraY: 20,
    });
  });

  test('publishPlayerDebug updates the debug object in place', () => {
    publishPlayerDebug({
      playerX: 1,
      playerY: 2,
      playerEid: 7,
      playerVisibleByMask: 1,
      npcCount: 0,
      npcAppearance: {},
    });
    const first = debugRecord();
    publishPlayerDebug({
      playerX: 3,
      playerY: 4,
      playerEid: 7,
      playerVisibleByMask: 0,
      npcCount: 1,
      npcAppearance: { npc: { body: 'a' } },
    });
    const second = debugRecord();
    expect(second).toBe(first);
    expect(second.playerX).toBe(3);
    expect(second.npcCount).toBe(1);
  });

  test('publishEntityPosition reuses the record for an entity', () => {
    publishEntityPosition(5, { x: 1, y: 2 });
    const positions = debugRecord().entityPositions as Record<string, { x: number; y: number }>;
    const record = positions['5'];
    publishEntityPosition(5, { x: 9, y: 8 });
    expect(positions['5']).toBe(record);
    expect(record).toEqual({ x: 9, y: 8 });
  });

  test('resetEntityPositions drops stale map entities', () => {
    publishEntityPosition(5, { x: 1, y: 2 });
    resetEntityPositions();
    const positions = debugRecord().entityPositions as Record<string, unknown>;
    expect(Object.keys(positions)).toHaveLength(0);
  });

  test('publishPlayerVisibleByMask only writes when a debug object exists', () => {
    publishPlayerVisibleByMask(3);
    expect(globalWithWindow.window?.__AIKAMI_DEBUG__).toBeUndefined();
    publishPlayerDebug({
      playerX: 0,
      playerY: 0,
      playerEid: 1,
      playerVisibleByMask: 0,
      npcCount: 0,
      npcAppearance: {},
    });
    publishPlayerVisibleByMask(3);
    expect(debugRecord().playerVisibleByMask).toBe(3);
  });
});
