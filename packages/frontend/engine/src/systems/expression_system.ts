// packages/frontend/engine/src/systems/expression_system.ts

import type { World } from 'bitecs';
import { Appearance, EXPRESSION_MAP, getAppearanceLayers } from '../components/appearance.ts';
import { isSimulationActive } from '../components/engine_state.ts';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// ExpressionSystem — maps MACRO triggers to Appearance texture mutations
// ---------------------------------------------------------------------------

/**
 * A queued macro event waiting to be processed by the expression system.
 */
export type QueuedMacro = {
  /** The macro name (e.g. `'anim'`). */
  name: string;
  /** The macro arguments (e.g. `['joy']`). */
  args: string[];
  /** The entity ID of the character this macro applies to. */
  entityId: number;
};

/**
 * In-memory queue of macros to be processed each tick.
 *
 * GameWorld forwards `TRIGGER_MACRO` commands to the worker, which
 * pushes them onto this queue. The expression system drains the queue
 * each tick and mutates `Appearance` layers.
 */
const macroQueue: QueuedMacro[] = [];

/**
 * Clears the macro queue. Used in tests to reset state between runs.
 */
export const clearMacroQueue = (): void => {
  macroQueue.length = 0;
};

/**
 * Enqueues a macro for processing on the next tick.
 *
 * Called by the worker's `handleBridgeCommand` when a `TRIGGER_MACRO`
 * arrives from the main thread.
 *
 * @param macro - The macro to enqueue.
 */
export const enqueueMacro = (macro: QueuedMacro): void => {
  macroQueue.push(macro);
};

/**
 * Drains the macro queue and applies expression updates to target entities.
 *
 * Runs each tick inside the worker's simulation loop. For each queued
 * macro with `name === 'anim'`, looks up the expression string in
 * {@link EXPRESSION_MAP} and updates `Appearance.layer1[eid]` (the
 * face layer) with the corresponding texture ID.
 *
 * When an expression change is applied, emits an `APPEARANCE_CHANGED`
 * event through the bridge so the main thread can invalidate the
 * composed sprite cache.
 *
 * Macros with unrecognized names or expressions are silently ignored.
 *
 * @param world - The bitECS world.
 * @param bridge - The engine bridge for emitting change events.
 */
export const updateExpressions = (world: World, bridge: EngineBridge): void => {
  if (!world || !bridge || macroQueue.length === 0) {
    return;
  }

  // ── C-172 AC-1: Return early during map transitions ──
  if (!isSimulationActive()) {
    return;
  }

  // Drain the queue — process all pending macros in one tick
  while (macroQueue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: safe because length > 0 was just checked
    const macro = macroQueue.shift()!;

    if (macro.name !== 'anim') {
      continue;
    }

    const expressionName = macro.args[0];
    if (!expressionName) {
      continue;
    }

    const textureId = EXPRESSION_MAP[expressionName];
    if (textureId === undefined) {
      continue;
    }

    const eid = macro.entityId;
    if (!eid || eid <= 0) {
      continue;
    }

    // Mutate SoA arrays directly
    Appearance.layer1[eid] = textureId;

    // Notify the main thread to invalidate the composed sprite
    bridge.emit({
      type: 'APPEARANCE_CHANGED',
      eid,
      layerIds: [...getAppearanceLayers(eid)],
    });
  }
};
