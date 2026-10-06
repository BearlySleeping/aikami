// packages/frontend/engine/src/worker/player_appearance_restore.ts

import type { World } from 'bitecs';
import {
  getAppearanceLayers,
  resolvePlayerBaseLayers,
  setAppearanceLayers,
} from '../components/appearance.ts';

/** Reasserts persona layers for both copy and adoption restores, without worker globals. */
export const restorePlayerAppearance = (options: {
  world: World;
  playerEid: number;
  restoredEid: number;
  personaLayers: readonly number[] | undefined;
}): number => {
  const playerEid = options.playerEid > 0 ? options.playerEid : options.restoredEid;
  const layers = resolvePlayerBaseLayers({
    restored: getAppearanceLayers(options.restoredEid),
    fromPersona: options.personaLayers,
  });
  setAppearanceLayers(options.world, playerEid, layers);
  return playerEid;
};
