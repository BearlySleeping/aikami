// packages/shared/utils/src/lib/rules/combat_tactical.ts
//
// Pure tactical query + forecast layer for Combat 2.0 — "what can the active
// combatant legally do, and what would happen if it did it?".
//
// Snapshot-in / value-out: every export is a pure function of its arguments,
// never mutates the input state, never advances the RNG, emits no events and
// performs no I/O. There is no engine, ECS, client, AI or network dependency.
//
// Module graph (must stay acyclic):
//   combat_spatial.ts  ← combat_tactical.ts
//   combat_kernel.ts   ← combat_tactical.ts
// `combat_kernel.ts` must never import this module — that would close a cycle.
//
// Contract: C-515 AC-2, AC-3, AC-4

import type {
  ActionForecast,
  CombatAbilityDefinition,
  CombatCommand,
  CombatInvalidReason,
  CombatPreviewWarning,
  CombatState,
  GridPoint,
  TurnBudget,
} from '@aikami/types';
import { COMBAT_MESSAGE_KEYS, validateCombatCommand } from './combat_kernel';
import { cellKey, computeReachableEndpoints, pathTraversalCost } from './combat_spatial';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

/** Total order on combatant ids — the deterministic target ordering. */
const compareCombatantIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const isAttackKind = (ability: CombatAbilityDefinition): boolean =>
  ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';

const isFriendlyTeam = (team: string): boolean => team === 'player' || team === 'ally';

const emptyBudget = (): TurnBudget => ({
  movementRemaining: 0,
  actionAvailable: false,
  quickActionAvailable: false,
  reactionAvailable: false,
});

/**
 * Cells occupied by every combatant other than `combatantId`.
 *
 * Occupancy blocks endpoints but never line of sight.
 */
const occupiedCells = (state: CombatState, combatantId: string): GridPoint[] => {
  const cells: GridPoint[] = [];
  for (const combatant of Object.values(state.combatants)) {
    if (combatant.combatantId === combatantId) {
      continue;
    }
    cells.push({ x: combatant.position.x, y: combatant.position.y });
  }
  return cells;
};

// ---------------------------------------------------------------------------
// getLegalActions (AC-2, AC-3)
// ---------------------------------------------------------------------------

export type GetLegalActionsOptions = {
  state: CombatState;
  combatantId: string;
};

export type GetLegalActionsResult = {
  /** Reachable movement endpoints, sorted by `y` then `x`. */
  endpoints: GridPoint[];
  /** Shortest traversal cost per reachable endpoint. */
  costTo: Record<string, number>;
  /** Legal target ids per ability id, sorted by combatant id. */
  targetsByAbility: Record<string, string[]>;
  /** The combatant's current turn budget. */
  budget: TurnBudget;
};

/**
 * Cells occupied by every combatant other than `combatantId`.
 *
 * Occupancy blocks endpoints but never line of sight. Exported so the engine's
 * preview path applies the exact same occupancy rule as `getLegalActions`.
 */
export const occupiedCellsFor = (options: {
  state: CombatState;
  combatantId: string;
}): GridPoint[] => occupiedCells(options.state, options.combatantId);

/**
 * Every legal action available to `combatantId` in `state`.
 *
 * Targets are derived by delegating to `validateCombatCommand` one target at a
 * time, so the legal set is by construction exactly the set the kernel accepts
 * — including the `abilityUnknown`/`abilityNotAvailable`/`noActionAvailable`
 * cases, which simply yield an empty list.
 */
export const getLegalActions = (options: GetLegalActionsOptions): GetLegalActionsResult => {
  const { state, combatantId } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return { endpoints: [], costTo: {}, targetsByAbility: {}, budget: emptyBudget() };
  }

  const reachable = computeReachableEndpoints({
    battlefield: state.battlefield,
    origin: actor.position,
    movementBudget: actor.budget.movementRemaining,
    occupied: occupiedCells(state, combatantId),
  });

  const targetsByAbility: Record<string, string[]> = {};
  for (const abilityId of [...actor.abilityIds].sort(compareCombatantIds)) {
    const legalTargetIds: string[] = [];
    for (const targetId of Object.keys(state.combatants).sort(compareCombatantIds)) {
      const result = validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId,
          abilityId,
          targetIds: [targetId],
        },
      });
      if (result.valid) {
        legalTargetIds.push(targetId);
      }
    }
    targetsByAbility[abilityId] = legalTargetIds;
  }

  return {
    endpoints: reachable.endpoints,
    costTo: reachable.costTo,
    targetsByAbility,
    budget: { ...actor.budget },
  };
};

