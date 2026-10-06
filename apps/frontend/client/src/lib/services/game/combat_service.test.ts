// apps/frontend/client/src/lib/services/game/combat_service.test.ts
import { expect, spyOn, test } from 'bun:test';
import { combatService } from './combat_service.svelte.ts';
import { gameEngineService } from './game_engine_service.svelte.ts';

test('accepted combat resumes worker/render ticks instead of pausing the turn driver', () => {
  const pause = spyOn(gameEngineService, 'pauseEngine').mockImplementation(() => {});
  const resume = spyOn(gameEngineService, 'resumeEngine').mockImplementation(() => {});
  let overlay = '';
  try {
    combatService.startCombat({
      enemyName: 'Rollo the Grasper',
      enemyNpcId: 'rollo_grasper',
      enemyHp: 20,
      enemyMaxHp: 20,
      participantIds: [1, 2],
      firstTurnEntityId: 1,
      encounterId: 'inn_wand_encounter',
      setActive: (type) => {
        overlay = type;
      },
    });
    expect(overlay).toBe('COMBAT');
    expect(combatService.enemyNpcId).toBe('rollo_grasper');
    expect(pause).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledTimes(1);
  } finally {
    pause.mockRestore();
    resume.mockRestore();
  }
});

test.each([13, 0])('authoritative HP %i is retained by encounter retries', (enemyHp) => {
  const resume = spyOn(gameEngineService, 'resumeEngine').mockImplementation(() => {});
  const setActive = () => {};
  try {
    combatService.startCombat({
      enemyName: 'Rollo the Grasper',
      enemyNpcId: 'rollo_grasper',
      enemyHp: 80,
      enemyMaxHp: 80,
      participantIds: [1, 2],
      firstTurnEntityId: 1,
      encounterId: 'inn_wand_encounter',
      allowNonCombatResolution: true,
      setActive,
    });
    const previousOptions = combatService.lastCombatOptions;

    combatService.updateEnemyHp({ enemyHp, enemyMaxHp: 20 });

    expect(combatService.enemyHp).toBe(enemyHp);
    expect(combatService.enemyMaxHp).toBe(20);
    expect(combatService.lastCombatOptions).toEqual({
      ...previousOptions,
      enemyHp,
      enemyMaxHp: 20,
    });

    combatService.retryEncounter({ setActive });

    expect(combatService.enemyHp).toBe(enemyHp);
    expect(combatService.enemyMaxHp).toBe(20);
    expect(combatService.enemyNpcId).toBe('rollo_grasper');
  } finally {
    resume.mockRestore();
  }
});
