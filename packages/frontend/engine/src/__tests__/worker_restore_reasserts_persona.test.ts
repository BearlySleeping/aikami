// packages/frontend/engine/src/__tests__/worker_restore_reasserts_persona.test.ts

import { describe, expect, test } from 'bun:test';
import { addEntity, createWorld } from 'bitecs';
import { Appearance, getAppearanceLayers, setAppearanceLayers } from '../components/appearance.ts';
import { restorePlayerAppearance } from '../worker/player_appearance_restore.ts';

const PERSONA_LAYERS = [5, 3, 49, 24, 19, 102];
const STALE_SAVED_LAYERS = [5, 3, 23, 24, 7, 102];

describe('RESTORE_PLAYER reasserts the persona base layers', () => {
  test.each(['existing', 'absent', 'same'] as const)(
    '%s player receives persona layers',
    (mode) => {
      const world = createWorld();
      // Reserve entity zero, which the worker uses as the no-player sentinel.
      addEntity(world);
      const restoredEid = addEntity(world);
      const existingEid = addEntity(world);
      const playerEid = { absent: 0, same: restoredEid, existing: existingEid }[mode];
      setAppearanceLayers(world, restoredEid, STALE_SAVED_LAYERS);
      setAppearanceLayers(world, existingEid, [1, 2, 3, 4, 5, 6]);

      const result = restorePlayerAppearance({
        world,
        playerEid,
        restoredEid,
        personaLayers: PERSONA_LAYERS,
      });

      expect(result).toBe(mode === 'existing' ? existingEid : restoredEid);
      expect(getAppearanceLayers(result)).toEqual(PERSONA_LAYERS);
      expect(Appearance.layer2[result]).toBe(49);
      expect(Appearance.layer4[result]).toBe(19);
      if (mode === 'existing') {
        expect(getAppearanceLayers(restoredEid)).toEqual(STALE_SAVED_LAYERS);
      }
    },
  );

  test.each([{ personaLayers: undefined }, { personaLayers: [] }])(
    'retains saved layers when persona supplies %j',
    ({ personaLayers }) => {
      const world = createWorld();
      addEntity(world);
      const restoredEid = addEntity(world);
      setAppearanceLayers(world, restoredEid, STALE_SAVED_LAYERS);
      const result = restorePlayerAppearance({ world, playerEid: 0, restoredEid, personaLayers });
      expect(getAppearanceLayers(result)).toEqual(STALE_SAVED_LAYERS);
    },
  );
});
