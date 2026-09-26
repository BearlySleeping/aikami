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
// C-523 adds two things on top:
//
//  1. An *authored* cue (a `pack.audio.v1` binding for the current map/context)
//     resolves by declared identity/hash instead of the first-tag-match
//     heuristic below. Tracks with no authored binding keep that heuristic.
//  2. Every music request — map cue, combat state, and the Music DJ — passes
//     through one arbitration authority (`audio_cue_arbiter.ts`), so the DJ and
//     the map cannot start competing tracks.
//
// Contract: C-150 Audio System, C-372 Unified Asset Resolver, C-373 Asset Sources,
//           C-523 Emberwatch asset pilot and offline integration

import type { AssetEntry } from '@aikami/types';
import { isBgmSuppressedByPlayer } from '$lib/utils/music_playback_intent.ts';
import { assetStore } from '../assets/asset_store.svelte';
import { arbitrateAudioCue, createAudioCueArbiterState } from './audio_cue_arbiter.ts';
import { localAudioSource } from './audio_local_source.ts';
import { resolveAuthoredCue } from './authored_audio_cue_source.ts';

/** Scene type → manifest tag segment used to match music tracks. */
const SCENE_TAG: Record<'explore' | 'combat', string> = {
  explore: 'exploration',
  combat: 'combat',
};

/**
 * Monotonically increasing token for *authored resolution* ordering.
 *
 * Only a scene resolution claims this; a request that already has a resolved
 * URL (the DJ) must not invalidate an in-flight authored lookup.
 */
let _bgmRequestId = 0;

/**
 * Monotonically increasing token for *admitted playback* ordering.
 *
 * Claimed when the arbitration authority admits a transition, so a rejected
 * request can never cancel valid pending resolution or playback.
 */
let _playbackId = 0;

/** An admitted cue that has not started because the player suppressed music. */
let _pendingPlaybackId: number | undefined;

/**
 * The pack/map the game is currently in.
 *
 * Authored cue bindings are looked up against this, so the audio layer never
 * needs to import the game services (which already import the audio layer).
 * Empty until the boot path announces it — an empty context resolves to
 * "the pack authors nothing here", which keeps today's tag-first behavior.
 */
let _activeCueContext: { packId: string; mapId: string } = { packId: '', mapId: '' };

/** The arbitration authority's state — one active cue, at most one suspended. */
let _arbiterState = createAudioCueArbiterState();

/**
 * Records the pack/map the game is currently in.
 *
 * @param context - The pack id and map id to resolve authored cues against.
 */
export const setActiveAudioCueContext = (context: { packId: string; mapId: string }): void => {
  _activeCueContext = context;
};

/** The cue currently holding the arbitration authority, for observability. */
export const getActiveAudioCue = () => _arbiterState.active;

/**
 * Resets the arbitration authority and its ordering tokens.
 *
 * Called on game/pack teardown so a disposed session cannot leave a stale cue
 * holding the authority or an in-flight transition racing the next session.
 */
export const resetAudioCueAuthority = (): void => {
  _arbiterState = createAudioCueArbiterState();
  _activeCueContext = { packId: '', mapId: '' };
  _bgmRequestId += 1;
  _playbackId += 1;
  _pendingPlaybackId = undefined;
};

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
 * The tag segments a registry tag carries after its category prefix.
 *
 * Mirrors {@link extractTags} for a bare tag string, so a locally owned
 * `music:exploration:tavern-theme` matches the same scene a curated entry with
 * the same segments would (C-513 AC-10).
 */
const localTagSegments = (tag: string): string[] => {
  const segments: string[] = [];
  for (const part of tag.split(':').slice(1)) {
    const trimmed = part.toLowerCase().trim();
    if (trimmed && !segments.includes(trimmed)) {
      segments.push(trimmed);
    }
  }
  return segments;
};

