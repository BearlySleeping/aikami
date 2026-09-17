// packages/frontend/engine/src/__tests__/support/combat_command_identity.ts
//
// Test support: mint a real command-admission envelope from the live encounter.
//
// The v2 dispatcher REQUIRES an identity block on every ordinary command
// (review F-B). Tests drive the same production seam, so they must supply the
// same identity the client does — a test that bypasses admission would not be
// exercising the boundary the review is about.
//
// The values are read from the engine's own authoritative projection, never
// invented: encounter id, execution run id, turn id, active combatant and the
// current revision all come from the live `CombatState`.

import type { CombatAbilityDefinition } from '@aikami/types';
import type { World } from 'bitecs';
import { buildV2CombatState } from '../../combat/combat_v2_resolver.ts';

/** Monotonic per-process counter so two attempts never share a command id. */
let commandCounter = 0;

/** Resets the id counter (test isolation across files is unnecessary: ids are unique). */
export const resetCommandIdCounter = (): void => {
  commandCounter = 0;
};

/**
 * The identity block for one command, read from the live encounter.
 *
 * @returns The identity, or `null` when no v2 encounter is running.
 */
export const liveCommandIdentity = (options: {
  world: World;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** Override the acting combatant (defaults to the active one). */
  combatantId?: string;
  /** Override the expected revision (for stale-command tests). */
  basedOnRevision?: number;
  /** Override the execution run (for cross-run tests). */
  encounterRunId?: string;
  /** Override the turn identity (for stale-turn tests). */
  turnId?: string;
}): {
  commandId: string;
  encounterId: string;
  encounterRunId: string;
  combatantId: string;
  turnId: string;
  basedOnRevision: number;
} | null => {
  const state = buildV2CombatState({
    world: options.world,
    abilityCatalog: options.abilityCatalog,
  });
  if (state === null) {
    return null;
  }
  const activeId = state.initiative.order[state.initiative.activeIndex] ?? '';
  return {
    commandId: `test-cmd-${++commandCounter}`,
    encounterId: state.encounterId,
    encounterRunId: options.encounterRunId ?? state.encounterRunId,
    combatantId: options.combatantId ?? activeId,
    turnId: options.turnId ?? state.turnId ?? '',
    basedOnRevision: options.basedOnRevision ?? state.stateRevision,
  };
};

/**
 * Merges the live admission identity into an ordinary v2 bridge command.
 *
 * Reaction commands are returned untouched: the kernel validates window
 * identity, version and run identity for those, so adding a redundant envelope
 * would only blur which boundary refused a stale choice.
 */
export const withLiveIdentity = <T extends { type: string }>(
  options: { world: World; abilityCatalog: Record<string, CombatAbilityDefinition> },
  command: T,
): T => {
  if (command.type === 'COMBAT_REACTION_SELECTED') {
    return command;
  }
  const identity = liveCommandIdentity(options);
  if (identity === null) {
    return command;
  }
  // An explicitly supplied field WINS: a test that deliberately binds a stale
  // revision, turn or run is exercising the admission check, not bypassing it.
  const explicit = command as Record<string, unknown>;
  return {
    ...identity,
    ...Object.fromEntries(Object.entries(explicit).filter(([, value]) => value !== undefined)),
  } as unknown as T;
};
