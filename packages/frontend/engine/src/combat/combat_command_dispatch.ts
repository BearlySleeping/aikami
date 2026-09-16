// packages/frontend/engine/src/combat/combat_command_dispatch.ts
//
// Combat `GameCommand` dispatch for the ECS worker.
//
// Extracted from `worker/ecs_worker.ts`, which is on the source-file-size
// guard's grandfathered baseline. Behaviour is identical — the worker narrows
// the incoming command with `isCombatDispatchCommand` and delegates to
// `dispatchCombatCommand` instead of handling the combat command types inline.
//
// From C-516 the dispatcher is also the ENGINE ROUTER: it reads the engine kind
// pinned on the running encounter (`combat_encounter_start.ts`) and routes the
// command to the legacy turn manager or the v2 resolver. The flag itself is
// never consulted here — it was read once at encounter start.
//
// Contract: C-145, C-166, C-514 AC-4, C-515 AC-5, C-516 AC-4/AC-6

import type { CombatAbilityDefinition, CombatInvalidReason } from '@aikami/types';
import { COMBAT_MESSAGE_KEYS } from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, hasComponent, set } from 'bitecs';
import { logger } from '$logger';
import { Companion } from '../components/companion.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { triggerPlayerAttackAnimation } from '../systems/combat_stage_system.ts';
import { advanceTurn, handleCombatAction } from '../systems/turn_manager_system.ts';
import type { GameCommand } from '../types.ts';
import type { CombatAiTurnCoordinator } from './combat_ai_turns.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import { getEncounterEngine } from './combat_encounter_start.ts';
import {
  buildCombatProjectionState,
  emitCombatPreviewResult,
  handleCombatPreviewRequest,
} from './combat_preview_handler.ts';
import { getCombatIdentityRegistry } from './combat_state_adapter.ts';
import { emitLiveCombatSnapshot } from './combat_sync_events.ts';
import { getActiveTurn, getCombatPreviewSnapshot } from './combat_turn_driver.ts';
import { runV2AiTurns } from './combat_v2_ai.ts';
import { resolveV2CombatCommand } from './combat_v2_resolver.ts';
import {
  clearWorldObjectState,
  getWorldObjectState,
  setWorldObjectState,
} from './combat_world_object_state.ts';

/** The combat command variants this dispatcher owns. */
export type CombatDispatchCommand = Extract<
  GameCommand,
  {
    type:
      | 'COMBAT_ACTION'
      | 'COMBAT_ACTION_ANIMATE'
      | 'COMBAT_AI_DECISION_SUBMITTED'
      | 'COMBAT_COMPANION_MODE_SET'
      | 'COMBAT_END_TURN'
      | 'COMBAT_INTERACT'
      | 'COMBAT_LANGUAGE_INTENT_SUBMITTED'
      | 'COMBAT_MOVE'
      | 'COMBAT_PREVIEW_REQUESTED'
      | 'COMBAT_REACTION_SELECTED'
      | 'COMBAT_STATE_SNAPSHOT_REQUESTED'
      | 'COMBAT_SYNC_REQUEST'
      | 'WORLD_OBJECTS_REQUESTED'
      | 'WORLD_OBJECTS_RESTORED';
  }
>;

/**
 * Narrows a `GameCommand` to the combat dispatcher's vocabulary.
 *
 * Keeps `worker/ecs_worker.ts` free of combat case labels — a new combat
 * command is added here and nowhere else.
 */
export const isCombatDispatchCommand = (command: GameCommand): command is CombatDispatchCommand =>
  command.type === 'COMBAT_ACTION' ||
  command.type === 'COMBAT_ACTION_ANIMATE' ||
  command.type === 'COMBAT_AI_DECISION_SUBMITTED' ||
  command.type === 'COMBAT_COMPANION_MODE_SET' ||
  command.type === 'COMBAT_END_TURN' ||
  command.type === 'COMBAT_INTERACT' ||
  command.type === 'COMBAT_LANGUAGE_INTENT_SUBMITTED' ||
  command.type === 'COMBAT_MOVE' ||
  command.type === 'COMBAT_PREVIEW_REQUESTED' ||
  command.type === 'COMBAT_REACTION_SELECTED' ||
  command.type === 'COMBAT_STATE_SNAPSHOT_REQUESTED' ||
  command.type === 'COMBAT_SYNC_REQUEST' ||
  command.type === 'WORLD_OBJECTS_REQUESTED' ||
  command.type === 'WORLD_OBJECTS_RESTORED';

