// apps/frontend/client/src/lib/utils/music_utils.ts
//
// Music scene context builder — derives a MusicSceneContext from live game
// state. Extracted from music_player_service.svelte.ts so the service only
// exports its singleton instance (guard S9).

import type { MusicSceneContext } from '@aikami/types';
import { gameEngineService, gameOverlayService, timeService } from '$services';

/**
 * Builds a MusicSceneContext from the live game state:
 * current map name → location type, game clock → time of day,
 * rain intensity → weather, overlay state → combat.
 *
 * Module-level so ViewModels can watch the reactive inputs and push the
 * refreshed context into the music player service.
 */
export const buildMusicSceneContext = (): MusicSceneContext => {
  // Prefer the live scene name; fall back to the loaded map id when the
  // engine hasn't reported a named scene yet (e.g. before first movement).
  const rawScene =
    gameEngineService.playerScene && gameEngineService.playerScene !== 'unknown'
      ? gameEngineService.playerScene
      : gameEngineService.currentMapId;
  const scene = rawScene ?? '';
  let locationType: MusicSceneContext['locationType'];
  if (scene.includes('village')) {
    locationType = 'village';
  } else if (scene.includes('road') || scene.includes('forest')) {
    locationType = 'forest';
  } else if (scene.includes('shrine') || scene.includes('dungeon')) {
    locationType = 'dungeon';
  } else {
    locationType = 'wilderness';
  }

  const hour = timeService.gameHour;
  let timeOfDay: MusicSceneContext['timeOfDay'];
  if (hour >= 21 || hour < 5) {
    timeOfDay = 'night';
  } else if (hour >= 17) {
    timeOfDay = 'evening';
  } else if (hour >= 12) {
    timeOfDay = 'afternoon';
  } else {
    timeOfDay = 'morning';
  }

  const rain = timeService.rainIntensity;
  let weather: MusicSceneContext['weather'];
  if (rain > 0.5) {
    weather = 'storm';
  } else if (rain > 0.05) {
    weather = 'rain';
  } else {
    weather = 'clear';
  }

  const isInCombat = gameOverlayService.activeOverlay === 'COMBAT';

  return {
    locationType,
    timeOfDay,
    weather,
    isInCombat,
    combatIntensity: isInCombat ? 'medium' : undefined,
    mood: 'neutral',
    lastNarrative: '',
  };
};
