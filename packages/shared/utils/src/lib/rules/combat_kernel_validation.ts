// packages/shared/utils/src/lib/rules/combat_kernel_validation.ts
//
// Command validation and normalization for the combat kernel.
//
// Extracted from `combat_kernel.ts` as a cohesive boundary (C-532): the kernel
// stays the ordered transactional pipeline (validate -> commit a movement prefix
// -> suspend/resume a reaction -> run the resolution pass -> apply), while every
// pure "may this command run, and in what normalized shape" question lives here.
//
// The functions are pure: they never touch engine state and never throw. The
// kernel re-exports the public entry points (`validateCombatCommand`,
// `CombatCommandInput`) so their import site is unchanged.
//
// Contract: C-509 AC-1, AC-2; C-532 AC-2, AC-3

import { CombatCommandSchema } from '@aikami/schemas';
import type {
  CombatantState,
  CombatCommand,
  CombatInvalidReason,
  CombatState,
  CombatValidationResult,
  GridPoint,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { validateEnvironmentalCommand } from './combat_environment';
import { COMBAT_MESSAGE_KEYS } from './combat_message_keys';
import {
  authoredMoraleResponse,
  distanceToExitZone,
  retreatIsPermitted,
  stillContestsEncounter,
  surrenderIsPermitted,
} from './combat_morale';
import { reactionRequestIsCurrent } from './combat_reactions';
import { hasLineOfSight, isCellImpassable, pathTraversalCost } from './combat_spatial';
import { checkBudgetCost } from './combat_turn_coordinator';

const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const activeCombatantId = (state: CombatState): string | null =>
  state.initiative.order[state.initiative.activeIndex] ?? null;

/** A typed rejection carrying the stable i18n key for its reason code. */
export const failure = (reasonCode: CombatInvalidReason) => ({
  valid: false as const,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

const normalizeCommand = (command: CombatCommand): CombatCommand => {
  switch (command.kind) {
    case 'move':
    case 'retreat':
      return {
        kind: command.kind,
        combatantId: command.combatantId,
        path: command.path.map((cell) => ({ x: cell.x, y: cell.y })),
      };
    case 'useAbility':
      return {
        kind: 'useAbility',
        combatantId: command.combatantId,
        abilityId: command.abilityId,
        targetIds: [...new Set(command.targetIds)].sort(),
      };
    case 'defend':
      return { kind: 'defend', combatantId: command.combatantId };
    case 'wait':
      return { kind: 'wait', combatantId: command.combatantId };
    case 'endTurn':
      return { kind: 'endTurn', combatantId: command.combatantId };
    case 'interactWithObject':
      return {
        kind: 'interactWithObject',
        combatantId: command.combatantId,
        objectId: command.objectId,
        affordanceId: command.affordanceId,
        targetObjectId: command.targetObjectId,
      };
    default:
      return command;
  }
};

export type CombatCommandInput = {
  state: CombatState;
  command: CombatCommand;
  basedOnRevision?: number;
};

/**
 * Validates a movement path: in bounds, contiguous, non-repeating, unblocked,
 * and affordable. Shared with the kernel's continuation resume so a suspended
 * path is revalidated with exactly the rules an ordinary move uses.
 */
export const validateMove = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'move' }>,
  actor: CombatantState,
): CombatValidationResult => {
  const path = command.path;
  const battlefield = state.battlefield;
  const seen = new Set<string>();

  for (const cell of path) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      return failure('pathInvalid');
    }
    if (cell.x < 0 || cell.y < 0 || cell.x >= battlefield.width || cell.y >= battlefield.height) {
      return failure('pathInvalid');
    }
    if (cell.x === actor.position.x && cell.y === actor.position.y) {
      return failure('pathInvalid');
    }
    const key = `${cell.x}:${cell.y}`;
    if (seen.has(key)) {
      return failure('pathInvalid');
    }
    seen.add(key);
  }

  if (manhattan(actor.position, path[0]) !== 1) {
    return failure('pathInvalid');
  }
  for (let index = 1; index < path.length; index++) {
    if (manhattan(path[index - 1], path[index]) !== 1) {
      return failure('pathInvalid');
    }
  }
  for (const cell of path) {
    if (isCellImpassable({ battlefield, cell })) {
      return failure('pathBlocked');
    }
  }
  if (pathTraversalCost({ battlefield, path }) > actor.budget.movementRemaining) {
    return failure('movementBudgetExceeded');
  }
  return { valid: true, normalizedCommand: command };
};

