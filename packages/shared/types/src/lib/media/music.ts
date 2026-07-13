// packages/shared/types/src/lib/music.ts
//
// Domain types for the Music DJ Audio Player system (C-249).
// Track, MusicCue, MusicSceneContext, and related types
// shared across the client pipeline.
//
// Contract: C-249

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

/** Source type for a music track. */
export type TrackSource = 'local' | 'spotify' | 'youtube';

/** A single music track in the registry. */
export type Track = {
  /** Unique track identifier. */
  id: string;
  /** Human-readable track title. */
  title: string;
  /** Artist or composer name. */
  artist?: string;
  /** Track source type. */
  source: TrackSource;
  /** Duration in seconds. */
  duration?: number;
  /** Source-specific URL for playback. */
  url?: string;
  /** Spotify URI (spotify:track:xxx). */
  spotifyUri?: string;
  /** YouTube video ID. */
  youtubeVideoId?: string;
  /** Tags describing the track (genre, intensity, mood, scene type). */
  tags: string[];
  /** Volume override (0-1) relative to BGM volume. */
  volume?: number;
};

// ---------------------------------------------------------------------------
// Music Cue
// ---------------------------------------------------------------------------

/** Possible actions the DJ agent can emit. */
export type MusicCueAction =
  | { type: 'play'; trackId: string; fadeInMs?: number }
  | { type: 'crossfade'; trackId: string; durationMs?: number }
  | { type: 'pause'; fadeOutMs?: number }
  | { type: 'volume'; target: 'music' | 'sfx' | 'master'; level: number }
  | { type: 'none'; reason?: string };

/** Structured output from the Music DJ agent. */
export type MusicCue = {
  /** The action to take. */
  action: MusicCueAction;
  /** Why this cue was selected (for debug/logging). */
  reasoning: string;
  /** The scene context that triggered this cue. */
  sceneTags: string[];
};

// ---------------------------------------------------------------------------
// Music Scene Context
// ---------------------------------------------------------------------------

/** Scene context passed to the Music DJ agent for track selection. */
export type MusicSceneContext = {
  /** Current location type (town, dungeon, forest, tavern, etc.). */
  locationType: string;
  /** Time of day (morning, afternoon, evening, night). */
  timeOfDay: string;
  /** Weather condition. */
  weather: string;
  /** Whether the party is in combat. */
  isInCombat: boolean;
  /** Combat intensity if in combat (none, low, medium, high, boss). */
  combatIntensity?: string;
  /** Narrative mood (tense, cheerful, mysterious, sad, triumphant). */
  mood: string;
  /** The last AI message text (for mood inference). */
  lastNarrative: string;
};

// ---------------------------------------------------------------------------
// Music Provider
// ---------------------------------------------------------------------------

/** Music provider type. */
export type MusicProviderType = 'local' | 'spotify' | 'youtube';

/** Per-scene-type track assignment override. */
export type SceneTrackOverride = {
  /** Scene type key (e.g. "combat", "exploration", "town"). */
  sceneType: string;
  /** Assigned track ID, or 'auto' for DJ agent selection. */
  trackId: string | 'auto';
};

// ---------------------------------------------------------------------------
// Music Settings (persisted)
// ---------------------------------------------------------------------------

/** Persisted music DJ settings (stored per-game save). */
export type MusicSettings = {
  /** Selected music provider. */
  provider: MusicProviderType;
  /** Crossfade duration in milliseconds (500–5000). */
  crossfadeDurationMs: number;
  /** Whether to start muted. */
  startMuted: boolean;
  /** Per-scene-type track override assignments. */
  sceneOverrides: SceneTrackOverride[];
};
