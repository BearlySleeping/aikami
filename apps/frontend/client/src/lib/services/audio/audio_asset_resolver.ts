// apps/frontend/client/src/lib/services/audio/audio_asset_resolver.ts
//
// Audio asset resolution — routes BGM/SFX through the manifest-backed
// AssetStore + AssetManager (C-372/C-373 unified resolver) instead of hardcoded
// legacy /assets/audio/* URLs or hardcoded track tags.
//
// The manifest's `music` / `sfx` categories are the source of truth for what
// audio exists. Tracks are matched to scenes by their manifest tags
// (subcategory/tag-path segments, e.g. `music/exploration/Chainsmoker.mp3` →
// tag `exploration`). Resolved URLs flow through assetStore.resolveUrl →
// AssetManager (OPFS/Tauri-FS cache, then Firebase Storage / bundled sources).
//
// Returns null when no matching asset exists so callers can skip playback
// gracefully (no 404s, no console errors).
//
// Contract: C-150 Audio System, C-372 Unified Asset Resolver, C-373 Asset Sources

import type { AssetEntry } from '@aikami/types';
import { assetStore } from '../assets/asset_store.svelte';

/** Scene type → manifest tag segment used to match music tracks. */
const SCENE_TAG: Record<'explore' | 'combat', string> = {
  explore: 'exploration',
  combat: 'combat',
};

/** Monotonically increasing request ID for BGM transition serialization. */
let _bgmRequestId = 0;

/** Manifest category names consumed by this resolver. */

/**
 * Ensures the asset manifest is loaded before resolving URLs.
 * Idempotent — resolves immediately when already loaded.
 */
const ensureManifestLoaded = async (): Promise<void> => {
  if (!assetStore.manifest) {
    await assetStore.fetchManifest();
  }
};

/**
 * Extracts search tags from an asset entry — every path segment after the
 * category prefix plus the subcategory segments. Mirrors the semantics used by
 * TrackRegistryService.discoverLocal.
 *
 * @example 'music:exploration:Chainsmoker' + subcategory 'exploration'
 *   → ['exploration', 'Chainsmoker']
 */
const extractTags = (entry: AssetEntry): string[] => {
  const tags: string[] = [];

  const tagParts = entry.tag.split(':');
  for (let i = 1; i < tagParts.length; i++) {
    const part = tagParts[i]?.toLowerCase().trim();
    if (part && !tags.includes(part)) {
      tags.push(part);
    }
  }

  if (entry.subcategory) {
    for (const part of entry.subcategory.split(/[/\\]/)) {
      const trimmed = part.toLowerCase().trim();
      if (trimmed && !tags.includes(trimmed)) {
        tags.push(trimmed);
      }
    }
  }

  return tags;
};

/**
 * Finds the first manifest entry of a category matching every required tag.
 * Returns undefined when no entry matches all tags.
 */
const findEntryByTags = (
  entries: readonly AssetEntry[],
  requiredTags: readonly string[],
): AssetEntry | undefined => {
  if (requiredTags.length === 0) {
    return undefined;
  }
  for (const entry of entries) {
    const tags = extractTags(entry);
    if (requiredTags.every((t) => tags.includes(t))) {
      return entry;
    }
  }
  return undefined;
};

/**
 * Resolves a BGM URL for the given scene, or null when no music asset exists.
 *
 * Picks a manifest `music` entry whose tags match the scene (e.g. a track under
 * `music/exploration/...` for the explore scene, `music/combat/...` for combat),
 * falling back to the first indexed music entry. No track names are hardcoded —
 * adding/removing tracks in the manifest (or Firebase Storage) just works.
 *
 * @param scene - Scene type ('explore' | 'combat').
 * @returns A resolvable URL, or null (caller should skip playback).
 */
export const resolveBgmUrl = async (scene: 'explore' | 'combat'): Promise<string | null> => {
  await ensureManifestLoaded();
  const manifest = assetStore.manifest;
  if (!manifest) {
    return null;
  }

  const musicEntries = manifest.byCategory.music ?? [];
  if (musicEntries.length === 0) {
    return null;
  }

  const sceneTag = SCENE_TAG[scene];
  const matched = findEntryByTags(musicEntries, [sceneTag]);
  const entry = matched ?? musicEntries[0];
  if (!entry) {
    return null;
  }
  return assetStore.resolveUrl(entry.tag);
};

/**
 * Resolves an SFX URL by file name or tag (extension-insensitive), or null when
 * no matching SFX asset exists.
 *
 * @param name - SFX base name, e.g. 'sfx_hit' or 'hit'.
 * @returns A resolvable URL, or null (caller should skip playback).
 */
export const resolveSfxUrl = async (name: string): Promise<string | null> => {
  await ensureManifestLoaded();
  const manifest = assetStore.manifest;
  if (!manifest) {
    return null;
  }

  const normalized = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const sfxEntries = manifest.byCategory.sfx ?? [];

  // Exact name match first.
  const exact = sfxEntries.find((e) => e.name.toLowerCase() === normalized);
  if (exact) {
    return assetStore.resolveUrl(exact.tag);
  }

  // Tag match (e.g. 'hit' matches an entry tagged 'hit').
  const byTag = findEntryByTags(sfxEntries, [normalized]);
  if (byTag) {
    return assetStore.resolveUrl(byTag.tag);
  }

  // Suffix match — e.g. 'hit' matches 'sfx_hit'.
  const suffix = sfxEntries.find((e) => e.name.toLowerCase().endsWith(normalized));
  if (suffix) {
    return assetStore.resolveUrl(suffix.tag);
  }
  return null;
};

/**
 * Resolves an ambient sound URL by tag, or null when no ambient asset exists.
 *
 * @param tag - Ambient tag segment, e.g. 'nature', 'urban', 'interior'.
 */
export const resolveAmbientUrl = async (tag: string): Promise<string | null> => {
  await ensureManifestLoaded();
  const manifest = assetStore.manifest;
  if (!manifest) {
    return null;
  }
  const ambientEntries = manifest.byCategory.ambient ?? [];
  const entry = findEntryByTags(ambientEntries, [tag.toLowerCase()]) ?? ambientEntries[0];
  if (!entry) {
    return null;
  }
  return assetStore.resolveUrl(entry.tag);
};

/**
 * Plays a resolved BGM URL, skipping when no asset exists.
 * Convenience wrapper so call sites stay one-liners.
 *
 * Serializes transitions through a recency guard so rapid concurrent calls
 * (e.g., combat start + mood change) don't race — only the most recent
 * request's transition completes.
 *
 * @param scene - Scene type ('explore' | 'combat').
 * @param durationMs - Crossfade duration in milliseconds (default 1500).
 */
export const playSceneBgm = async (
  scene: 'explore' | 'combat',
  durationMs?: number,
): Promise<void> => {
  const requestId = ++_bgmRequestId;
  const url = await resolveBgmUrl(scene);
  if (!url || requestId !== _bgmRequestId) {
    return;
  }
  const { audioService } = await import('$services');
  await audioService.transitionToBgm(url, durationMs);
};

/**
 * Plays a resolved SFX URL, skipping when no asset exists.
 */
export const playSfxByName = async (name: string): Promise<void> => {
  const url = await resolveSfxUrl(name);
  if (!url) {
    return;
  }
  const { audioService } = await import('$services');
  await audioService.playSfx(url);
};
