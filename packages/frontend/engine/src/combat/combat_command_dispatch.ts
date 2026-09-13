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
import type { EngineBridge } from '../engine_bridge.ts';
import { triggerPlayerAttackAnimation } from '../systems/combat_stage_system.ts';
import { advanceTurn, handleCombatAction } from '../systems/turn_manager_system.ts';
import type { GameCommand } from '../types.ts';
import { getEncounterEngine } from './combat_encounter_start.ts';
import { emitCombatPreviewResult, handleCombatPreviewRequest } from './combat_preview_handler.ts';
import { emitLiveCombatSnapshot } from './combat_sync_events.ts';
import { getActiveTurn } from './combat_turn_driver.ts';
import { runV2AiTurns } from './combat_v2_ai.ts';
import { resolveV2CombatCommand } from './combat_v2_resolver.ts';

/** The combat command variants this dispatcher owns. */
export type CombatDispatchCommand = Extract<
  GameCommand,
  {
    type:
      | 'COMBAT_ACTION'
      | 'COMBAT_ACTION_ANIMATE'
      | 'COMBAT_END_TURN'
      | 'COMBAT_MOVE'
      | 'COMBAT_PREVIEW_REQUESTED'
      | 'COMBAT_SYNC_REQUEST';
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
  command.type === 'COMBAT_END_TURN' ||
  command.type === 'COMBAT_MOVE' ||
  command.type === 'COMBAT_PREVIEW_REQUESTED' ||
  command.type === 'COMBAT_SYNC_REQUEST';

export type CombatDispatchContext = {
  /** `null`/absent before the world exists — a combat command is then a no-op. */
  world: World | null | undefined;
  bridge: EngineBridge;
  playerEntityId: number;
  /** Injected production ability catalog (C-516 AC-3). */
  abilityCatalog?: Record<string, CombatAbilityDefinition>;
  /** Per-combatant ability grants (C-516 AC-2). */
  abilityIdsByCombatant?: Record<string, string[]>;
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
const _publishCommandRejection = (bridge: EngineBridge, reasonCode: CombatInvalidReason): void => {
  bridge.emit({
    type: 'COMBAT_COMMAND_REJECTED',
    reasonCode,
    messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
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
    _publishCommandRejection(bridge, active === null ? 'encounterEnded' : 'notActiveCombatant');
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
    bridge.emit({
      type: 'COMBAT_COMMAND_REJECTED',
      reasonCode: result.reasonCode,
      messageKey: result.messageKey,
    });
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
      if (command.action === 'SUPPORT' || command.action === 'REVIVE') {
        _publishCommandRejection(bridge, 'invalidCommandShape');
        return;
      }
      if (_isV2Encounter(world)) {
        _handleV2Command(world, bridge, context, {
          type: 'COMBAT_ACTION',
          action: command.action as 'ATTACK' | 'ABILITY' | 'DEFEND' | 'WAIT',
          ...(command.targetId === undefined ? {} : { targetId: command.targetId }),
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
    case 'COMBAT_SYNC_REQUEST': {
      // ── Re-emit the live encounter state (C-516 AC-5) — a ViewModel that
      // mounted after the start events still has to render the fight it shows.
      emitLiveCombatSnapshot({ world, bridge });
    }
  }
};