const validateUseAbility = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'useAbility' }>,
  actor: CombatantState,
): CombatValidationResult => {
  const ability = state.abilityCatalog[command.abilityId];
  if (ability === undefined) {
    return failure('abilityUnknown');
  }
  if (!actor.abilityIds.includes(command.abilityId)) {
    return failure('abilityNotAvailable');
  }
  const costFailure = checkBudgetCost(actor.budget, ability.actionCost);
  if (costFailure !== null) {
    return failure(costFailure);
  }

  const isAttack = ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';
  if (isAttack && command.targetIds.length === 0) {
    return failure('targetInvalid');
  }
  for (const targetId of command.targetIds) {
    if (targetId === command.combatantId) {
      return failure('targetInvalid');
    }
    const target = state.combatants[targetId];
    if (target === undefined) {
      return failure('targetInvalid');
    }
    if (target.defeated) {
      return failure('targetDefeated');
    }
    // A surrendered or escaped actor has left participation and is not a legal
    // ordinary target, even though it keeps its HP and identity. Target
    // eligibility is enforced here at the authoritative boundary so the UI,
    // selectors and AI cannot disagree. Contract: C-532 AC-2.
    const participation = state.participation[targetId];
    if (participation !== undefined && !stillContestsEncounter(participation.status)) {
      return failure('targetNotParticipating');
    }
  }
  if (isAttack) {
    for (const targetId of command.targetIds) {
      const target = state.combatants[targetId];
      if (manhattan(actor.position, target.position) > ability.rangeCells) {
        return failure('targetOutOfRange');
      }
    }
  }
  // Line of sight is enforced for ANY ability whose catalog entry declares
  // `requiresLineOfSight` and that names at least one target — not only for
  // ranged attacks. An absent `blocksSight` grid means "no occlusion data", so
  // every C-509 fixture keeps its previous behaviour. Contract: C-515 AC-3.
  if (ability.requiresLineOfSight) {
    for (const targetId of command.targetIds) {
      const target = state.combatants[targetId];
      if (
        !hasLineOfSight({
          battlefield: state.battlefield,
          from: actor.position,
          to: target.position,
        })
      ) {
        return failure('targetNotVisible');
      }
    }
  }
  return { valid: true, normalizedCommand: command };
};

/**
 * A retreat is ordinary validated movement plus two authored-morale gates:
 * the encounter must offer a `retreat` response, the actor's morale must have
 * reached the break threshold, and the declared path must not increase the
 * actor's distance to the nearest authored exit-zone cell.
 *
 * Contract: C-532 AC-2
 */
const validateRetreat = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'retreat' }>,
  actor: CombatantState,
): CombatValidationResult => {
  const movement = validateMove(
    state,
    { kind: 'move', combatantId: command.combatantId, path: command.path },
    actor,
  );
  if (!movement.valid) {
    return movement;
  }
  const participation = state.participation[command.combatantId];
  if (participation === undefined || !retreatIsPermitted(state.moraleRules, participation)) {
    return failure('retreatNotAuthored');
  }
  const response = authoredMoraleResponse(state.moraleRules, 'retreat');
  if (response === null || response.exitZoneId === null) {
    return failure('retreatNotAuthored');
  }
  const destination = command.path[command.path.length - 1];
  const before = distanceToExitZone({
    rules: state.moraleRules,
    exitZoneId: response.exitZoneId,
    cell: actor.position,
  });
  const after = distanceToExitZone({
    rules: state.moraleRules,
    exitZoneId: response.exitZoneId,
    cell: destination,
  });
  if (after > before) {
    return failure('retreatNotTowardExit');
  }
  return { valid: true, normalizedCommand: command };
};

