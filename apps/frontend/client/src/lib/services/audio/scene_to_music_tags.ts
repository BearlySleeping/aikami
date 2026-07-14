// apps/frontend/client/src/lib/services/audio/scene_to_music_tags.ts
//
// Pure utility: maps scene context to music tags for track selection.
// Used by the Music DJ agent and track registry service.
//
// Contract: C-249

import type { MusicSceneContext } from '@aikami/types';
import { logger } from '$logger';

/**
 * Maps a music scene context to an array of music tags for track matching.
 *
 * The tag vector combines tags from location, time of day, weather,
 * combat state, and mood. Tags are weighted by specificity:
 * - Combat/boss → highest priority (intense, epic)
 * - Time of day → medium priority (night → dark, quiet)
 * - Location → medium priority (tavern → atmospheric, neutral)
 * - Mood → descriptor (cheerful, tense, etc.)
 *
 * @param scene - The current scene context from the world state agent.
 * @returns Array of music tags for track matching, ordered by priority.
 */
export const sceneToMusicTags = (scene: MusicSceneContext): string[] => {
  logger.debug('sceneToMusicTags', { locationType: scene.locationType, mood: scene.mood });

  const tags: string[] = [];

  // ── Combat state (highest priority) ──
  if (scene.isInCombat) {
    const intensity = scene.combatIntensity ?? 'medium';
    if (intensity === 'boss') {
      tags.push('epic', 'intense', 'combat', 'boss');
    } else if (intensity === 'high') {
      tags.push('intense', 'combat', 'epic');
    } else {
      tags.push('combat', 'intense');
    }
    return tags; // Combat overrides all other tags
  }

  // ── Location type ──
  const locationLower = scene.locationType.toLowerCase();
  if (locationLower.includes('tavern') || locationLower.includes('inn')) {
    tags.push('atmospheric', 'neutral', 'tavern');
  } else if (locationLower.includes('dungeon') || locationLower.includes('cave')) {
    tags.push('dark', 'mysterious', 'dungeon');
  } else if (locationLower.includes('forest') || locationLower.includes('wood')) {
    tags.push('ambient', 'calm', 'forest');
  } else if (
    locationLower.includes('town') ||
    locationLower.includes('city') ||
    locationLower.includes('village')
  ) {
    tags.push('atmospheric', 'neutral', 'town');
  } else if (locationLower.includes('desert')) {
    tags.push('ambient', 'desert');
  } else if (
    locationLower.includes('snow') ||
    locationLower.includes('tundra') ||
    locationLower.includes('mountain')
  ) {
    tags.push('ambient', 'calm', 'snow');
  } else {
    tags.push('ambient', 'exploration');
  }

  // ── Time of day ──
  const timeLower = scene.timeOfDay.toLowerCase();
  if (timeLower === 'night' || timeLower === 'midnight' || timeLower === 'evening') {
    tags.push('dark', 'quiet');
  } else if (timeLower === 'morning' || timeLower === 'dawn') {
    tags.push('calm', 'peaceful');
  }

  // ── Weather ──
  const weatherLower = scene.weather.toLowerCase();
  if (weatherLower.includes('storm') || weatherLower.includes('rain')) {
    tags.push('tense', 'dark');
  } else if (weatherLower.includes('snow')) {
    tags.push('calm', 'peaceful');
  }

  // ── Mood ──
  const moodLower = scene.mood.toLowerCase();
  if (moodLower.includes('tense') || moodLower.includes('fear')) {
    tags.push('tense');
  } else if (moodLower.includes('cheerful') || moodLower.includes('joy')) {
    tags.push('cheerful');
  } else if (moodLower.includes('mysterious') || moodLower.includes('suspense')) {
    tags.push('mysterious');
  } else if (moodLower.includes('sad') || moodLower.includes('grief')) {
    tags.push('sad', 'melancholic');
  } else if (moodLower.includes('triumphant') || moodLower.includes('heroic')) {
    tags.push('triumphant', 'heroic');
  } else if (moodLower.includes('peaceful')) {
    tags.push('peaceful', 'calm');
  }

  return tags;
};
