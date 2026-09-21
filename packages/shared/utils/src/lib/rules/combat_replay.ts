// packages/shared/utils/src/lib/rules/combat_replay.ts
//
// Replay and divergence helpers for Combat 2.0.
//
// A replay reconstructs events and the final state from `initialState` +
// `rulesVersion` + `commands` alone — it never re-reads content, never touches
// the RNG outside the state, and never fetches the latest mutable content pack.
//
// Module graph: `combat_canonical_json.ts` + `combat_kernel.ts` ← this module.
// The kernel does not import it, so the graph stays acyclic.
//
// Contract: C-531 AC-7

import { COMBAT_REPLAY_VERSION } from '@aikami/schemas';
import type {
  CombatCommand,
  CombatDivergence,
  CombatEvent,
  CombatReplay,
  CombatState,
  ReplayCombatResult,
} from '@aikami/types';
import { canonicalCombatJson } from './combat_canonical_json';
import { resolveCombatCommand } from './combat_kernel';

export type ReplayCombatInput = {
  initialState: CombatState;
  rulesVersion: string;
  commands: CombatCommand[];
};

/**
 * Reconstructs events and the final state from `initialState` + `rulesVersion`
 * + `commands` alone. Aborts at the first invalid command, returning
 * `finalState: null` plus the events produced up to that point. Never throws.
 */
export const replayCombat = (input: ReplayCombatInput): ReplayCombatResult => {
  const { initialState, rulesVersion, commands } = input;
  const events: CombatEvent[] = [];
  let aborted = rulesVersion !== initialState.rulesVersion;
  let current = initialState;

  if (!aborted) {
    for (const command of commands) {
      const result = resolveCombatCommand({ state: current, command });
      if (!result.valid) {
        aborted = true;
        break;
      }
      for (const event of result.events) {
        events.push(event);
      }
      current = result.state;
    }
  }

  const finalState = aborted ? null : structuredClone(current);
  const replay: CombatReplay = {
    replayVersion: COMBAT_REPLAY_VERSION,
    rulesVersion,
    initialState: structuredClone(initialState),
    commands: commands.map((command) => structuredClone(command)),
    events,
    finalState,
  };

  return { replay, finalState };
};

/**
 * Reports the first divergent event between two replays, or the end of the
 * shorter log when one is a strict prefix of the other. Returns `null` for
 * identical replays. Development/test helper.
 */
export const findFirstCombatDivergence = (
  a: CombatReplay,
  b: CombatReplay,
): CombatDivergence | null => {
  const shared = Math.min(a.events.length, b.events.length);

  for (let index = 0; index < shared; index++) {
    if (canonicalCombatJson(a.events[index]) !== canonicalCombatJson(b.events[index])) {
      return { stateRevision: a.events[index].stateRevision, eventIndex: index };
    }
  }

  if (a.events.length !== b.events.length) {
    const longer = a.events.length > b.events.length ? a : b;
    return { stateRevision: longer.events[shared].stateRevision, eventIndex: shared };
  }

  if (canonicalCombatJson(a.finalState) !== canonicalCombatJson(b.finalState)) {
    return { stateRevision: a.finalState?.stateRevision ?? 0, eventIndex: shared };
  }

  return null;
};