export type CombatDispatchContext = {
  /** `null`/absent before the world exists — a combat command is then a no-op. */
  world: World | null | undefined;
  bridge: EngineBridge;
  playerEntityId: number;
  /** Injected production ability catalog (C-516 AC-3). */
  abilityCatalog?: Record<string, CombatAbilityDefinition>;
  /** Per-combatant ability grants (C-516 AC-2). */
  abilityIdsByCombatant?: Record<string, string[]>;
  /**
   * C-526 AC-5: the LLM-aware AI turn coordinator for the running encounter.
   *
   * Absent means the deterministic runner owns every AI turn, which is exactly
   * the pinned-flag-off behaviour (AC-9).
   */
  aiTurns?: CombatAiTurnCoordinator;
};

/**
 * Dispatches `command` when it belongs to the combat dispatcher.
 *
 * Keeps `worker/ecs_worker.ts` free of combat case labels: the worker narrows
 * once, and a new combat command is added here and nowhere else.
 *
 * @returns `true` when the command was a combat command and must not be
 *   handled further by the caller.
 */
export const tryDispatchCombatCommand = (
  command: GameCommand,
  context: CombatDispatchContext,
): boolean => {
  if (!isCombatDispatchCommand(command)) {
    return false;
  }
  dispatchCombatCommand(command, context);
  return true;
};

/**
 * Whether the running encounter was pinned to the v2 resolver.
 *
 * Read per command from the encounter record — never from the feature flag, so
 * a mid-encounter env change cannot switch engines (§22.2, AC-6).
 */
const _isV2Encounter = (world: World): boolean => getEncounterEngine(world) === 'v2';

/** Publishes a typed command rejection for the sidebar without changing combat state. */
const _publishCommandRejection = (options: {
  bridge: EngineBridge;
  reasonCode: CombatInvalidReason;
  commandType:
    | 'COMBAT_ACTION'
    | 'COMBAT_MOVE'
    | 'COMBAT_END_TURN'
    | 'COMBAT_INTERACT'
    | 'COMBAT_REACTION_SELECTED';
}): void => {
  // C-531 observability: a rejected command is silent on the UI (one typed
  // rejection paragraph), so the reason must be readable in the worker log.
  logger.warn('combat:command-rejected', { reasonCode: options.reasonCode });
  options.bridge.emit({
    type: 'COMBAT_COMMAND_REJECTED',
    commandType: options.commandType,
    reasonCode: options.reasonCode,
    messageKey: COMBAT_MESSAGE_KEYS[options.reasonCode],
  });
};

const _handleLegacyCombatAction = (
  command: Extract<CombatDispatchCommand, { type: 'COMBAT_ACTION' }>,
  context: CombatDispatchContext,
): void => {
  const { world, bridge, playerEntityId } = context;
  if (world === null || world === undefined) {
    return;
  }
  handleCombatAction({
    world,
    playerEntityId,
    action: command.action,
    // The legacy turn manager addresses targets by runtime eid; a v2-authored
    // id that reached it is not addressable, so it falls back to no target.
    targetId: typeof command.targetId === 'number' ? command.targetId : undefined,
    bridge,
    advantage: command.advantage,
    bonusDamage: command.bonusDamage,
  });
};

/**
 * Resolves one v2 command, then runs any AI turns the commit exposed.
 *
 * A rejected command changes nothing; the resolver already returned a typed
 * reason which the preview/commit paths surface.
 */
