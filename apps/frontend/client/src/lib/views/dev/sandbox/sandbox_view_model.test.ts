// apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.test.ts
//
// C-161/base sandbox: ViewModel tests.
//
// Exercises the ViewModel through feature-owned capability fixtures — the real
// engine is never imported and no `$services` barrel is touched.

import { describe, expect, mock, test } from 'bun:test';
import type { EngineBridge, GameWorld, GameWorldOptions } from '@aikami/frontend/engine';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createSandboxViewModel,
  type SandboxEngineCapabilities,
  type TextGenerationCapabilities,
} from './sandbox_view_model.svelte';

type Npc = { npcName: string; npcId: string; personaId: string };

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
    setInputLocked: mock(() => {}),
    onInteractRequest: (callback: (npc: Npc) => void) => {
      interact = callback;
    },
    triggerInteract: (npc: Npc) => interact?.(npc),
  };
};

const createTextGeneration = (
  overrides: Partial<TextGenerationCapabilities> = {},
): TextGenerationCapabilities => ({
  streamChat: mock(async ({ onChunk }: { onChunk: (text: string) => void }) => {
    onChunk('Hello');
  }),
  ...overrides,
});

const createEngine = () => {
  const bridge = createBridge();
  const world = createWorld();
  const engine: SandboxEngineCapabilities = {
    createBridge: () => bridge as unknown as EngineBridge,
    createWorld: (_options: GameWorldOptions) => world as unknown as GameWorld,
    createTextureManager: () => ({}) as never,
    resolveEcsWorker: mock(async () => class {} as unknown as new () => Worker),
    recipeResolver: () => [],
    assetUrlResolver: () => null,
    isRenderDebugEnabled: () => false,
    setRenderDebug: mock(() => {}),
  };
  return { engine, bridge, world };
};

const createCanvas = () =>
  ({
    clientWidth: 800,
    clientHeight: 600,
    parentElement: null,
  }) as unknown as HTMLCanvasElement;

const createViewModel = (engine: SandboxEngineCapabilities = createEngine().engine) =>
  createSandboxViewModel({
    className: 'SandboxViewModel',
    textGeneration: createTextGeneration(),
    engine,
  });

describe('SandboxViewModel — initial state', () => {
  test('starts idle', () => {
    const viewModel = createViewModel();

    expect(viewModel.showDialog).toBe(false);
    expect(viewModel.dialogText).toBe('');
    expect(viewModel.isStreaming).toBe(false);
    expect(viewModel.engineReady).toBe(false);
    expect(viewModel.engineError).toBeUndefined();
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});

describe('SandboxViewModel — engine lifecycle', () => {
  test('initializeEngine wires the engine capabilities', async () => {
    const { engine, bridge, world } = createEngine();
    const viewModel = createViewModel(engine);
    const canvas = createCanvas();

    await viewModel.initializeEngine(canvas);

    expect(world.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, width: 800, height: 600 }),
    );

    bridge.emit('GAME_READY');
    expect(viewModel.engineReady).toBe(true);
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPAWN_NPC' }));
  });

  test('destroyEngine releases the world and resets state', async () => {
    const { engine, world } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    viewModel.destroyEngine();

    expect(world.destroy).toHaveBeenCalledTimes(1);
    expect(viewModel.engineReady).toBe(false);
  });
});

describe('SandboxViewModel — AI dialog streaming', () => {
  test('interact streams the NPC greeting into dialogText', async () => {
    const { engine, world } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    world.triggerInteract({ npcName: 'Guide', npcId: 'guide', personaId: 'guide' });
    await Promise.resolve();
    await Promise.resolve();

    expect(viewModel.showDialog).toBe(true);
    expect(viewModel.dialogNpcName).toBe('Guide');
    expect(viewModel.dialogText).toBe('Hello');
    expect(viewModel.isStreaming).toBe(false);
  });

  test('dismissDialog resets the overlay and unlocks input', async () => {
    const { engine, world } = createEngine();
    const viewModel = createViewModel(engine);

    await viewModel.initializeEngine(createCanvas());
    world.triggerInteract({ npcName: 'Guide', npcId: 'guide', personaId: 'guide' });
    await Promise.resolve();
    await Promise.resolve();

    viewModel.dismissDialog();

    expect(viewModel.showDialog).toBe(false);
    expect(viewModel.dialogText).toBe('');
    expect(world.setInputLocked).toHaveBeenLastCalledWith(false);
  });
});
