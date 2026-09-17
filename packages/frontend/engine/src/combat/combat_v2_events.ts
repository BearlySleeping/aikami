// packages/frontend/engine/src/combat/combat_v2_events.ts
//
// Kernel-event -> bridge-event projection for the v2 resolver (review F-B/F9).
//
// Extracted from `combat_v2_resolver.ts` so the resolver stays the command
// admission + resolution pipeline and this module owns presentation mapping.
// Behaviour is unchanged: log text derives from the RESOLVED event (never from
// the command), and the reaction surface is emitted from the window the kernel
// opened so the UI never re-derives eligibility.
//
// Contract: C-516 AC-5, C-525 AC-7, C-532 AC-3/AC-5

import type {
  CombatEvent,
  CombatState,
  ReactionPolicy,
  ReactionWindow,
} from '@aikami/types';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reaction surface
// ---------------------------------------------------------------------------

/**
 * Whether the player's side controls `combatantId`.
 *
 * The player's side is the only one with a decision surface. Every other actor
 * resolves through a pinned deterministic policy so the kernel is never blocked
 * waiting for a model call. Contract: C-532 "Player and AI policy".
 */
export const playerControlsCombatant = (state: CombatState, combatantId: string): boolean => {
  const combatant = state.combatants[combatantId];
  return (
    combatant?.team === 'player' ||
    (combatant?.team === 'ally' && combatant.controlMode === 'direct')
  );
};

/**
 * The policy that governs one reactor.
 *
 * An actor the player does not control has no decision surface to open, so it
 * resolves deterministically: `auto` accepts the legal opportunity the engine
 * already established eligibility for, and an authored `never` still declines.
 * The player's own side uses its authored policy, which defaults to `ask`.
 */
export const engineReactionPolicyFor = (state: CombatState, reactorId: string): ReactionPolicy => {
  const authored = state.participation[reactorId]?.reactionPolicy;
  if (playerControlsCombatant(state, reactorId)) {
    return authored ?? 'ask';
  }
  return authored === 'never' ? 'never' : 'auto';
};

/**
 * Emits `COMBAT_REACTION_OPENED` for one open window.
 *
 * The ENGINE decides who is asked: the reactor queue, the trigger cell and the
 * already-committed prefix all come from the window the kernel opened, so the
 * decision surface never re-derives eligibility. Contract: C-532 AC-3.
 */
const _emitReactionOpened = (options: {
  bridge: EngineBridge;
  state: CombatState;
  window: ReactionWindow;
}): void => {
  const { bridge, state, window } = options;
  const reaction = state.reactionRegistry.definitions.find(
    (definition) => definition.reactionId === window.reactionId,
  );
  const reactorId = window.currentReactorId ?? window.reactorQueue[0] ?? null;
  bridge.emit({
    type: 'COMBAT_REACTION_OPENED',
    encounterId: state.encounterId,
    encounterRunId: state.encounterRunId,
    windowId: window.windowId,
    windowVersion: window.version,
    // C-532: the committed revision this window belongs to. The resolver emits
    // the window before the economy events, so the client must decide against
    // THIS revision rather than its own last-seen counter.
    stateRevision: state.stateRevision,
    initiatingCommandId: window.initiatingCommandId,
    moverId: window.moverId,
    reactionId: window.reactionId,
    currentReactorId: reactorId,
    reactorQueue: [...window.reactorQueue],
    triggerCell: { ...window.triggerCell },
    reactionPolicy: reactorId === null ? 'auto' : engineReactionPolicyFor(state, reactorId),
    abilityId: reaction?.abilityId ?? '',
    committedCells: window.continuation.committedCells.map((cell) => ({ x: cell.x, y: cell.y })),
  });
};

/**
 * Maps one kernel event onto the bridge events the sidebar already consumes.
 *
 * Log text is derived from the RESOLVED event — never from the command — so a
 * miss reads as a miss. `eidFor` translates the kernel's authored combatant id
 * back to the runtime entity id the UI keys HP bars and floating text on.
 */