// ---------------------------------------------------------------------------
// findCombatPathToCell (AC-8 — preview/commit path identity)
// ---------------------------------------------------------------------------

/** Four-neighbourhood offsets, in a deterministic order. */
const PATH_STEP_OFFSETS = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
] as const;

export type FindCombatPathToCellOptions = {
  state: CombatState;
  combatantId: string;
  /** Destination cell the player clicked. */
  to: GridPoint;
};

/**
 * The shortest legal move path from a combatant's position to `to`.
 *
 * Reconstructed from the SAME reachability projection
 * {@link getLegalActions} reports as `endpoints`/`costTo`, so the committed
 * path is the previewed path by construction — the client never sends a path.
 *
 * Returns `null` when `to` is not reachable within the movement budget, is
 * occupied, or is impassable; the caller turns that into `pathInvalid`.
 */
export const findCombatPathToCell = (options: FindCombatPathToCellOptions): GridPoint[] | null => {
  const { state, combatantId, to } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return null;
  }
  if (to.x === actor.position.x && to.y === actor.position.y) {
    return null; // Already standing there — never a legal move.
  }

  const reachable = computeReachableEndpoints({
    battlefield: state.battlefield,
    origin: actor.position,
    movementBudget: actor.budget.movementRemaining,
    occupied: occupiedCells(state, combatantId),
  });

  const costTo = (cell: GridPoint): number | undefined => reachable.costTo[cellKey(cell)];
  if (costTo(to) === undefined) {
    return null;
  }

  // Walk back along strictly decreasing cost until no cheaper neighbour exists.
  const reversed: GridPoint[] = [{ x: to.x, y: to.y }];
  let current: GridPoint = { x: to.x, y: to.y };
  const guard = reachable.endpoints.length + 2;
  for (let step = 0; step < guard; step++) {
    const currentCost = costTo(current);
    if (currentCost === undefined || currentCost <= 0) {
      break;
    }
    let best: GridPoint | null = null;
    let bestCost = currentCost;
    for (const offset of PATH_STEP_OFFSETS) {
      const candidate: GridPoint = { x: current.x + offset.x, y: current.y + offset.y };
      const cost = costTo(candidate);
      if (cost === undefined || cost >= currentCost || cost >= bestCost) {
        continue;
      }
      best = candidate;
      bestCost = cost;
    }
    if (best === null) {
      break;
    }
    reversed.push(best);
    current = best;
  }

  const last = reversed[reversed.length - 1];
  if (last === undefined) {
    return null;
  }
  // The chain must end on the cell the actor steps into first: orthogonally
  // adjacent to the actor. Otherwise the reconstruction is not a real path and
  // the kernel would reject it — fail here instead of committing a bad path.
  if (Math.abs(last.x - actor.position.x) + Math.abs(last.y - actor.position.y) !== 1) {
    return null;
  }

  return reversed.reverse();
};

// ---------------------------------------------------------------------------
// forecastCombatAction (AC-4)
// ---------------------------------------------------------------------------

export type ForecastCombatActionOptions = {
  state: CombatState;
  command: CombatCommand;
};

export type ForecastResult =
  | { valid: true; forecast: ActionForecast }
  | { valid: false; reasonCode: CombatInvalidReason; messageKey: string };

/**
 * Advisory hit chance for a d20 attack roll.
 *
 * Natural 20 always hits, natural 1 always misses. Computed analytically —
 * never by rolling, so the forecast cannot advance the RNG.
 */
