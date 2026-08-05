// apps/frontend/client/src/lib/data/music_track_catalog.ts
//
// Curated vibe tags for the local music library.
//
// TrackRegistryService derives tags from the asset-manifest path
// (e.g. "music:exploration:Chainsmoker" → ["exploration", "Chainsmoker"]).
// That yields sparse scene matching — a forest scene produces
// ["ambient", "calm", "forest"] which shares no overlap with "exploration".
//
// This catalog augments each track with rich vibe tags so scene-context
// matching (sceneToMusicTags → findBestMatch) actually finds "similar
// songs that match the vibe". Keys are the manifest track tags; add a new
// entry when you drop a new track into static/game-data/music/.
//
// Contract: C-243 (asset manifest), C-249 (music tags)
/** biome-ignore-all lint/style/useNamingConvention: keys are asset-manifest tags (snake_case) */

/**
 * Track tag (manifest id) → extra vibe tags merged into the registry entry.
 *
 * Vibe vocabulary mirrors {@link sceneToMusicTags}: ambient, calm, forest,
 * exploration, town, atmospheric, neutral, dark, mysterious, quiet, dungeon,
 * combat, intense, epic, desert, snow, etc.
 */
export const MUSIC_VIBE_TAGS: Readonly<Record<string, readonly string[]>> = {
  'music:exploration:Chainsmoker': ['exploration', 'forest', 'ambient', 'calm', 'town'],
  'music:exploration:bgm_explore': ['exploration', 'forest', 'ambient', 'calm', 'town'],
  'music:combat:bgm_combat': ['combat', 'intense', 'epic'],
} as const;

/** Human-readable fallback title for a track id (used when the registry derives none). */
export const MUSIC_TRACK_TITLES: Readonly<Record<string, string>> = {
  'music:exploration:Chainsmoker': 'Chainsmoker',
  'music:exploration:bgm_explore': 'Emberwatch Explore',
  'music:combat:bgm_combat': 'Emberwatch Combat',
} as const;
