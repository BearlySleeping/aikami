// apps/frontend/client/src/lib/services/audio/track_registry_service.svelte.ts
//
// TrackRegistryService — maintains a reactive registry of music tracks
// discovered from the asset manifest (C-243). Provides tag-based
// search and scene-type track override resolution.
//
// Contract: C-249

import { DEFAULT_TRACK_TAG, type SceneType } from '@aikami/constants';
import type {
  AssetEntry,
  MusicSceneContext,
  SceneTrackOverride,
  Track,
  TrackSource,
} from '@aikami/types';
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import { assetStore } from '../assets/asset_store.svelte';
import { sceneToMusicTags } from './scene_to_music_tags';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrackRegistryServiceOptions = BaseClassOptions;

export type TrackRegistryServiceInterface = BaseClassInterface & {
  /** All registered tracks. */
  readonly tracks: Track[];
  /** Whether the initial discovery scan is complete. */
  readonly isReady: boolean;
  /** Scene-type track overrides (from game save settings). */
  readonly sceneOverrides: SceneTrackOverride[];

  /** Discover local tracks from the asset manifest. */
  discoverLocal(): Promise<void>;
  /**
   * Finds the best matching track for a set of tags.
   * Returns the track with the highest tag overlap score, or null if no match.
   */
  findBestMatch(tags: string[]): Track | null;
  /**
   * Resolves the track to play for a given scene context.
   * Checks scene-type overrides first, then falls back to tag-based matching.
   */
  resolveTrackForScene(scene: MusicSceneContext): Track | null;
  /** Sets the scene-type track overrides (from game save settings). */
  setSceneOverrides(overrides: SceneTrackOverride[]): void;
  /** Gets a track by ID. */
  getTrackById(id: string): Track | undefined;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TrackRegistryService
  extends BaseClass<TrackRegistryServiceOptions>
  implements TrackRegistryServiceInterface
{
  tracks = $state<Track[]>([]);
  isReady = $state<boolean>(false);
  sceneOverrides = $state<SceneTrackOverride[]>([]);

  /** Play count cache for fallback selection. */
  private readonly _playCounts = new Map<string, number>();

  // ── Public API ──

  /** @inheritdoc */
  async discoverLocal(): Promise<void> {
    this.debug('discoverLocal:start');

    // Ensure manifest is loaded
    if (!assetStore.manifest) {
      this.debug('discoverLocal:fetching-manifest');
      await assetStore.fetchManifest();
    }

    if (!assetStore.manifest) {
      this.debug('discoverLocal:no-manifest');
      return;
    }

    const musicEntries: AssetEntry[] = [];

    // Collect all music category entries from the manifest
    const byCategory = assetStore.manifest.byCategory;
    for (const category of ['music'] as const) {
      const entries = byCategory[category];
      if (entries) {
        musicEntries.push(...entries);
      }
    }

    const discovered: Track[] = [];

    for (const entry of musicEntries) {
      const id = entry.tag;
      const url = assetStore.resolveUrl(entry.tag);

      if (!url) {
        continue;
      }

      // Extract tags from the tag path and subcategory
      // Tag format: "music:ambient:forest" → tags: ["ambient", "forest"]
      // Subcategory: "combat/intense" → tags: ["combat", "intense"]
      const tags = this._extractTags(entry);

      // Format a display title from the name
      const title = this._formatTitle(entry.name);

      discovered.push({
        id,
        title,
        artist: undefined,
        source: 'local' as TrackSource,
        duration: undefined,
        url,
        tags,
      });
    }

    // Deduplicate by URL — same file = one entry
    const deduped = this._deduplicateByUrl(discovered);

    this.tracks = deduped;
    this.isReady = true;

    this.debug('discoverLocal:done', { count: deduped.length });
  }

  /** @inheritdoc */
  findBestMatch(tags: string[]): Track | null {
    if (this.tracks.length === 0) {
      return null;
    }

    if (tags.length === 0) {
      return null;
    }

    // Score each track by tag overlap
    let bestTrack: Track | null = null;
    let bestScore = 0;

    const tagSet = new Set(tags.map((t) => t.toLowerCase()));

    for (const track of this.tracks) {
      const trackTags = track.tags.map((t) => t.toLowerCase());
      const overlap = trackTags.filter((t) => tagSet.has(t)).length;

      if (overlap > bestScore) {
        bestScore = overlap;
        bestTrack = track;
      }
    }

    // If no tag match at all, return null (no forced track)
    if (bestScore === 0) {
      // Fall back to most-played track
      return this._getMostPlayedTrack();
    }

    return bestTrack;
  }

  /** @inheritdoc */
  resolveTrackForScene(scene: MusicSceneContext): Track | null {
    // Determine likely scene type from context
    const sceneType = this._inferSceneType(scene);
    if (sceneType) {
      // Check for user override
      const override = this.sceneOverrides.find((o) => o.sceneType === sceneType);
      if (override && override.trackId !== 'auto') {
        const track = this.getTrackById(override.trackId);
        if (track) {
          return track;
        }
        this.warn('resolveTrackForScene:override-track-not-found', {
          sceneType,
          trackId: override.trackId,
        });
        // Fall through to tag-based matching
      }
    }

    // Tag-based matching
    const tags = sceneToMusicTags(scene);
    return this.findBestMatch(tags);
  }

  /** @inheritdoc */
  setSceneOverrides(overrides: SceneTrackOverride[]): void {
    this.sceneOverrides = [...overrides];
  }

  /** @inheritdoc */
  getTrackById(id: string): Track | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  // ── Private helpers ──

  /**
   * Extracts music tags from an asset entry's tag path and subcategory.
   *
   * Tag format: "music:ambient:forest" → tags: ["ambient", "forest"]
   * Subcategory: "combat/intense" → additional tags: ["combat", "intense"]
   */
  private _extractTags(entry: AssetEntry): string[] {
    const tags: string[] = [];

    // From tag path parts after "music:"
    const tagParts = entry.tag.split(':');
    for (let i = 1; i < tagParts.length; i++) {
      const part = tagParts[i].toLowerCase().trim();
      if (part && part !== 'music') {
        tags.push(part);
      }
    }

    // From subcategory path
    if (entry.subcategory) {
      const subParts = entry.subcategory.split(/[/\\]/);
      for (const part of subParts) {
        const trimmed = part.toLowerCase().trim();
        if (trimmed && !tags.includes(trimmed)) {
          tags.push(trimmed);
        }
      }
    }

    // Default tag if none extracted
    if (tags.length === 0) {
      tags.push(DEFAULT_TRACK_TAG);
    }

    return tags;
  }

  /**
   * Formats a display title from a filename/slug.
   * "combat-boss-dark" → "Combat Boss Dark"
   */
  private _formatTitle(name: string): string {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * Deduplicates tracks by URL — same file in manifest twice = one entry.
   */
  private _deduplicateByUrl(tracks: Track[]): Track[] {
    const seen = new Map<string, Track>();
    for (const track of tracks) {
      const key = track.url ?? track.id;
      if (!seen.has(key)) {
        seen.set(key, track);
      }
    }
    return [...seen.values()];
  }

  /**
   * Infers the scene type from the scene context.
   */
  private _inferSceneType(scene: MusicSceneContext): SceneType | null {
    if (scene.isInCombat) {
      if (scene.combatIntensity === 'boss') {
        return 'boss';
      }
      return 'combat';
    }

    const locationLower = scene.locationType.toLowerCase();
    if (locationLower.includes('tavern') || locationLower.includes('inn')) {
      return 'tavern';
    }
    if (
      locationLower.includes('town') ||
      locationLower.includes('city') ||
      locationLower.includes('village')
    ) {
      return 'town';
    }

    return 'exploration';
  }

  /**
   * Returns the most-played track as a fallback when no tag match is found.
   * Returns null if no tracks have been played.
   */
  private _getMostPlayedTrack(): Track | null {
    if (this.tracks.length === 0) {
      return null;
    }

    let mostPlayed: Track | null = null;
    let maxCount = -1;

    for (const track of this.tracks) {
      const count = this._playCounts.get(track.id) ?? 0;
      if (count > maxCount) {
        maxCount = count;
        mostPlayed = track;
      }
    }

    // If no track has been played, return the first one
    if (maxCount === 0) {
      return this.tracks[0] ?? null;
    }

    return mostPlayed;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const trackRegistryService: TrackRegistryServiceInterface = TrackRegistryService.create({
  className: 'TrackRegistryService',
}) as TrackRegistryServiceInterface;
