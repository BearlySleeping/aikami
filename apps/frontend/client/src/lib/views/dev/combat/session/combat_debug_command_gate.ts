// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_command_gate.ts
//
// The debugger's pause/step boundary.
//
// The engine exposes NO pause primitive: once an encounter starts, the ECS
// worker keeps ticking and the deferred-AI protocol keeps running. The only
// boundary the debug workspace can honestly own is the client → engine command
// dispatch, so that is what this gate intercepts.
//
//   • open (default) — a command is dispatched synchronously; the production
//     path is unchanged (the gate is a transparent pass-through).
//   • held — commands are queued in dispatch order and nothing reaches the
//     engine.
//   • step() — releases exactly ONE queued command at that boundary.
//   • release — flushes the queue in dispatch order.
//
// What it does NOT do, and must not pretend to do: freeze engine-side work
// (worker ticks, an already-answered AI turn, in-flight provider calls). Those
// are reported as limitations of the workspace, not simulated.
//
// Contract: combat debug workspace (execution prompt §2, §6)

/** Minimal bridge surface the gate needs; keeps this module engine-agnostic. */
export type CombatDebugGateableBridge = {
  send(command: never): void;
};

/** A command-boundary gate. One per live session. */
export type CombatDebugCommandGate = {
  /**
   * Returns a view of `bridge` whose `send` observes the gate. Every other
   * member is forwarded unchanged, so the production consumer sees an
   * identical bridge.
   */
  wrap<T extends CombatDebugGateableBridge>(bridge: T): T;
  /** Holds (true) or releases (false) the boundary; releasing flushes. */
  setHeld(held: boolean): void;
  /** Whether the boundary is currently held. */
  readonly held: boolean;
  /** Commands waiting at the boundary. */
  readonly queuedCount: number;
  /** Releases exactly one queued command; false when none was queued. */
  step(): boolean;
  /** Drops everything queued — used on reset and dispose. */
  clear(): void;
};

/**
 * Creates the gate. Commands are queued as opaque values: the gate must never
 * inspect or rewrite an engine command, only decide when it crosses.
 */
export const createCombatDebugCommandGate = (): CombatDebugCommandGate => {
  let held = false;
  let queue: unknown[] = [];
  let send: ((command: never) => void) | undefined;

  const dispatch = (command: unknown): void => {
    send?.(command as never);
  };

  const flush = (): void => {
    const pending = queue;
    queue = [];
    for (const command of pending) {
      dispatch(command);
    }
  };

  return {
    wrap<T extends CombatDebugGateableBridge>(bridge: T): T {
      // Bind once so the queued release path always dispatches to the real
      // bridge, never back through this proxy.
      send = bridge.send.bind(bridge);
      return new Proxy(bridge, {
        get(target, property, receiver) {
          if (property === 'send') {
            return (command: unknown): void => {
              if (!held) {
                dispatch(command);
                return;
              }
              queue = [...queue, command];
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    },

    setHeld(next: boolean): void {
      held = next;
      if (!next) {
        flush();
      }
    },

    get held(): boolean {
      return held;
    },

    get queuedCount(): number {
      return queue.length;
    },

    step(): boolean {
      if (queue.length === 0) {
        return false;
      }
      const [next, ...rest] = queue;
      queue = rest;
      dispatch(next);
      return true;
    },

    clear(): void {
      queue = [];
    },
  };
};
