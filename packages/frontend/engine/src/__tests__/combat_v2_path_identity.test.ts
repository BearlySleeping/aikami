// packages/frontend/engine/src/__tests__/combat_v2_path_identity.test.ts
//
// Review F3/F-D: a confirmed movement path must not silently become a different
// path with the same endpoint, and a frozen preview/query must change neither
// state nor RNG.
//
// Failure classes locked down here:
//   3. a frozen preview/query changes neither state nor RNG
//   4. a confirmed movement path cannot silently become a different path that
//      ends on the same tile
//
// Contract: C-515 AC-5, C-516 AC-8, C-525 AC-4

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import { findCombatPathToCell } from '@aikami/utils';
import { getCombatSessionRevision } from '../combat/combat_session_checkpoint.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { GridPosition } from '../components/grid_position.ts';
import {
  type CombatEncounterHarness,
  buildCombatEncounterHarness,
} from './support/combat_encounter_harness.ts';

let harness: CombatEncounterHarness;

beforeEach(() => {
  harness = buildCombatEncounterHarness();
});

afterEach(() => {
  harness.dispose();
});

const playerPosition = () => ({
  x: GridPosition.x[harness.playerEid] ?? 0,
  y: GridPosition.y[harness.playerEid] ?? 0,
});

describe('review F3: a confirmed path is preserved or the command is stale', () => {
  it('executes the confirmed path when it matches the engine reconstruction', () => {
    const state = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(state).not.toBeNull();
    if (state === null) {
      return;
    }
    const destination = { x: 1, y: 3 };
    const confirmed = findCombatPathToCell({
      state,
      combatantId: 'player',
      to: destination,
    });
    expect(confirmed).not.toBeNull();
    if (confirmed === null) {
      return;
    }

    harness.dispatch({
      type: 'COMBAT_MOVE',
      cellX: destination.x,
      cellY: destination.y,
      path: confirmed,
    });

    expect(harness.rejected).toHaveLength(0);
    expect(playerPosition()).toEqual(destination);
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(1);
  });

  it('refuses a materially different path that ends on the same tile', () => {
    const state = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    if (state === null) {
      return;
    }
    const destination = { x: 1, y: 3 };
    const confirmed = findCombatPathToCell({ state, combatantId: 'player', to: destination });
    expect(confirmed).not.toBeNull();
    if (confirmed === null) {
      return;
    }
    // A different route to the SAME destination: valid movement, but not the
    // command the player approved.
    const detour = [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
    expect(detour.at(-1)).toEqual(destination);
    expect(detour).not.toEqual(confirmed);

    const before = playerPosition();
    const revisionBefore = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    const sessionBefore = getCombatSessionRevision(harness.world);

    harness.dispatch({
      type: 'COMBAT_MOVE',
      cellX: destination.x,
      cellY: destination.y,
      path: detour,
    });

    // The confirmation is stale — the UI must re-preview, not execute.
    expect(harness.rejected.at(-1)?.reasonCode).toBe('staleRevision');
    expect(playerPosition()).toEqual(before);
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(revisionBefore);
    expect(getCombatSessionRevision(harness.world)).toBe(sessionBefore);
  });

  it('refuses a confirmed path that is the same route with an extra cell', () => {
    const state = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    if (state === null) {
      return;
    }
    const destination = { x: 1, y: 2 };
    const confirmed = findCombatPathToCell({ state, combatantId: 'player', to: destination });
    expect(confirmed).not.toBeNull();
    if (confirmed === null) {
      return;
    }
    const before = playerPosition();
    harness.dispatch({
      type: 'COMBAT_MOVE',
      cellX: destination.x,
      cellY: destination.y,
      // Same endpoint, one extra step appended: not the approved command.
      path: [...confirmed, { x: 1, y: 3 }],
    });
    expect(harness.rejected.at(-1)?.reasonCode).toBe('staleRevision');
    expect(playerPosition()).toEqual(before);
  });
});

describe('review F1: a frozen preview/query changes neither state nor RNG', () => {
  it('repeated previews leave state, RNG and the accepted boundary untouched', () => {
    // Project once so the live state exists.
    const initial = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(initial).not.toBeNull();
    if (initial === null) {
      return;
    }
    const rngBefore = JSON.stringify(initial.rng);
    const revisionBefore = initial.stateRevision;
    const sessionBefore = getCombatSessionRevision(harness.world);
    const hpBefore = CombatStats.health[harness.enemyEid];
    const positionBefore = playerPosition();

    for (let attempt = 0; attempt < 3; attempt++) {
      harness.dispatchRaw({
        type: 'COMBAT_PREVIEW_REQUESTED',
        requestId: `preview-${attempt}`,
        encounterId: initial.encounterId,
        basedOnRevision: revisionBefore,
        query: { kind: 'legalMoves', combatantId: 'player' },
      });
      harness.dispatchRaw({
        type: 'COMBAT_PREVIEW_REQUESTED',
        requestId: `preview-targets-${attempt}`,
        encounterId: initial.encounterId,
        basedOnRevision: revisionBefore,
        query: { kind: 'legalTargets', combatantId: 'player', abilityId: 'basic_melee' },
      });
    }

    const after = getLiveV2CombatState(harness.world);
    expect(JSON.stringify(after?.rng)).toBe(rngBefore);
    expect(after?.stateRevision).toBe(revisionBefore);
    expect(getCombatSessionRevision(harness.world)).toBe(sessionBefore);
    expect(CombatStats.health[harness.enemyEid]).toBe(hpBefore);
    expect(playerPosition()).toEqual(positionBefore);
  });
});