/**
 * Surrender is legal only when the encounter authors a `surrender` response
 * and the actor's morale has reached the break threshold. It costs no budget
 * and deals no damage.
 *
 * Contract: C-532 AC-2
 */
const validateSurrender = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'surrender' }>,
): CombatValidationResult => {
  const participation = state.participation[command.combatantId];
  if (participation === undefined || !surrenderIsPermitted(state.moraleRules, participation)) {
    return failure('surrenderNotAuthored');
  }
  return { valid: true, normalizedCommand: command };
};

/**
 * Validates a reaction selection. Window identity, version, encounter-run
 * identity and actor identity are all revalidated here — before any resource
 * or RNG is spent — so a duplicate or stale choice is a no-op.
 */
const validateResolveReaction = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'resolveReaction' }>,
): CombatValidationResult => {
  if (command.encounterRunId !== state.encounterRunId) {
    return failure('encounterRunMismatch');
  }
  const window = state.reaction.windows.find((entry) => entry.windowId === command.windowId);
  if (window === undefined) {
    return failure('reactionNotPending');
  }
  if (
    !reactionRequestIsCurrent({
      window,
      windowId: command.windowId,
      windowVersion: command.windowVersion,
      reactorId: command.combatantId,
    })
  ) {
    return failure('reactionStale');
  }
  if (command.choice === 'accept') {
    const reactor = state.combatants[command.combatantId];
    const mover = state.combatants[window.moverId];
    const reaction = state.reactionRegistry.definitions.find(
      (entry) => entry.reactionId === window.reactionId,
    );
    // A reactor that has become INELIGIBLE since the window opened is not a
    // hard rejection: the resolution pass skips it deterministically and
    // advances the queue without spending a reaction or RNG. That keeps the
    // encounter from deadlocking when the UI already hid the now-illegal
    // choice. Contract: C-532 AC-3.
    if (reactor === undefined || mover === undefined || reaction === undefined) {
      return { valid: true, normalizedCommand: command };
    }
  }
  return { valid: true, normalizedCommand: command };
};

/**
 * Validates a command without touching the state and without ever throwing.
 * `basedOnRevision` is the only input that can produce `staleRevision`.
 */
export const validateCombatCommand = (input: CombatCommandInput): CombatValidationResult => {
  const { state } = input;

  if (!Value.Check(CombatCommandSchema, input.command)) {
    return failure('invalidCommandShape');
  }
  const command = normalizeCommand(input.command);

  if (input.basedOnRevision !== undefined && input.basedOnRevision !== state.stateRevision) {
    return failure('staleRevision');
  }
  if (state.phase === 'ended') {
    return failure('encounterEnded');
  }

  // A reaction window owns the encounter until it resolves: no other command
  // may execute while it is open. Contract: C-532 AC-3, AC-4.
  if (state.phase === 'reaction' && command.kind !== 'resolveReaction') {
    return failure('reactionPending');
  }
  if (command.kind === 'resolveReaction') {
    return validateResolveReaction(state, command);
  }

  const actor = state.combatants[command.combatantId];
  if (actor === undefined) {
    return failure('actorUnknown');
  }
  if (activeCombatantId(state) !== command.combatantId) {
    return failure('notActiveCombatant');
  }

  switch (command.kind) {
    case 'move':
      return validateMove(state, command, actor);
    case 'retreat':
      return validateRetreat(state, command, actor);
    case 'surrender':
      return validateSurrender(state, command);
    case 'useAbility':
      return validateUseAbility(state, command, actor);
    case 'defend':
    case 'wait':
      // Defend and wait both spend the action; Combat-01 gives them no other
      // observable budget effect and no event (a budget event is Combat-03).
      return actor.budget.actionAvailable
        ? { valid: true, normalizedCommand: command }
        : failure('noActionAvailable');
    case 'endTurn':
      return { valid: true, normalizedCommand: command };
    case 'interactWithObject':
      // Authored-object eligibility, costs, checks and selectors are owned by
      // the environmental registry; the kernel owns the commit boundary.
      // Contract: C-531 AC-2.
      return validateEnvironmentalCommand({
        state,
        actorId: command.combatantId,
        command,
      });
    default:
      return failure('invalidCommandShape');
  }
};
