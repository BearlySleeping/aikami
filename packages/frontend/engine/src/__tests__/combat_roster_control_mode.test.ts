// packages/frontend/engine/src/__tests__/combat_roster_control_mode.test.ts
//
// C-526 AC-6 (runtime effect): a companion's persisted control mode decides who
// owns its turn. `direct` hands the turn to the player; every other mode leaves
// it AI-driven. Without this the mode is a persisted field nobody reads, which
// is exactly the review finding this test locks down.
//
// Contract: C-526 AC-6

import { describe, expect, it } from 'bun:test';
import { controllerFor, isPlayerControlled } from '../combat/combat_roster.ts';
import { Companion } from '../components/companion.ts';

const PLAYER_ENTITY = 1;

/** Registers a companion entity directly in the component's SoA arrays. */
const companionEntity = (eid: number, controlMode: string | undefined): number => {
  Companion.npcId[eid] = 'emberwatch/mira';
  Companion.approval[eid] = 0;
  Companion.recruited[eid] = true;
  if (controlMode === undefined) {
    delete Companion.controlMode[eid];
  } else {
    Companion.controlMode[eid] = controlMode;
  }
  return eid;
};

const enemyEntity = (eid: number): number => {
  Companion.recruited[eid] = false;
  return eid;
};

describe('C-526 AC-6: control mode decides turn ownership', () => {
  it('gives a direct-mode companion to the player, not the AI', () => {
    const eid = companionEntity(9001, 'direct');
    expect(controllerFor(eid, PLAYER_ENTITY)).toBe('player');
    expect(isPlayerControlled(eid, PLAYER_ENTITY)).toBe(true);
  });

  it('keeps every other mode AI-driven', () => {
    for (const mode of ['suggest', 'intent', 'autonomous']) {
      const eid = companionEntity(9002, mode);
      expect(controllerFor(eid, PLAYER_ENTITY)).toBe('companion_ai');
      expect(isPlayerControlled(eid, PLAYER_ENTITY)).toBe(false);
    }
  });

  it('treats an unset mode as AI-driven (pre-526 saves unchanged)', () => {
    const eid = companionEntity(9003, undefined);
    expect(controllerFor(eid, PLAYER_ENTITY)).toBe('companion_ai');
  });

  it('never hands an enemy turn to the player', () => {
    const eid = enemyEntity(9004);
    expect(controllerFor(eid, PLAYER_ENTITY)).toBe('enemy_ai');
    expect(isPlayerControlled(eid, PLAYER_ENTITY)).toBe(false);
  });

  it('always keeps the player themself player-controlled', () => {
    expect(controllerFor(PLAYER_ENTITY, PLAYER_ENTITY)).toBe('player');
    expect(isPlayerControlled(PLAYER_ENTITY, PLAYER_ENTITY)).toBe(true);
  });
});
