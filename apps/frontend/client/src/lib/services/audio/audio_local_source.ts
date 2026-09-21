// apps/frontend/client/src/lib/services/audio/audio_local_source.ts
//
// C-513 AC-10 — the on-device half of audio resolution.
//
// The manifest the audio resolver searches is the boot-seed catalog: a build
// artifact published to R2 from the operator's pipeline. It can never contain
// an asset the player imported from the community or generated locally. Those
// live only in the on-device registry, so the resolver needs a second source
// for them — and that source must be able to answer after a reload with
// networking blocked.
//
// Extracted into its own module (rather than inlined into
// `audio_asset_resolver.ts`) so the resolver's tests can substitute it and
// assert the fallback without standing up the real registry and cache.
//
// Contract: C-513 AC-10

import { assetManager } from '../assets/asset_manager.svelte.ts';

/** Audio categories the local registry can own. */
type LocalAudioCategory = 'music' | 'sfx' | 'ambient';

/** Tags and URLs for audio assets this device owns. */
type LocalAudioSource = {
  /** Tags the registry owns in one audio category, ordered by tag. */
  listTags(category: LocalAudioCategory): Promise<readonly string[]>;
  /**
   * Owned tags with their registry content hashes (C-523 AC-3), so the authored
   * cue reader can verify a resolved tag against the `sha256` the pack declares
   * instead of trusting tag existence alone.
   */
  listEntries(category: LocalAudioCategory): Promise<readonly { tag: string; sha256: string }[]>;
  /**
   * Resolves one owned tag to a playable URL.
   *
   * Serving happens from the content-hash cache when the bytes are on device —
   * the reload-after-import path performs no network I/O.
   */
  resolve(tag: string): Promise<string | null>;
};

/**
 * The production source: the local asset registry plus the shared cache.
 *
 * Deliberately the same `AssetManager.resolve` the rest of the client uses, so
 * an imported asset resolves through exactly one code path whether it is being
 * played, painted or previewed.
 */
export const localAudioSource: LocalAudioSource = {
  listTags: (category) => assetManager.listLocalTags(category),
  listEntries: (category) => assetManager.listLocalEntries(category),
  resolve: (tag) => assetManager.resolve(tag),
};