const _handleV2Command = (
  world: World,
  bridge: EngineBridge,
  context: CombatDispatchContext,
  command: Parameters<typeof resolveV2CombatCommand>[0]['command'],
): void => {
  const abilityCatalog = context.abilityCatalog ?? {};
  const active = getActiveTurn(world);
  if (active === null || active.entityId !== context.playerEntityId) {
    _publishCommandRejection({
      bridge,
      commandType: command.type,
      reasonCode: active === null ? 'encounterEnded' : 'notActiveCombatant',
    });
    return;
  }
  const result = resolveV2CombatCommand({
    world,
    bridge,
    command,
    abilityCatalog,
    ...(context.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: context.abilityIdsByCombatant }),
  });
  if (!result.ok) {
    _publishCommandRejection({ bridge, commandType: command.type, reasonCode: result.reasonCode });
    return;
  }
  if (context.aiTurns !== undefined) {
    // C-526 AC-5: the coordinator either resolves the AI chain
    // deterministically (flag off) or defers one actor to the client.
    context.aiTurns.run();
    return;
  }
  runV2AiTurns({
    world,
    bridge,
    abilityCatalog,
    playerEntityId: context.playerEntityId,
    ...(context.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: context.abilityIdsByCombatant }),
  });
};

/**
 * Resolves one reaction decision, then runs any AI turns the commit exposed.
 *
 * Deliberately NOT gated on `context.playerEntityId`: a reaction window suspends
 * the MOVER's turn while a different actor decides, so the active-turn
 * ownership check that guards ordinary commands would reject every legal
 * reaction. The kernel owns the real authority — it revalidates window identity,
 * version, encounter-run identity, the current reactor and eligibility before
 * spending any reaction or RNG.
 */
const _handleV2Reaction = (
  world: World,
  bridge: EngineBridge,
  context: CombatDispatchContext,
  command: Extract<CombatDispatchCommand, { type: 'COMBAT_REACTION_SELECTED' }>,
): void => {
  const result = resolveV2CombatCommand({
    world,
    bridge,
    command: {
      type: 'COMBAT_REACTION_SELECTED',
      reactorId: command.reactorId,
      encounterRunId: command.encounterRunId,
      windowId: command.windowId,
      windowVersion: command.windowVersion,
      choice: command.choice,
      source: command.source,
      basedOnRevision: command.basedOnRevision,
    },
    abilityCatalog: context.abilityCatalog ?? {},
    ...(context.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: context.abilityIdsByCombatant }),
  });
  if (!result.ok) {
    _publishCommandRejection({ bridge, commandType: command.type, reasonCode: result.reasonCode });
    return;
  }
  if (context.aiTurns !== undefined) {
    context.aiTurns.run();
    return;
  }
  runV2AiTurns({
    world,
    bridge,
    abilityCatalog: context.abilityCatalog ?? {},
    playerEntityId: context.playerEntityId,
    ...(context.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: context.abilityIdsByCombatant }),
  });
};

/**
 * Handles one combat command.
 *
 * FLEE is NOT a kernel command: it is the party-level retreat exit, and it is
 * routed to the legacy turn manager BEFORE the engine branch in both
 * directions, so a v2 encounter still lets the party flee (AC-4 / Edge Cases).
 *
 * Turn ownership is validated before resolution: a client cannot act or end a
 * turn that is not active (C-514 AC-4, C-516 AC-4).
 */
