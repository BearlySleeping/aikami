// packages/frontend/engine/src/combat/combat_encounter_validation.ts
//
// Roster validation for a v2 encounter start.
//
// Validation runs BEFORE a single entity is created: a roster that cannot be
// spawned must be rejected as a typed result so the caller can fall back to the
// legacy engine for that encounter (Migration & Rollback), never spawn a
// partial fight.
//
// Split out of `combat_encounter_start.ts` (which owns materialisation and the
// per-world engine pin) so each module stays inside the source-file-size limit;
// validation has no dependency on spawning.
//
// Contract: C-516 AC-2, AC-3

import type { CombatInvalidReason } from '@aikami/types';
import { COMBAT_MESSAGE_KEYS } from '@aikami/utils';
import type { CombatEncounterRoster, StartEncounterResult } from './combat_encounter_start.ts';

/**
 * The typed rejection every encounter-start path returns.
 *
 * Shared with `combat_encounter_start.ts`, whose materialisation step reports
 * the same vocabulary — one constructor, so the two can never drift.
 */
export const encounterStartRejection = (reasonCode: CombatInvalidReason): StartEncounterResult => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Validates the whole roster before a single entity is created.
 *
 * Returns a typed rejection on the first problem; the caller then runs the
 * encounter on the legacy engine (Migration & Rollback: "a missing
 * catalog/roster/capability falls back to the legacy engine for that
 * encounter").
 */
export const validateEncounterRoster = (options: {
  roster: CombatEncounterRoster;
  /** Battle map size, when a terrain grid is loaded. */
  battlefieldSize?: { width: number; height: number };
}): StartEncounterResult | null => {
  const { roster, battlefieldSize } = options;

  if (roster.encounterId === '') {
    return encounterStartRejection('invalidCommandShape');
  }
  if (roster.participants.length === 0) {
    return encounterStartRejection('invalidCommandShape');
  }

  const playerCount = roster.participants.filter((entry) => entry.team === 'player').length;
  if (playerCount !== 1) {
    return encounterStartRejection('actorUnknown');
  }

  const ids = new Set<string>();
  const cells = new Set<string>();
  for (const participant of roster.participants) {
    if (participant.combatantId === '' || ids.has(participant.combatantId)) {
      return encounterStartRejection('invalidCommandShape');
    }
    ids.add(participant.combatantId);

    // Cells are solved before validation; a missing cell here would be a
    // programming error, and it must still never spawn a partial roster.
    const cell = participant.cell;
    if (cell === undefined) {
      return encounterStartRejection('invalidCommandShape');
    }
    const cellKey = `${cell.x}:${cell.y}`;
    if (cells.has(cellKey)) {
      return encounterStartRejection('targetInvalid');
    }
    cells.add(cellKey);

    if (battlefieldSize !== undefined) {
      const { x, y } = cell;
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= battlefieldSize.width ||
        y >= battlefieldSize.height
      ) {
        return encounterStartRejection('pathInvalid');
      }
    }

    // A player slot may omit stats (the live entity is authoritative); every
    // other slot must carry authored stats or the roster is incomplete.
    if (participant.stats === undefined) {
      if (participant.team !== 'player') {
        return encounterStartRejection('invalidCommandShape');
      }
      continue;
    }
    const { hitPoints, armorClass, attackBonus, initiative } = participant.stats;
    if (
      !isFiniteNumber(hitPoints) ||
      hitPoints < 1 ||
      !isFiniteNumber(armorClass) ||
      !isFiniteNumber(attackBonus) ||
      !isFiniteNumber(initiative)
    ) {
      return encounterStartRejection('invalidCommandShape');
    }
  }

  return null;
};
