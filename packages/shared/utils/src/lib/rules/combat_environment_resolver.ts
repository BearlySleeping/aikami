// packages/shared/utils/src/lib/rules/combat_environment_resolver.ts
//
// Validation, commit and the round-boundary environmental rules.
//
// `validateEnvironmentalCommand` is pure (no mutation, no dice) so the object
// inspector, a preview and a commit all agree. `applyEnvironmentalCommand`
// resolves against a state clone the kernel owns: a rejection means the caller
// discards that clone, so no tentative mutation and no RNG advance survives.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

import { COMBAT_ENVIRONMENT_BOUNDS } from '@aikami/schemas';
import type {
  BattlefieldObjectDefinition,
  CombatEnvironmentBundle,
  CombatEvent,
  CombatEventEnvelope,
  CombatInteractWithObjectCommand,
  CombatInvalidReason,
  CombatState,
} from '@aikami/types';
import type { SeedableRng } from '../rng/seedable_rng';
import {
  applyDamageToCombatant,
  applyEffect,
  type EffectContext,
  removeSurface,
  spendAffordanceCost,
} from './combat_environment_effects';
import {
  type EnvironmentalEligibility,
  type EnvironmentalResolution,
  failure,
  REGISTERED_HAZARD_FAMILIES,
  rejection,
  rollDice,
  sortedObjects,
  sortedSurfaces,
  toValidationFailure,
} from './combat_environment_internal';
import {
  evaluateAffordanceEligibility,
  resolveCheckModifier,
} from './combat_environment_selectors';

// ---------------------------------------------------------------------------
// Validation (AC-2)
// ---------------------------------------------------------------------------

/**
 * Validates an environmental command without touching state and without
 * rolling dice.
 *
 * `targetObjectId` is normalized to `null` when absent so a commit and a
 * preview hash identically.
 */
export const validateEnvironmentalCommand = (options: {
  state: CombatState;
  actorId: string;
  command: CombatInteractWithObjectCommand;
}): EnvironmentalEligibility => {
  const { state, command } = options;
  const actor = state.combatants[options.actorId];
  if (actor === undefined) {
    return toValidationFailure(failure('actorUnknown'));
  }

  const object = state.environment.objects[command.objectId];
  if (object === undefined) {
    return toValidationFailure(failure('objectUnknown'));
  }
  const definition: BattlefieldObjectDefinition | undefined =
    state.environmentBundle.objectDefinitions[object.definitionId];
  if (definition === undefined) {
    return toValidationFailure(failure('objectUnknown'));
  }

  const affordance = state.environmentBundle.affordances[command.affordanceId];
  if (affordance === undefined) {
    return toValidationFailure(failure('affordanceUnknown'));
  }
  if (!definition.affordanceIds.includes(command.affordanceId)) {
    return toValidationFailure(failure('affordanceNotAvailable'));
  }
  if (!object.affordanceIds.includes(command.affordanceId)) {
    // A broken, extinguished or missing object cannot retain stale actions.
    return toValidationFailure(
      failure(object.state === 'broken' ? 'objectDestroyed' : 'affordanceNotAvailable'),
    );
  }

  const eligibility = evaluateAffordanceEligibility({
    state,
    actor,
    object,
    affordance,
    targetObjectId: command.targetObjectId,
  });
  if (!eligibility.ok) {
    return toValidationFailure(eligibility);
  }

  return {
    valid: true,
    normalizedCommand: {
      kind: 'interactWithObject',
      combatantId: command.combatantId,
      objectId: command.objectId,
      affordanceId: command.affordanceId,
      targetObjectId: command.targetObjectId,
    },
  };
};

// ---------------------------------------------------------------------------
// Resolution (AC-2)
// ---------------------------------------------------------------------------

export type ApplyEnvironmentalCommandOptions = {
  state: CombatState;
  actorId: string;
  command: CombatInteractWithObjectCommand;
  envelope: CombatEventEnvelope;
  rng: SeedableRng;
};

/**
 * Resolves one environmental command against `state` (a clone the caller owns).
 *
 * On success: the attempt cost is spent even when the check fails, effects run
 * in declared order, and every consequence is emitted as an event. On failure
 * the caller must discard `state` — the kernel never writes it back, so no
 * tentative mutation and no RNG advance survives.
 */