const forecastHitChance = (options: {
  attackBonus: number;
  abilityBonus: number;
  armorClass: number;
}): number => {
  const bonus = options.attackBonus + options.abilityBonus;
  let hits = 1; // natural 20
  for (let roll = 2; roll <= 19; roll++) {
    if (roll + bonus >= options.armorClass) {
      hits++;
    }
  }
  return hits / 20;
};

/** Non-critical damage range parsed from the catalog dice expression. */
const forecastDamageRange = (
  damageDice: string | null,
): { minimum: number; maximum: number } | undefined => {
  if (damageDice === null) {
    return undefined;
  }
  const match = DAMAGE_DICE_PATTERN.exec(damageDice);
  if (match === null) {
    return undefined;
  }
  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  return { minimum: count + bonus, maximum: count * sides + bonus };
};

/**
 * A deterministic, non-mutating projection of one proposed command.
 *
 * Returns a typed rejection (never a throw) when `validateCombatCommand`
 * rejects the command. On success the input state is untouched, no event is
 * emitted and no RNG substream moves — `hitChance`/`damageRange` are advisory
 * projections, not dice results.
 */
export const forecastCombatAction = (options: ForecastCombatActionOptions): ForecastResult => {
  const { state, command } = options;
  const validation = validateCombatCommand({ state, command });
  if (!validation.valid) {
    return {
      valid: false,
      reasonCode: validation.reasonCode,
      messageKey: validation.messageKey,
    };
  }

  const normalized = validation.normalizedCommand;
  const actor = state.combatants[normalized.combatantId];
  const warnings: CombatPreviewWarning[] = [];

  switch (normalized.kind) {
    case 'move': {
      return {
        valid: true,
        forecast: {
          path: normalized.path.map((cell) => ({ x: cell.x, y: cell.y })),
          movementCost: pathTraversalCost({
            battlefield: state.battlefield,
            path: normalized.path,
          }),
          actionCost: 'movement',
          reactionRisks: [],
          objectiveEffects: [],
          warnings,
        },
      };
    }

    case 'useAbility': {
      const ability = state.abilityCatalog[normalized.abilityId];
      const targetIds = [...normalized.targetIds];
      const affectedCells: GridPoint[] = [];
      for (const targetId of targetIds) {
        const target = state.combatants[targetId];
        if (target !== undefined) {
          affectedCells.push({ x: target.position.x, y: target.position.y });
        }
      }

      const forecast: ActionForecast = {
        actionCost: ability.actionCost,
        affectedCells,
        affectedEntityIds: targetIds,
        reactionRisks: [],
        objectiveEffects: [],
        warnings,
      };

      if (isAttackKind(ability)) {
        const armorClass = targetIds.reduce((maximum, targetId) => {
          const target = state.combatants[targetId];
          return target === undefined ? maximum : Math.max(maximum, target.armorClass);
        }, 0);
        forecast.hitChance = forecastHitChance({
          attackBonus: actor.attackBonus,
          abilityBonus: ability.attackBonus,
          armorClass,
        });
        const damageRange = forecastDamageRange(ability.damageDice);
        if (damageRange !== undefined) {
          forecast.damageRange = damageRange;
        }
      }

      if (
        isFriendlyTeam(actor.team) &&
        targetIds.some((targetId) => {
          const target = state.combatants[targetId];
          return target !== undefined && isFriendlyTeam(target.team);
        })
      ) {
        warnings.push('affectsAlly');
      }

      return { valid: true, forecast };
    }

    case 'defend':
    case 'wait': {
      return {
        valid: true,
        forecast: {
          actionCost: 'action',
          reactionRisks: [],
          objectiveEffects: [],
          warnings,
        },
      };
    }

    case 'endTurn': {
      return {
        valid: true,
        forecast: {
          actionCost: 'action',
          reactionRisks: [],
          objectiveEffects: [],
          warnings: ['endsTurn'],
        },
      };
    }

    default: {
      return {
        valid: false,
        reasonCode: 'invalidCommandShape',
        messageKey: COMBAT_MESSAGE_KEYS.invalidCommandShape,
      };
    }
  }
};