export const mapCombatEventToBridge = (options: {
  event: CombatEvent;
  bridge: EngineBridge;
  state: CombatState;
  eidFor: (combatantId: string) => number;
  activeEntities: number[];
}): void => {
  const { event, bridge, state, eidFor, activeEntities } = options;

  const hpOf = (combatantId: string): { hp: number; maxHp: number } => {
    const combatant = state.combatants[combatantId];
    return { hp: combatant?.hp ?? 0, maxHp: combatant?.maxHp ?? 0 };
  };

  switch (event.kind) {
    case 'attackRolled': {
      if (event.hit) {
        return; // `damageApplied` carries the hit — no duplicate log line.
      }
      const target = hpOf(event.targetId);
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${event.attackerId} misses ${event.targetId} (roll ${event.totalRoll})`,
        sourceId: eidFor(event.attackerId),
        targetId: eidFor(event.targetId),
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
      });
      return;
    }
    case 'damageApplied': {
      const target = hpOf(event.targetId);
      const targetEid = eidFor(event.targetId);
      bridge.emit({
        type: 'DAMAGE_DEALT',
        entityId: targetEid,
        amount: event.amount,
        isCritical: false,
        screenX: 0,
        screenY: 0,
        damageType: event.damageType,
      });
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${event.attackerId} hits ${event.targetId} for ${event.amount}`,
        sourceId: eidFor(event.attackerId),
        targetId: targetEid,
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
        damageType: event.damageType,
      });
      bridge.emit({
        type: 'COMBAT_STATE_UPDATE',
        entityHpMap: { [targetEid]: target.hp },
        entityMaxHpMap: { [targetEid]: target.maxHp },
      });
      return;
    }
    case 'combatantDowned':
    case 'combatantDefeated': {
      const target = hpOf(event.combatantId);
      bridge.emit({
        type: 'COMBAT_LOG',
        message:
          event.kind === 'combatantDowned'
            ? `${event.combatantId} is down`
            : `${event.combatantId} is defeated`,
        sourceId: eidFor(event.combatantId),
        targetId: eidFor(event.combatantId),
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
      });
      return;
    }
    case 'turnStarted': {
      // C-532 (review F4): publish the authored identity alongside the eid so
      // the UI can apply companion control ownership without inferring it.
      bridge.emit({
        type: 'TURN_CHANGED',
        currentEntityId: eidFor(event.combatantId),
        activeEntities,
        stateRevision: state.stateRevision,
        activeCombatantId: event.combatantId,
        combatantIdsByEntity: combatantIdsByEntityFor(state, eidFor),
        // Review F-B: the command-admission envelope the client must bind to.
        encounterRunId: state.encounterRunId,
        ...(state.turnId === null ? {} : { turnId: state.turnId }),
      });
      return;
    }
    case 'reactionWindowOpened': {
      // C-532 AC-3: the encounter is now suspended on this window until the
      // reactor decides, so the surface must be told before anything else.
      const window = state.reaction.windows.find((entry) => entry.windowId === event.windowId);
      if (window !== undefined) {
        _emitReactionOpened({ bridge, state, window });
      }
      return;
    }
    case 'reactionResolved': {
      // The queue may still hold reactors: the SAME window advances to the next
      // one (same windowId, new version), and nothing else would ask it. A
      // window newly opened by the resumed move announces itself through its
      // own `reactionWindowOpened`, so only a same-id window is re-emitted.
      const advanced = state.reaction.windows.find((entry) => entry.windowId === event.windowId);
      if (advanced !== undefined) {
        _emitReactionOpened({ bridge, state, window: advanced });
      }
      return;
    }
    case 'combatEnded': {
      // C-532 (review F9): the terminal event is emitted by the caller AFTER
      // the final `COMBAT_EVENTS_RESOLVED` batch, so the presentation run still
      // has its facts when it ends. Mapping it here would end narration first
      // and drop the terminal batch. Deliberately a no-op.
      return;
    }
    default: {
      // Movement and round bookkeeping have no sidebar representation yet.
      return;
    }
  }
};

/** Projects the resolved state's authored ids through the identity registry. */
const combatantIdsByEntityFor = (
  state: CombatState,
  eidFor: (combatantId: string) => number,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const combatantId of Object.keys(state.combatants)) {
    const entityId = eidFor(combatantId);
    if (entityId !== 0) {
      map[String(entityId)] = combatantId;
    }
  }
  return map;
};

/** Emits the action-economy event for every combatant whose budget changed. */
export const emitEconomyChanges = (options: {
  bridge: EngineBridge;
  state: CombatState;
  previous: CombatState;
  eidFor: (combatantId: string) => number;
}): void => {
  const { bridge, state, previous, eidFor } = options;
  for (const [combatantId, combatant] of Object.entries(state.combatants)) {
    const before = previous.combatants[combatantId];
    if (before === undefined) {
      continue;
    }
    const changed =
      before.budget.movementRemaining !== combatant.budget.movementRemaining ||
      before.budget.actionAvailable !== combatant.budget.actionAvailable ||
      before.budget.quickActionAvailable !== combatant.budget.quickActionAvailable ||
      before.budget.reactionAvailable !== combatant.budget.reactionAvailable;
    if (!changed) {
      continue;
    }
    const entityId = eidFor(combatantId);
    if (entityId === 0) {
      continue;
    }
    bridge.emit({
      type: 'ACTION_ECONOMY_CHANGED',
      entityId,
      movementRemaining: combatant.budget.movementRemaining,
      actionAvailable: combatant.budget.actionAvailable,
      quickActionAvailable: combatant.budget.quickActionAvailable,
      bonusActionAvailable: combatant.budget.quickActionAvailable,
      reactionAvailable: combatant.budget.reactionAvailable,
      stateRevision: state.stateRevision,
    });
  }
};