export const applyEnvironmentalCommand = (
  options: ApplyEnvironmentalCommandOptions,
): EnvironmentalResolution => {
  const { state, command, envelope, rng } = options;
  const actor = state.combatants[options.actorId];
  if (actor === undefined) {
    return rejection('actorUnknown');
  }
  const object = state.environment.objects[command.objectId];
  if (object === undefined) {
    return rejection('objectUnknown');
  }
  const affordance = state.environmentBundle.affordances[command.affordanceId];
  if (affordance === undefined) {
    return rejection('affordanceUnknown');
  }

  const events: CombatEvent[] = [];
  const context: EffectContext = {
    state,
    actor,
    source: object,
    target:
      command.targetObjectId === null
        ? undefined
        : state.environment.objects[command.targetObjectId],
    command,
    envelope,
    rng,
    events,
    cascade: { count: 0 },
  };

  // A legal attempted check consumes its declared cost even when the roll
  // fails — so the cost is spent before the dice.
  spendAffordanceCost({ actor, actionCost: affordance.actionCost });

  let success = true;
  if (affordance.check !== null) {
    const modifier = resolveCheckModifier({ actor, check: affordance.check });
    if (modifier === undefined) {
      return rejection('checkModifierUnavailable');
    }
    const naturalRoll = rng.dice(20);
    const total = naturalRoll + modifier;
    success = total >= affordance.check.dc;
    events.push({
      ...envelope,
      kind: 'environmentalCheckRolled',
      combatantId: actor.combatantId,
      objectId: object.objectId,
      affordanceId: affordance.affordanceId,
      checkCategory: affordance.check.category,
      modifierSource: affordance.check.modifierSource,
      modifier,
      naturalRoll,
      total,
      dc: affordance.check.dc,
      success,
    });
  }

  const branch = success ? affordance.successEffects : affordance.failureEffects;
  for (const effect of branch) {
    if (context.cascade.count > COMBAT_ENVIRONMENT_BOUNDS.effectExpansion) {
      // Transactional overflow: reject without retaining tentative mutation.
      return rejection('cascadeLimitExceeded');
    }
    applyEffect({ context, effect });
  }

  if (context.cascade.count > COMBAT_ENVIRONMENT_BOUNDS.effectExpansion) {
    return rejection('cascadeLimitExceeded');
  }

  return { ok: true, events };
};

// ---------------------------------------------------------------------------
// Round advance: surface expiry and hazard cadence (AC-3)
// ---------------------------------------------------------------------------

/**
 * Applies the environmental rules that fire when a round begins.
 *
 * Order is explicit and stable: surfaces whose `expiresAfterRound` has arrived
 * are removed first (so an expiring surface cannot also burn), then stale
 * hazard tick stamps are pruned, then each actor standing on a registered
 * hazard surface takes at most ONE hit from that hazard family this round.
 */
export const applyEnvironmentalRoundStart = (options: {
  state: CombatState;
  envelope: CombatEventEnvelope;
  rng: SeedableRng;
}): CombatEvent[] => {
  const { state, envelope, rng } = options;
  const events: CombatEvent[] = [];
  const round = state.round;

  const expired = state.environment.surfaces.filter(
    (surface) => surface.expiresAfterRound !== null && surface.expiresAfterRound <= round,
  );
  for (const surface of expired) {
    removeSurface({ state, envelope, events, surface, reason: 'expired' });
  }

  state.environment.hazardTickStamps = state.environment.hazardTickStamps.filter(
    (stamp) => stamp.round >= round,
  );

  const combatants = Object.values(state.combatants).sort((a, b) =>
    a.combatantId < b.combatantId ? -1 : 1,
  );
  for (const combatant of combatants) {
    if (combatant.defeated) {
      continue;
    }
    for (const family of Object.values(REGISTERED_HAZARD_FAMILIES)) {
      const onHazard = sortedSurfaces(state).some(
        (surface) =>
          surface.kind === family.surfaceKind &&
          surface.cell.x === combatant.position.x &&
          surface.cell.y === combatant.position.y,
      );
      if (!onHazard) {
        continue;
      }
      const stamped = state.environment.hazardTickStamps.some(
        (stamp) =>
          stamp.hazardFamilyId === family.hazardFamilyId &&
          stamp.actorId === combatant.combatantId &&
          stamp.round === round,
      );
      if (stamped) {
        continue;
      }
      const surface = sortedSurfaces(state).find(
        (candidate) =>
          candidate.kind === family.surfaceKind &&
          candidate.cell.x === combatant.position.x &&
          candidate.cell.y === combatant.position.y,
      );
      state.environment.hazardTickStamps.push({
        hazardFamilyId: family.hazardFamilyId,
        actorId: combatant.combatantId,
        round,
      });
      events.push({
        ...envelope,
        kind: 'hazardTickStamped',
        combatantId: combatant.combatantId,
        hazardFamilyId: family.hazardFamilyId,
        round,
      });
      const amount = rollDice(rng, family.diceExpression);
      applyDamageToCombatant({
        state,
        envelope,
        events,
        combatantId: combatant.combatantId,
        amount,
        damageType: family.damageType,
        sourceKind: 'hazard',
        sourceId: surface?.surfaceId ?? family.hazardFamilyId,
      });
    }
  }

  return events;
};

// ---------------------------------------------------------------------------
// Bundle helpers
// ---------------------------------------------------------------------------

/** Whether a bundle declares every definition a state references. */
export const validateEnvironmentBundle = (options: {
  bundle: CombatEnvironmentBundle;
  state: CombatState;
}): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { bundle, state } = options;
  for (const object of sortedObjects(state)) {
    const definition = bundle.objectDefinitions[object.definitionId];
    if (definition === undefined) {
      return failure('objectUnknown');
    }
    for (const affordanceId of object.affordanceIds) {
      if (
        definition.affordanceIds.includes(affordanceId) &&
        bundle.affordances[affordanceId] === undefined
      ) {
        return failure('affordanceUnknown');
      }
    }
  }
  for (const surface of state.environment.surfaces) {
    if (
      surface.sourceObjectId !== null &&
      state.environment.objects[surface.sourceObjectId] === undefined
    ) {
      return failure('objectUnknown');
    }
  }
  return { ok: true };
};
