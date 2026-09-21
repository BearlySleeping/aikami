// packages/frontend/engine/src/game_world/input_controller.test.ts

import { describe, expect, test } from 'bun:test';
import { InputController, type InputTarget } from './input_controller.ts';

type Handler = (event: unknown) => void;

/** Minimal event target that records handlers and dispatches synchronously. */
class FakeTarget {
  private readonly _listeners = new Map<string, Set<Handler>>();

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

  listenerCount(): number {
    let count = 0;
    for (const set of this._listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

type KeyEvent = {
  key: string;
  target: unknown;
  preventDefault: () => void;
};

type Harness = {
  controller: InputController;
  target: FakeTarget;
  velocities: Array<{ x: number; y: number }>;
  interacts: number;
  movementStarts: number;
};

const makeHarness = (): Harness => {
  const target = new FakeTarget();
  const velocities: Array<{ x: number; y: number }> = [];
  let interacts = 0;
  let movementStarts = 0;
  const controller = new InputController({
    target: target as unknown as InputTarget,
    onVelocity: (velocity) => velocities.push(velocity),
    onInteract: () => {
      interacts++;
    },
    onMovementStart: () => {
      movementStarts++;
    },
  });
  controller.attach();
  return {
    controller,
    target,
    velocities,
    get interacts() {
      return interacts;
    },
    get movementStarts() {
      return movementStarts;
    },
  };
};

const keyEvent = (key: string, overrides?: Partial<KeyEvent>): KeyEvent => ({
  key,
  target: null,
  preventDefault: () => {},
  ...overrides,
});

const lastVelocity = (harness: Harness): { x: number; y: number } | undefined =>
  harness.velocities.at(-1);

describe('InputController — movement', () => {
  test('a movement key posts a speed-scaled velocity and keyup zeroes it', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    expect(lastVelocity(harness)).toEqual({ x: 150, y: 0 });
    expect(harness.movementStarts).toBe(1);

    harness.target.dispatch('keyup', keyEvent('ArrowRight'));
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });
  });

  test('diagonal movement is normalized to the base speed', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    harness.target.dispatch('keydown', keyEvent('ArrowDown'));
    const velocity = lastVelocity(harness);
    expect(velocity?.x).toBeCloseTo(106.07, 1);
    expect(velocity?.y).toBeCloseTo(106.07, 1);
  });

  test('the same key held down is not double-counted', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    harness.velocities.length = 0;
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    expect(harness.velocities).toHaveLength(0);
  });

  test('keystrokes in an input field are ignored', () => {
    const harness = makeHarness();
    harness.target.dispatch(
      'keydown',
      keyEvent('ArrowRight', { target: { tagName: 'INPUT', isContentEditable: false } }),
    );
    expect(harness.velocities).toHaveLength(0);
  });
});

describe('InputController — lock, interact, flush, blur', () => {
  test('locked input suppresses movement and posts zero velocity', () => {
    const harness = makeHarness();
    harness.controller.setLocked(true);
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });
    expect(harness.movementStarts).toBe(0);
    expect(harness.controller.locked).toBe(true);
  });

  test('interact fires only while unlocked', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('e'));
    expect(harness.interacts).toBe(1);

    harness.controller.setLocked(true);
    harness.target.dispatch('keydown', keyEvent('e'));
    expect(harness.interacts).toBe(1);
  });

  test('flush clears held keys and zeroes velocity', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    harness.controller.flush();
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });

    // A keyup after flush must not re-trigger a velocity update.
    harness.velocities.length = 0;
    harness.target.dispatch('keyup', keyEvent('ArrowRight'));
    expect(harness.velocities).toHaveLength(0);
  });

  test('window blur clears held keys and zeroes velocity', () => {
    const harness = makeHarness();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    harness.target.dispatch('blur', {});
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });
  });

  test('setLocked always zeroes velocity on the transition', () => {
    const harness = makeHarness();
    harness.controller.setLocked(true);
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });
    harness.controller.setLocked(false);
    expect(lastVelocity(harness)).toEqual({ x: 0, y: 0 });
  });
});

describe('InputController — listener lifecycle', () => {
  test('detach removes listeners; reattach restores them', () => {
    const harness = makeHarness();
    expect(harness.target.listenerCount()).toBe(3);

    harness.controller.detach();
    expect(harness.target.listenerCount()).toBe(0);
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    expect(harness.velocities).toHaveLength(0);

    harness.controller.attach();
    harness.target.dispatch('keydown', keyEvent('ArrowRight'));
    expect(lastVelocity(harness)).toEqual({ x: 150, y: 0 });
  });

  test('attach is idempotent', () => {
    const harness = makeHarness();
    harness.controller.attach();
    expect(harness.target.listenerCount()).toBe(3);
  });
});
