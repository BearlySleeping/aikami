// packages/shared/constants/src/lib/music.ts
//
// Music DJ constants — scene type labels, music tags, provider labels,
// and default settings. Consumed by the Music DJ agent, track registry,
// and music settings UI.
//
// Contract: C-249

import type { MusicProviderType, MusicSettings } from '@aikami/types';

// ---------------------------------------------------------------------------
// Scene Type Constants
// ---------------------------------------------------------------------------

/** All recognized scene types for per-scene track overrides. */
export const SCENE_TYPES = ['combat', 'exploration', 'town', 'tavern', 'menu', 'boss'] as const;

export type SceneType = (typeof SCENE_TYPES)[number];

/** Human-readable labels for each scene type. */
export const SCENE_TYPE_LABELS: Record<SceneType, string> = {
  combat: 'Combat',
  exploration: 'Exploration',
  town: 'Town',
  tavern: 'Tavern',
  menu: 'Menu',
  boss: 'Boss',
} as const;

// ---------------------------------------------------------------------------
// Music Tag Constants
// ---------------------------------------------------------------------------

/** Genre tags for music tracks. */
export const GENRE_TAGS = [
  'ambient',
  'combat',
  'exploration',
  'town',
  'menu',
  'epic',
  'mysterious',
  'tavern',
  'dungeon',
  'forest',
  'desert',
  'snow',
  'underwater',
] as const;

/** Intensity tags for music tracks. */
export const INTENSITY_TAGS = ['calm', 'moderate', 'intense', 'epic'] as const;

/** Mood tags for music tracks. */
export const MOOD_TAGS = [
  'dark',
  'cheerful',
  'mysterious',
  'tense',
  'triumphant',
  'sad',
  'peaceful',
  'heroic',
  'whimsical',
  'melancholic',
] as const;

/** Default tag assigned when a track has no tags. */
export const DEFAULT_TRACK_TAG = 'generic';

// ---------------------------------------------------------------------------
// Provider Constants
// ---------------------------------------------------------------------------

/** Music provider options for the selector UI. */
export const MUSIC_PROVIDERS: readonly {
  id: MusicProviderType;
  label: string;
  enabled: boolean;
  comingSoon: boolean;
}[] = [
  { id: 'local', label: 'Local Assets', enabled: true, comingSoon: false },
  { id: 'spotify', label: 'Spotify', enabled: false, comingSoon: true },
  { id: 'youtube', label: 'YouTube', enabled: false, comingSoon: true },
] as const;

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

/** Default music settings for new games. */
export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
  provider: 'local',
  crossfadeDurationMs: 1500,
  startMuted: false,
  sceneOverrides: [],
};

// ---------------------------------------------------------------------------
// DJ Agent Constants
// ---------------------------------------------------------------------------

/** DJ agent identifier. */
export const MUSIC_DJ_AGENT_ID = 'music-dj';

/** Maximum number of buffer cache entries for audio tracks. */
export const MAX_BUFFER_CACHE_ENTRIES = 50;

/** Preview duration in seconds. */
export const TRACK_PREVIEW_DURATION_SECONDS = 15;

/** Minimum time (ms) a track must play before the DJ can crossfade again. */
export const MIN_TRACK_PLAY_DURATION_MS = 5000;

/** Number of turns of hysteresis before the DJ changes BGM on scene flip. */
export const MUSIC_HYSTERESIS_TURNS = 2;

/** DJ agent timeout in milliseconds. */
export const MUSIC_DJ_AGENT_TIMEOUT_MS = 500;

/** Crossfade duration range (ms). */
export const CROSSFADE_DURATION_MIN_MS = 500;
export const CROSSFADE_DURATION_MAX_MS = 5000;
export const CROSSFADE_DURATION_DEFAULT_MS = 1500;
