// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_command_gate.test.ts
//
// Unit tests for the debugger's command-boundary gate. These run headless — no
// engine, no worker, no PixiJS — because the gate only owns dispatch ordering.
//
// Contract: combat debug workspace (execution prompt §2, §6)

import { describe, expect, test } from 'bun:test';
import {
  type CombatDebugGateableBridge,
  createCombatDebugCommandGate,
} from './combat_debug_command_gate.ts';

/** A fake bridge recording everything that actually reached the engine. */
const createFakeBridge = (): CombatDebugGateableBridge & {
  readonly dispatched: string[];
  other(): string;
} => {
  const dispatched: string[] = [];
  return {
    dispatched,
    send(command: never): void {
      dispatched.push(String(command));
    },
    other(): string {
      return 'forwarded';
    },
  };
};

describe('combat debug command gate', () => {
  test('passes commands straight through while open', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gated.send('COMBAT_ACTION' as never);

    expect(bridge.dispatched).toEqual(['COMBAT_ACTION']);
    expect(gate.queuedCount).toBe(0);
    expect(gate.held).toBe(false);
  });

  test('forwards every non-send member of the bridge unchanged', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge) as ReturnType<typeof createFakeBridge>;

    expect(gated.other()).toBe('forwarded');
  });

  test('queues commands at the boundary while held', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gate.setHeld(true);
    gated.send('A' as never);
    gated.send('B' as never);

    expect(bridge.dispatched).toEqual([]);
    expect(gate.queuedCount).toBe(2);
    expect(gate.held).toBe(true);
  });

  test('step releases exactly one queued command, in dispatch order', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gate.setHeld(true);
    gated.send('A' as never);
    gated.send('B' as never);

    expect(gate.step()).toBe(true);
    expect(bridge.dispatched).toEqual(['A']);
    expect(gate.queuedCount).toBe(1);

    expect(gate.step()).toBe(true);
    expect(bridge.dispatched).toEqual(['A', 'B']);
    expect(gate.queuedCount).toBe(0);
  });

  test('step reports false when nothing is queued — it never invents work', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    gate.wrap(bridge);

    gate.setHeld(true);

    expect(gate.step()).toBe(false);
    expect(bridge.dispatched).toEqual([]);
  });

  test('releasing the gate flushes the queue in dispatch order', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gate.setHeld(true);
    gated.send('A' as never);
    gated.send('B' as never);
    gated.send('C' as never);

    gate.setHeld(false);

    expect(bridge.dispatched).toEqual(['A', 'B', 'C']);
    expect(gate.queuedCount).toBe(0);
    expect(gate.held).toBe(false);
  });

  test('a command sent after release is dispatched immediately, not re-queued', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gate.setHeld(true);
    gated.send('queued' as never);
    gate.setHeld(false);
    gated.send('live' as never);

    expect(bridge.dispatched).toEqual(['queued', 'live']);
    expect(gate.queuedCount).toBe(0);
  });

  test('clear drops queued commands without dispatching them', () => {
    const gate = createCombatDebugCommandGate();
    const bridge = createFakeBridge();
    const gated = gate.wrap(bridge);

    gate.setHeld(true);
    gated.send('A' as never);
    gate.clear();

    expect(gate.queuedCount).toBe(0);
    expect(bridge.dispatched).toEqual([]);
  });

  test('step is a no-op that reports false before any bridge is wrapped', () => {
    const gate = createCombatDebugCommandGate();

    expect(gate.step()).toBe(false);
    expect(gate.queuedCount).toBe(0);
  });
});