export const dispatchCombatCommand = (
  command: CombatDispatchCommand,
  context: CombatDispatchContext,
): void => {
  const { world, bridge } = context;
  if (world === null || world === undefined) {
    if (command.type === 'COMBAT_PREVIEW_REQUESTED') {
      emitCombatPreviewResult(bridge, {
        requestId: command.requestId,
        valid: false,
        reasonCode: 'encounterEnded',
        messageKey: COMBAT_MESSAGE_KEYS.encounterEnded,
      });
    }
    return;
  }

  switch (command.type) {
    case 'COMBAT_ACTION': {
      if (command.action === 'FLEE') {
        _handleLegacyCombatAction(command, context);
        return;
      }
      if (_isV2Encounter(world)) {
        if (command.action === 'SUPPORT' || command.action === 'REVIVE') {
          _publishCommandRejection({
            bridge,
            commandType: command.type,
            reasonCode: 'unsupportedInV2',
          });
          return;
        }
        _handleV2Command(world, bridge, context, {
          type: 'COMBAT_ACTION',
          action: command.action as 'ATTACK' | 'ABILITY' | 'DEFEND' | 'WAIT',
          ...(command.targetId === undefined ? {} : { targetId: command.targetId }),
          // C-525 AC-4: the COMPLETE approved target set travels with the
          // command; the kernel owns cardinality and rejects an unauthored
          // fan-out instead of resolving one cost against many targets.
          ...(command.targetIds === undefined ? {} : { targetIds: command.targetIds }),
          ...(command.abilityId === undefined ? {} : { abilityId: command.abilityId }),
        });
        return;
      }
      _handleLegacyCombatAction(command, context);
      return;
    }
    case 'COMBAT_MOVE': {
      if (_isV2Encounter(world)) {
        _handleV2Command(world, bridge, context, {
          type: 'COMBAT_MOVE',
          cellX: command.cellX,
          cellY: command.cellY,
        });
      }
      return;
    }
    case 'COMBAT_REACTION_SELECTED': {
      // ── C-532 AC-3: the decision for one open reaction window ──
      if (!_isV2Encounter(world)) {
        // A silently dropped choice leaves the encounter suspended forever.
        logger.warn('combat:reaction-dropped', { reason: 'not-v2-encounter' });
        return;
      }
      _handleV2Reaction(world, bridge, context, command);
      return;
    }
    case 'COMBAT_INTERACT': {
      // ── C-531: use an authored affordance on an authored object ──
      if (!_isV2Encounter(world)) {
        // A silent no-op here reads as a broken button — log it.
        logger.warn('combat:interact-dropped', { reason: 'not-v2-encounter' });
      }
      if (_isV2Encounter(world)) {
        _handleV2Command(world, bridge, context, {
          type: 'COMBAT_INTERACT',
          objectId: command.objectId,
          affordanceId: command.affordanceId,
          targetObjectId: command.targetObjectId ?? null,
        });
      }
      return;
    }
    case 'COMBAT_ACTION_ANIMATE': {
      // ── Trigger player attack animation during AI resolution (C-166) ──
      triggerPlayerAttackAnimation(world);
      return;
    }
    case 'COMBAT_END_TURN': {
      // ── Explicit end turn (C-514 AC-4) ──
      if (_isV2Encounter(world)) {
        _handleV2Command(world, bridge, context, { type: 'COMBAT_END_TURN' });
        return;
      }
      advanceTurn(world, bridge);
      return;
    }
    case 'COMBAT_PREVIEW_REQUESTED': {
      // ── Pure tactical preview (C-515 AC-5) — never mutates state ──
      emitCombatPreviewResult(
        bridge,
        handleCombatPreviewRequest({ world, bridge, request: command }),
      );
      return;
    }
    case 'WORLD_OBJECTS_REQUESTED': {
      // ── C-531 AC-7: the object state that outlives the encounter ──
      bridge.emit({
        type: 'WORLD_OBJECTS_READY',
        requestId: command.requestId,
        worldObjects: getWorldObjectState(world) ?? null,
      });
      return;
    }
    case 'WORLD_OBJECTS_RESTORED': {
      // ── C-531 AC-7: a loaded save seeds the engine's persisted block ──
      if (command.worldObjects === null) {
        clearWorldObjectState(world);
      } else {
        setWorldObjectState(world, command.worldObjects);
      }
      return;
    }
    case 'COMBAT_SYNC_REQUEST': {
      // ── Re-emit the live encounter state (C-516 AC-5) — a ViewModel that
      // mounted after the start events still has to render the fight it shows.
      emitLiveCombatSnapshot({ world, bridge });
      return;
    }
    case 'COMBAT_AI_DECISION_SUBMITTED': {
      // ── The client's answer to `COMBAT_AI_DECISION_REQUESTED` (C-526 AC-5).
      // The coordinator validates the request id, rejects a stale revision and
      // either activates the decision through the step-wise pipeline or falls
      // back deterministically — the engine never blocks on the model.
      context.aiTurns?.submit(command);
      return;
    }
    case 'COMBAT_COMPANION_MODE_SET': {
      // ── The player changed a companion's control mode (C-526 AC-6).
      // Mode is a PREFERENCE: it decides who owns the turn, never how a command
      // resolves. The engine records it on the companion's ECS component (the
      // source `controllerFor` reads) and asks the coordinator to re-read turn
      // ownership, so a switch to `direct` withdraws a pending proposal and a
      // switch away from it lets the coordinator take the turn.
      if (world === null || world === undefined || command.combatantId.length === 0) {
        return;
      }
      const activeEncounter = getCombatPreviewSnapshot(world);
      if (activeEncounter === null || activeEncounter.encounterId !== command.encounterId) {
        logger.warn('[combat_command_dispatch] companion mode for an inactive encounter', {
          encounterId: command.encounterId,
        });
        return;
      }
      const registry = getCombatIdentityRegistry(world);
      registry.sync(world);
      const entityId = registry.toEntityId(command.combatantId);
      if (entityId === null || entityId <= 0) {
        logger.warn('[combat_command_dispatch] companion mode for an unknown combatant', {
          combatantId: command.combatantId,
        });
        return;
      }
      if (!hasComponent(world, entityId, Companion) || Companion.recruited[entityId] !== true) {
        logger.warn('[combat_command_dispatch] companion mode for a non-companion combatant', {
          combatantId: command.combatantId,
        });
        return;
      }
      // `addComponent` + `set` is how this codebase writes a component that may
      // already be present; the registered `onSet(Companion)` observer applies
      // the write to the SoA arrays.
      addComponent(
        world,
        entityId,
        set(Companion, {
          npcId: Companion.npcId[entityId] ?? command.combatantId,
          approval: Companion.approval[entityId] ?? 0,
          recruited: true,
          controlMode: command.mode,
        }),
      );
      context.aiTurns?.refresh();
      return;
    }
    case 'COMBAT_LANGUAGE_INTENT_SUBMITTED': {
      // ── Deterministic acknowledgement of a natural-language decision
      // (C-525 AC-4). The client interprets and compiles; the engine only
      // reports that a decision is in flight, keyed by `requestId`, so other
      // surfaces can show it and a cancellation is correlatable.
      bridge.emit({
        type: 'COMBAT_DECISION_PENDING',
        requestId: command.requestId,
        state: 'interpreting',
      });
      return;
    }
    case 'COMBAT_STATE_SNAPSHOT_REQUESTED': {
      // ── The live v2 kernel state, so the client can ground a compiled intent
      // (C-525 AC-4). This is the SAME projection the preview/commit path
      // answers from (`buildCombatProjectionState`), so the compiled plan and
      // the engine's own view agree on positions, budgets and revision; the
      // engine still re-validates every commit.
      //
      // A legacy encounter has no v2 kernel: it answers with a typed rejection
      // instead of a state nobody could compile against, which keeps the
      // language surface (v2-only) from hanging.
      const driver = getCombatPreviewSnapshot(world);
      if (driver === null) {
        bridge.emit({
          type: 'COMBAT_STATE_SNAPSHOT_REJECTED',
          requestId: command.requestId,
          reasonCode: 'encounterEnded',
          messageKey: COMBAT_MESSAGE_KEYS.encounterEnded,
        });
        return;
      }
      if (driver.engine !== 'v2') {
        bridge.emit({
          type: 'COMBAT_STATE_SNAPSHOT_REJECTED',
          requestId: command.requestId,
          reasonCode: 'unsupportedInV2',
          messageKey: COMBAT_MESSAGE_KEYS.unsupportedInV2,
        });
        return;
      }
      if (driver.encounterId !== command.encounterId) {
        bridge.emit({
          type: 'COMBAT_STATE_SNAPSHOT_REJECTED',
          requestId: command.requestId,
          reasonCode: 'encounterEnded',
          messageKey: COMBAT_MESSAGE_KEYS.encounterEnded,
        });
        return;
      }
      bridge.emit({
        type: 'COMBAT_STATE_SNAPSHOT',
        requestId: command.requestId,
        state: buildCombatProjectionState({
          world,
          battlefield: snapshotBattlefield(world),
          driver,
        }),
      });
      return;
    }
  }
};
