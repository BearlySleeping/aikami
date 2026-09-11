// packages/frontend/engine/src/game_world/pointer_controller.test.ts

import { describe, expect, test } from 'bun:test';
import { Container } from 'pixi.js';
import type { GameCommand } from '../types.ts';
import { PointerController } from './pointer_controller.ts';

type Handler = (event: unknown) => void;

class FakeCanvas {
  private readonly _listeners = new Map<string, Set<Handler>>();
  rect = { left: 0, top: 0 };

  addEventListener(type: string, handler: Handler): void {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    this._listeners.get(type)?.delete(handler);
  }

  dispatch(type: string, event: unknown): void {
    for (const handler of this._listeners.get(type) ?? []) {
      handler(event);
    }
  }

  getBoundingClientRect(): { left: number; top: number } {
    return this.rect;
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this._listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

type PointerEventLike = {
  button: number;
  clientX: number;
  clientY: number;
};

type Harness = {
  controller: PointerController;
  canvas: FakeCanvas;
  worldContainer: Container;
  commands: GameCommand[];
  setLocked: (locked: boolean) => void;
  setRunning: (running: boolean) => void;
  setHasView: (hasView: boolean) => void;
  setPlayer: (x: number, y: number, tileSize?: number) => void;
};

const makeHarness = (): Harness => {
  const canvas = new FakeCanvas();
  const worldContainer = new Container();
  const commands: GameCommand[] = [];
  let locked = false;
  let running = true;
  let hasView = true;
  let tileSize = 32;
  const view = new Float32Array(6);

  const controller = new PointerController({
    resolveCell: (screenX, screenY) => ({
      cellX: Math.floor(screenX / tileSize),
      cellY: Math.floor(screenY / tileSize),
    }),
    postCommand: (command) => commands.push(command),
    isLocked: () => locked,
    isRunning: () => running,
    hasActiveView: () => hasView,
    getActiveView: () => (hasView ? view : undefined),
    getTileSize: () => tileSize,
    getPlayerEntityId: () => 1,
    log: () => {},
  });
  controller.attach({
    canvas: canvas as unknown as HTMLCanvasElement,
    worldContainer,
  });

  return {
    controller,
    canvas,
    worldContainer,
    commands,
    setLocked: (value) => {
      locked = value;
    },
    setRunning: (value) => {
      running = value;
    },
    setHasView: (value) => {
      hasView = value;
    },
    setPlayer: (x, y, size) => {
      // player entity 1 → offset 3
      view[3] = x;
      view[4] = y;
      if (size) {
        tileSize = size;
      }
    },
  };
};

const pointer = (overrides?: Partial<PointerEventLike>): PointerEventLike => ({
  button: 0,
  clientX: 0,
  clientY: 0,
  ...overrides,
});

describe('PointerController — attach and clicks', () => {
  test('creates the cursor overlays and registers listeners', () => {
    const h = makeHarness();
    expect(h.worldContainer.getChildByLabel('hover-highlight')).not.toBeNull();
    expect(h.worldContainer.getChildByLabel('destination-marker')).not.toBeNull();
    expect(h.canvas.listenerCount()).toBe(3);
  });

  test('left click resolves a cell and posts MOVE_TO_CELL', () => {
    const h = makeHarness();
    h.canvas.dispatch('pointerdown', pointer({ clientX: 70, clientY: 40 }));
    expect(h.commands).toEqual([{ type: 'MOVE_TO_CELL', cellX: 2, cellY: 1, arriveRadius: 0 }]);
    expect(h.worldContainer.getChildByLabel('destination-marker')?.visible).toBe(true);
  });

  test('clicks are ignored while locked, stopped, or without a view', () => {
    const h = makeHarness();
    h.setLocked(true);
    h.canvas.dispatch('pointerdown', pointer());
    h.setLocked(false);
    h.setRunning(false);
    h.canvas.dispatch('pointerdown', pointer());
    h.setRunning(true);
    h.setHasView(false);
    h.canvas.dispatch('pointerdown', pointer());
    h.setHasView(true);
    h.canvas.dispatch('pointerdown', pointer({ button: 2 }));
    expect(h.commands).toHaveLength(0);
  });
});

describe('PointerController — destination lifecycle', () => {
  test('arrival on the target cell hides the marker', () => {
    const h = makeHarness();
    h.canvas.dispatch('pointerdown', pointer({ clientX: 40, clientY: 40 })); // cell (1,1)
    h.setPlayer(200, 200); // far away → marker stays
    h.controller.updateDestinationArrival();
    expect(h.worldContainer.getChildByLabel('destination-marker')?.visible).toBe(true);

    h.setPlayer(40, 40); // exactly cell (1,1)
    h.controller.updateDestinationArrival();
    expect(h.worldContainer.getChildByLabel('destination-marker')?.visible).toBe(false);
    expect(h.controller.isAwaitingCell(1, 1)).toBe(false);
  });

  test('cancelClickPath hides the marker and posts STOP_PLAYER', () => {
    const h = makeHarness();
    h.canvas.dispatch('pointerdown', pointer({ clientX: 40, clientY: 40 }));
    h.controller.cancelClickPath();
    expect(h.commands.at(-1)).toEqual({ type: 'STOP_PLAYER' });
    expect(h.worldContainer.getChildByLabel('destination-marker')?.visible).toBe(false);
  });

  test('isAwaitingCell tracks the active destination', () => {
    const h = makeHarness();
    h.canvas.dispatch('pointerdown', pointer({ clientX: 70, clientY: 40 }));
    expect(h.controller.isAwaitingCell(2, 1)).toBe(true);
    expect(h.controller.isAwaitingCell(0, 0)).toBe(false);
  });
});

describe('PointerController — hover and detach', () => {
  test('pointer move does not post a command and detach removes listeners', () => {
    const h = makeHarness();
    h.canvas.dispatch('pointermove', pointer({ clientX: 40, clientY: 40 }));
    expect(h.commands).toHaveLength(0);
    expect(h.worldContainer.getChildByLabel('hover-highlight')?.visible).toBe(true);

    h.controller.detach();
    expect(h.canvas.listenerCount()).toBe(0);
    h.canvas.dispatch('pointerdown', pointer());
    expect(h.commands).toHaveLength(0);
  });
});