/**
 * Resolves an audio tag this device owns, or null when it owns none.
 *
 * C-513 AC-10. The registry — not the manifest — is the source of truth for
 * community imports and generated audio, and `resolve` serves them from the
 * content-hash cache when the bytes are on device. Called only after the
 * curated manifest has had its chance, so a catalog asset always wins.
 *
 * @param options.category - Which audio family to search.
 * @param options.requiredTags - Segments that must all appear in a match.
 * @param options.fallbackToFirst - Accept the first owned tag when nothing
 *   matches (music/ambient degrade to "some track"; SFX must not, because
 *   playing the wrong sound is worse than silence).
 */
const resolveLocalAudio = async (options: {
  category: 'music' | 'sfx' | 'ambient';
  requiredTags: readonly string[];
  fallbackToFirst: boolean;
}): Promise<string | null> => {
  let tags: readonly string[];
  try {
    tags = await localAudioSource.listTags(options.category);
  } catch {
    // The registry is best-effort here: a device with no local assets is not
    // an error, and the caller already handles null.
    return null;
  }
  if (tags.length === 0) {
    return null;
  }

  const matching = tags.filter((candidate) =>
    options.requiredTags.every((segment) => localTagSegments(candidate).includes(segment)),
  );
  const candidates = options.fallbackToFirst
    ? [...matching, ...tags.filter((tag) => !matching.includes(tag))]
    : matching;
  for (const candidate of candidates) {
    const resolved = await localAudioSource.resolve(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
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

  // The curated catalog wins whenever it can answer at all.
  if (manifest) {
    const musicEntries = manifest.byCategory.music ?? [];
    if (musicEntries.length > 0) {
      const sceneTag = SCENE_TAG[scene];
      const matched = findEntryByTags(musicEntries, [sceneTag]);
      const entry = matched ?? musicEntries[0];
      if (entry) {
        return assetStore.resolveUrl(entry.tag);
      }
    }
  }

  // C-513 AC-10: nothing curated matched — a community-imported or generated
  // track this device owns is still playable, from the on-device cache and with
  // no network. This is also the whole offline path: with networking blocked the
  // seed never loads, so `manifest` stays null and this fallback carries the
  // scene.
  return resolveLocalAudio({
    category: 'music',
    requiredTags: [SCENE_TAG[scene]],
    fallbackToFirst: true,
  });
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
  const normalized = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');

  if (manifest) {
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
  }

  // C-513 AC-10: an imported/generated effect on this device. No fallback to an
  // arbitrary owned tag — playing the wrong sound is worse than silence.
  return resolveLocalAudio({
    category: 'sfx',
    requiredTags: [normalized],
    fallbackToFirst: false,
  });
};

/**
 * Resolves an ambient sound URL by tag, or null when no ambient asset exists.
 *
 * @param tag - Ambient tag segment, e.g. 'nature', 'urban', 'interior'.
 */
export const resolveAmbientUrl = async (tag: string): Promise<string | null> => {
  // C-523: an authored ambient binding for this tag is authoritative, exactly
  // as an authored music cue is. Unbound packs keep tag-first behavior.
  if (_activeCueContext.packId) {
    const authored = await resolveAuthoredCue({
      packId: _activeCueContext.packId,
      target: 'ambient',
      context: tag,
    });
    if (authored.authored) {
      return authored.url;
    }
  }

  await ensureManifestLoaded();
  const manifest = assetStore.manifest;

  if (manifest) {
    const ambientEntries = manifest.byCategory.ambient ?? [];
    const entry = findEntryByTags(ambientEntries, [tag.toLowerCase()]) ?? ambientEntries[0];
    if (entry) {
      return assetStore.resolveUrl(entry.tag);
    }
  }

  // C-513 AC-10: an imported/generated ambience on this device.
  return resolveLocalAudio({
    category: 'ambient',
    requiredTags: [tag.toLowerCase()],
    fallbackToFirst: true,
  });
};

/**
 * Plays a resolved BGM URL through the shared AudioService.
 *
 * `requestId` is the caller's claim on the newest-request slot. The check runs
 * *after* the dynamic import resolves, so a request that was superseded while
 * the import was in flight never starts a track.
 */
const _playBgm = async (
  url: string,
  durationMs: number | undefined,
  playbackId: number,
): Promise<void> => {
  if (playbackId !== _playbackId) {
    return;
  }
  if (isBgmSuppressedByPlayer()) {
    _pendingPlaybackId = playbackId;
    return;
  }
  const { audioService } = await import('$services');
  if (playbackId !== _playbackId) {
    return;
  }
  // Stop may have been pressed while the service import was in flight.
  if (isBgmSuppressedByPlayer()) {
    _pendingPlaybackId = playbackId;
    return;
  }
  _pendingPlaybackId = undefined;
  await audioService.transitionToBgm(url, durationMs);
};

/**
 * Fades BGM out for a declared-silence decision.
 *
 * `playbackId` is the caller's admitted-playback token; the check runs after
 * the dynamic import so a transition superseded while the import was in flight
 * never stops the newer track.
 */
const _stopBgm = async (durationMs: number | undefined, playbackId: number): Promise<void> => {
  const { audioService } = await import('$services');
  if (playbackId !== _playbackId) {
    return;
  }
  await audioService.fadeOutBgm(durationMs);
};

/**
 * Submits an already-resolved request to the arbitration authority.
 *
 * Kept separate from {@link requestAudioCue} so a caller that had to *resolve*
 * a URL first can hold its ordering token across the resolution — otherwise a
 * slow lookup for map A can be admitted after a fast lookup for map B and move
 * the authority back to A.
 */
const _submitCue = async (options: {
  source: 'map' | 'combat' | 'scripted';
  context: string;
  url: string | null;
  authored: boolean;
  durationMs?: number;
  intent?: 'play' | 'stop';
}) => {
  const decision = arbitrateAudioCue({
    state: _arbiterState,
    input: {
      kind: 'request',
      request: {
        source: options.source,
        context: options.context,
        url: options.url,
        authored: options.authored,
        ...(options.intent === undefined ? {} : { intent: options.intent }),
      },
    },
  });
  _arbiterState = decision.state;

  // Nothing admitted (rejected, no-change) must not claim a playback token —
  // that is what keeps a rejected DJ dispatch from cancelling a valid pending
  // map transition.
  if (!decision.play && !decision.stop) {
    // A deduplicated cue may still be silent: suppression is not playback.
    if (decision.reason === 'no-change' && _pendingPlaybackId === _playbackId && options.url) {
      await _playBgm(options.url, options.durationMs, _playbackId);
    }
    return decision;
  }
  _pendingPlaybackId = undefined;
  const playbackId = ++_playbackId;

  if (decision.stop) {
    await _stopBgm(options.durationMs, playbackId);
    return decision;
  }

  const url = decision.play?.url;
  if (!url) {
    return decision;
  }
  await _playBgm(url, options.durationMs, playbackId);
  return decision;
};

/**
 * Submits a music request to the single arbitration authority.
 *
 * Every music caller — the map/combat scene path here and the Music DJ agent —
 * goes through this. The authority applies the deterministic priority
 * (scripted > combat > map) and refuses to let an unauthored pick displace an
 * authored cue, so the DJ and the map cannot start competing tracks.
 *
 * @param options.source - Priority band the request belongs to.
 * @param options.context - Map id, `combat`, `dj`, or a scripted predicate id.
 * @param options.url - The resolved URL, or null for a declared cue miss.
 * @param options.authored - True only when an authored binding produced the URL.
 * @param options.durationMs - Crossfade duration.
 * @returns The arbitration decision (including why a request was refused).
 */
export const requestAudioCue = async (options: {
  source: 'map' | 'combat' | 'scripted';
  context: string;
  url: string | null;
  authored: boolean;
  durationMs?: number;
  intent?: 'play' | 'stop';
}) => _submitCue(options);

/**
 * Releases a priority band, restoring a suspended map cue when there is one.
 *
 * Combat ending is the motivating case, so this stays module-private and
 * `playSceneBgm` drives it.
 */
const releaseAudioCueSource = async (source: 'map' | 'combat' | 'scripted') => {
  const decision = arbitrateAudioCue({
    state: _arbiterState,
    input: { kind: 'release', source },
  });
  _arbiterState = decision.state;

  const url = decision.play?.url;
  if (url) {
    _pendingPlaybackId = undefined;
    await _playBgm(url, undefined, ++_playbackId);
  }
  return decision;
};

/**
 * Plays a resolved BGM URL, skipping when no asset exists.
 * Convenience wrapper so call sites stay one-liners.
 *
 * Authored cues win: when the current pack binds a cue for the current map
 * (or `combat`), that binding decides the track — including resolving to
 * silence on a miss rather than unrelated content. A context the pack does not
 * author falls through to today's tag-first resolution unchanged.
 *
 * @param scene - Scene type ('explore' | 'combat').
 * @param durationMs - Crossfade duration in milliseconds (default 1500).
 */
export const playSceneBgm = async (
  scene: 'explore' | 'combat',
  durationMs?: number,
): Promise<void> => {
  // 🔴 A player who pressed Stop is not overruled by a map change. Returning
  // here — before any pack, catalog or lock work — also keeps a suppressed
  // player from paying for a cue resolve and a network fetch on every map
  // entry. `_playBgm` still re-checks, because that is the funnel every BGM
  // start actually shares and this is only the cheap way in.
  if (isBgmSuppressedByPlayer()) {
    return;
  }
  // Claim the newest-request slot *before* any await. Resolution is async (pack
  // load, catalog, lock fetch), so two map loads in flight can finish out of
  // order; without this token the slower lookup would be admitted last and the
  // authority would report the previous map.
  const requestId = ++_bgmRequestId;

  // Leaving combat releases the combat band so the map cue it suspended comes
  // back through the same authority instead of a second, competing lookup.
  if (scene === 'explore' && _arbiterState.active?.source === 'combat') {
    const decision = await releaseAudioCueSource('combat');
    // A restored cue is the authoritative state; otherwise nothing was
    // suspended and exploration music still has to resolve below.
    if (decision.play) {
      return;
    }
  }

  const context = scene === 'combat' ? 'combat' : _activeCueContext.mapId;
  const authored = await resolveAuthoredCue({
    packId: _activeCueContext.packId,
    target: 'music',
    context,
  });
  if (requestId !== _bgmRequestId) {
    return;
  }

  // A pack that authors this context is authoritative — a declared silence
  // must stay silent, never fall through to a generic track.
  const url = authored.authored ? authored.url : await resolveBgmUrl(scene);
  if (requestId !== _bgmRequestId) {
    return;
  }

  await _submitCue({
    source: scene === 'combat' ? 'combat' : 'map',
    context: context || scene,
    url,
    authored: authored.authored,
    durationMs,
  });
};

/**
 * Plays a resolved SFX URL, skipping when no asset exists.
 */
export const playSfxByName = async (name: string): Promise<void> => {
  // C-523: an authored SFX binding for this effect name is authoritative and
  // plays on the SFX bus; an unbound pack keeps tag-first behavior. Skipped
  // entirely outside a pack context (dev/sandbox), where no binding can apply.
  let url: string | null;
  if (_activeCueContext.packId) {
    const authored = await resolveAuthoredCue({
      packId: _activeCueContext.packId,
      target: 'sfx',
      context: name,
    });
    url = authored.authored ? authored.url : await resolveSfxUrl(name);
  } else {
    url = await resolveSfxUrl(name);
  }
  if (!url) {
    return;
  }
  const { audioService } = await import('$services');
  await audioService.playSfx(url);
};
