// packages/frontend/engine/src/combat/combat_encounter_command.ts
//
// The worker's encounter-lifecycle command handlers: `COMBAT_START_ENCOUNTER`
// and `RETRY_ENCOUNTER`.
//
// Extracted from `worker/ecs_worker.ts` (on the source-file-size guard's
// waiver) so the worker's command switch keeps only the call sites. Both
// commands are one cohesive responsibility — drive an encounter into a running
// state and hand the worker back the per-combatant ability grants it must
// remember — and they share the same live worker context, so they live
// together rather than in two files.
//
// Behaviour is unchanged: the v2-rejection legacy fallback, the AI-turn kickoff
// and the typed `COMBAT_START_REJECTED` emission all move verbatim.
//
// Contract: C-516 AC-2, AC-10

import { BASIC_COMBAT_ABILITIES, resolveCombatAbilityIds } from '@aikami/constants';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import { emitCombatStateUpdate, initCombat } from '../systems/turn_manager_system.ts';
import type { GameCommand } from '../types.ts';
import type { CombatAiWorkerBinding } from './combat_ai_worker_binding.ts';
import { retryEncounterCommand } from './combat_encounter_retry.ts';
import { startEncounterFromCommand, startEncounterWithFallback } from './combat_encounter_start.ts';

type StartEncounterCommand = Extract<GameCommand, { type: 'COMBAT_START_ENCOUNTER' }>;
type RetryEncounterCommand = Extract<GameCommand, { type: 'RETRY_ENCOUNTER' }>;

/** The live worker state an encounter-lifecycle command handler needs. */
export type CombatEncounterCommandContext = {
  world: World;
  bridge: EngineBridge;
  playerEntityId: number;
  /** The worker's AI-turn binding for the running encounter (C-526 AC-5). */
  aiTurns: CombatAiWorkerBinding;
  /** Stores the per-combatant ability grants for the running encounter. */
  setAbilityIds: (abilityIds: Record<string, string[]> | undefined) => void;
};

/**
 * Handles `COMBAT_START_ENCOUNTER` — the single production encounter start.
 *
 * Both funnels (the dialogue chip's authored roster and the collision trigger's
 * derived roster) converge here. Legacy and v2 both come through this command;
 * `initCombat` stays the legacy driver entry.
 */
export const handleStartEncounterCommand = (options: {
  command: StartEncounterCommand;
  context: CombatEncounterCommandContext;
}): void => {
  const { command, context } = options;
  const { world, bridge, playerEntityId, aiTurns, setAbilityIds } = context;

  const requested = command.engine ?? 'legacy';
  const attempt = (engine: 'legacy' | 'v2') =>
    startEncounterFromCommand({
      world,
      bridge,
      command: {
        encounterId: command.encounterId,
        seed: command.seed,
        engine,
        ...(command.roster === undefined ? {} : { roster: command.roster }),
      },
      playerEntityId,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      abilityIdsForClasses: resolveCombatAbilityIds,
      // The v2 driver defers AI turns to the kernel-driven runner, so its hook
      // is a no-op; the legacy branch starts through `initCombat`, which
      // supplies the legacy AI hooks itself.
      hooks: { runAiTurn: () => {}, emitStateUpdate: emitCombatStateUpdate },
      startLegacy: (targetWorld, targetBridge, seed) => {
        initCombat(targetWorld, targetBridge, seed);
      },
    });

  // ── C-516 Migration & Rollback: a failed v2 start falls back to the legacy
  // engine for THAT encounter, rather than leaving the player in a broken
  // fight (the policy lives in the combat module so it is unit tested;
  // validation runs before any spawn, so the world is untouched).
  const outcome = startEncounterWithFallback({ requested, attempt });
  const started = outcome.started;
  // C-516 Observability: log the engine that actually ran, and whether a v2
  // rejection forced the legacy fallback.
  logger.info('[WorkerEngine] combat:startEncounter', {
    encounterId: command.encounterId,
    requested,
    engine: outcome.engine,
    fellBack: outcome.fellBack,
    started: started.ok,
    ...(started.ok ? {} : { reasonCode: started.reasonCode }),
  });

  if (!started.ok) {
    // No engine could start it: surface a typed rejection so the UI can leave
    // the overlay it optimistically opened (AC-2 / Edge Cases).
    logger.warn('[WorkerEngine] combat:startEncounterRejected', {
      encounterId: command.encounterId,
      reasonCode: started.reasonCode,
    });
    bridge.emit({
      type: 'COMBAT_START_REJECTED',
      encounterId: command.encounterId,
      reasonCode: started.reasonCode,
      messageKey: started.messageKey,
    });
    return;
  }

  setAbilityIds(started.abilityIdsByCombatant);
  // C-516: the driver deliberately defers AI turns, so if an AI combatant won
  // initiative nothing else would resolve its turn and the fight would stall on
  // an unowned turn. Run the AI turns now — the coordinator resolves them or
  // defers one to the client.
  if (outcome.engine !== 'v2') {
    return;
  }
  // An AI failure must never leave the encounter half-started: the turn driver
  // is live, and a surfaced error beats an uncaught one.
  try {
    aiTurns.startFromEncounter({
      world,
      bridge,
      playerEntityId,
      started,
      llmAgentsEnabled: command.llmAgentsEnabled === true,
    });
  } catch (error) {
    logger.error('[WorkerEngine] combat:startEncounterAiFailed', {
      encounterId: command.encounterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Handles `RETRY_ENCOUNTER` — an engine-routed retry with the preserved seed
 * (C-330 AC-5, C-516 AC-10).
 */
export const handleRetryEncounterCommand = (options: {
  command: RetryEncounterCommand;
  context: CombatEncounterCommandContext;
}): void => {
  const { command, context } = options;
  const { world, bridge, playerEntityId, aiTurns, setAbilityIds } = context;
  setAbilityIds(
    retryEncounterCommand({
      world,
      bridge,
      playerEntityId,
      seed: command.combatSeed,
      runAiTurns: (retryOptions) => aiTurns.runRetryAiTurns(retryOptions),
    }),
  );
};
