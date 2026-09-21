// apps/frontend/client/src/lib/views/dev/sandbox/camera/camera_sandbox_view_model.test.ts
//
// C-161: Camera & Spatial UI sandbox ViewModel tests.
//
// Exercises the ViewModel through feature-owned capability fixtures — the real
// engine is never imported and no `$services` barrel is touched.

import { describe, expect, mock, test } from 'bun:test';
import type { EngineBridge, GameWorld, GameWorldOptions } from '@aikami/frontend/engine';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  type CameraSandboxEngineCapabilities,
  createCameraSandboxViewModel,
  type GameModeCapabilities,
} from './camera_sandbox_view_model.svelte';

type Npc = { npcName: string; eid: number };

const createBridge = () => {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  return {
    on: (event: string, callback: (payload: never) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(callback);
      listeners.set(event, set);
      return () => set.delete(callback);
    },
    send: mock(() => {}),
    emit: (event: string, payload?: unknown) => {
      for (const callback of listeners.get(event) ?? []) {
        callback(payload as never);
      }
    },
  };
};

const createWorld = () => {
  let interact: ((npc: Npc) => void) | undefined;
  return {
    initialize: mock(async () => {}),
    destroy: mock(() => {}),
    loadMap: mock(async () => {}),
    onInteractRequest: (callback: (npc: Npc) => void) => {
      interact = callback;
    },
    triggerInteract: (npc: Npc) => interact?.(npc),
  };
};

const createEngine = (
  options: { loadContentPack?: CameraSandboxEngineCapabilities['loadContentPack'] } = {},
) => {
  const bridge = createBridge();
  const world = createWorld();
  const engine: CameraSandboxEngineCapabilities = {
    createBridge: () => bridge as unknown as EngineBridge,
    createWorld: (_worldOptions: GameWorldOptions) => world as unknown as GameWorld,
    createTextureManager: () => ({}) as never,
    resolveEcsWorker: mock(async () => class {} as unknown as new () => Worker),
    assetUrlResolver: () => null,
    resolveTag: () => null,
    releaseUrl: mock(() => {}),
    loadContentPack:
      options.loadContentPack ??
      mock(async () => ({ resolveMapUrl: (mapId: string) => `/packs/${mapId}.json` })),
  };
  return { engine, bridge, world };
};

const createMode = (overrides: Partial<GameModeCapabilities> = {}): GameModeCapabilities => ({
  setMode: mock(() => {}),
  ...overrides,
});

const createCanvas = () =>
  ({
    clientWidth: 800,
    clientHeight: 600,
  }) as unknown as HTMLCanvasElement;

const createViewModel = (
  engine: CameraSandboxEngineCapabilities = createEngine().engine,
  mode: GameModeCapabilities = createMode(),
) =>
  createCameraSandboxViewModel({
    className: 'CameraSandboxViewModel',
    engine,
    mode,
  });

describe('CameraSandboxViewModel — initial state', () => {
  test('starts with camera devtool defaults', () => {
    const viewModel = createViewModel();

    expect(viewModel.engineReady).toBe(false);
    expect(viewModel.cameraZoom).toBe(1.0);
    expect(viewModel.npcScreenX).toBe(-1);
    expect(viewModel.npcScreenY).toBe(-1);
    expect(viewModel.mockDialogueActive).toBe(false);
    expect(viewModel.debugLog).toEqual([]);
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});

describe('CameraSandboxViewModel — engine lifecycle', () => {
  test('initializeEngine wires the engine and loads the zone on ready', async () => {
    const { engine, bridge, world } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    expect(world.initialize).toHaveBeenCalledTimes(1);

    bridge.emit('GAME_READY');
    await Promise.resolve();
    await Promise.resolve();

    expect(viewModel.engineReady).toBe(true);
    expect(engine.loadContentPack).toHaveBeenCalledWith(
      expect.objectContaining({ packId: 'emberwatch' }),
    );
    expect(world.loadMap).toHaveBeenCalledWith(
      expect.objectContaining({ mapUrl: '/packs/village.json', targetX: 160, targetY: 192 }),
    );
    expect(viewModel.currentMap).toBe('village');
  });

  test('ensure load errors surface through engineError', async () => {
    const { engine, bridge } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    bridge.emit('GAME_ERROR', { message: 'boom' });

    expect(viewModel.engineError).toBe('boom');
  });
});

describe('CameraSandboxViewModel — mock dialogue', () => {
  test('toggle/end drive the injected game mode', async () => {
    const { engine, bridge } = createEngine();
    const setMode = mock(() => {});
    const viewModel = createViewModel(engine, createMode({ setMode }));

    await viewModel.initializeEngine(createCanvas());
    bridge.emit('GAME_READY');
    await Promise.resolve();

    viewModel.toggleMockDialogue();
    expect(viewModel.mockDialogueActive).toBe(true);
    expect(setMode).toHaveBeenCalledWith('DIALOGUE');

    viewModel.endMockDialogue();
    expect(viewModel.mockDialogueActive).toBe(false);
    expect(setMode).toHaveBeenLastCalledWith('EXPLORE');
  });

  test('clearDebugLog empties the log', async () => {
    const { engine, bridge } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    bridge.emit('GAME_READY');
    expect(viewModel.debugLog.length).toBeGreaterThan(0);

    viewModel.clearDebugLog();
    expect(viewModel.debugLog).toEqual([]);
  });
});
