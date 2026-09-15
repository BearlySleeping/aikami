// apps/frontend/client/src/lib/services/audio/authored_audio_cue_source.ts
//
// C-523 AC-3 — resolves an authored cue's declared registry tag to a playable
// URL, offline.
//
// The authored binding names an exact registry tag plus the SHA-256 of the
// accepted rendition. This module collects the tags actually installed on the
// device (curated catalog + on-device registry), runs the pure selection in
// `audio_cue_binding_reader.ts`, and turns the winning tag into a URL through
// the existing `assetStore` / `localAudioSource` seams — the same ones the
// generic resolver uses, so a freshly accepted generated row enters here after
// save and reload with no extra wiring.
//
// Nothing in this path reaches the network: `loadContentPack` resolves through
// the registry, and both URL sources are on-device. A pack that authors no
// audio returns `authored: false` and the caller keeps today's tag-first
// behavior.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { publicEnv } from '@aikami/frontend/configs';
import type { AudioCueTarget, PackAudioCueBinding } from '@aikami/types';
import { logger } from '$logger';
import { assetStore } from '../assets/asset_store.svelte.ts';
import { verifyPackLockAudio } from '../assets/installed_pack_lock.ts';
import { parsePackAudioBindings, selectAudioCue } from './audio_cue_binding_reader.ts';
import { localAudioSource } from './audio_local_source.ts';

/** The registry category a cue target reads from. */
const CATEGORY_BY_TARGET: Record<AudioCueTarget, 'music' | 'ambient' | 'sfx'> = {
  music: 'music',
  ambient: 'ambient',
  sfx: 'sfx',
};

/** The outcome of an authored-cue lookup. */
type AuthoredCueLookup = {
  /** The URL to play, or null when the cue resolves to declared silence. */
  url: string | null;
  /** The binding that produced the URL, when there is one. */
  binding: PackAudioCueBinding | undefined;
  /** How the lookup resolved. */
  kind: 'bound' | 'fallback-cue' | 'silence' | 'unbound';
  /**
   * True when the pack authors a binding for this (target, context).
   *
   * `false` means the caller must keep the existing tag-first behavior.
   */
  authored: boolean;
};

/** The neutral "the pack authors nothing here" result. */
const UNBOUND: AuthoredCueLookup = {
  url: null,
  binding: undefined,
  kind: 'unbound',
  authored: false,
};

/**
 * Collects every registry tag of a category installed on this device.
 *
 * Two sources, both offline: the boot-seed curated catalog the asset store
 * rebuilds from its local seed, and the on-device registry that carries
 * community imports and freshly accepted generated rows.
 *
 * The catalog is awaited first. A cold boot (or an offline reload) can reach a
 * cue request before the seed has landed, and an empty tag set would make a
 * `required` cue look uninstalled — resolving to silence on a device that
 * actually has the rendition. `fetchManifest` is idempotent and memoized, so
 * the common case is a no-op.
 */
const collectInstalledTags = async (target: AudioCueTarget): Promise<string[]> => {
  const category = CATEGORY_BY_TARGET[target];
  const tags: string[] = [];

  if (!assetStore.manifest) {
    try {
      await assetStore.fetchManifest();
    } catch {
      // No catalog is not an error here — the local registry below may still
      // answer, and a genuine miss falls through to the declared fallback.
    }
  }

  const entries = assetStore.manifest?.byCategory[category] ?? [];
  for (const entry of entries) {
    if (entry.tag) {
      tags.push(entry.tag);
    }
  }

  try {
    for (const tag of await localAudioSource.listTags(category)) {
      tags.push(tag);
    }
  } catch {
    // The registry is best-effort: a device with no local assets is not an
    // error, and the curated catalog above already answered.
  }

  return tags;
};

/** Resolves an exact registry tag to a URL through the existing seams. */
const resolveTagToUrl = async (options: {
  tag: string;
  target: AudioCueTarget;
}): Promise<string | null> => {
  const { tag, target } = options;
  const normalized = tag.trim().toLowerCase();
  const category = CATEGORY_BY_TARGET[target];

  const entry = (assetStore.manifest?.byCategory[category] ?? []).find(
    (candidate) => candidate.tag?.trim().toLowerCase() === normalized,
  );
  if (entry) {
    return assetStore.resolveUrl(entry.tag);
  }

  try {
    return await localAudioSource.resolve(tag);
  } catch {
    return null;
  }
};

/**
 * Resolves the authored cue for a (target, context) pair.
 *
 * @param options.packId - The content pack whose `audio` section to read.
 * @param options.target - Which bus the caller wants.
 * @param options.context - Map id, `combat`, or a scripted predicate id.
 * @returns The URL to play (or null for declared silence), with its binding.
 */
export const resolveAuthoredCue = async (options: {
  packId: string;
  target: AudioCueTarget;
  context: string;
}): Promise<AuthoredCueLookup> => {
  const { packId, target, context } = options;

  if (!packId || !context) {
    return UNBOUND;
  }

  let bindings: ReturnType<typeof parsePackAudioBindings>;
  try {
    const { loadContentPack } = await import('@aikami/frontend/engine');
    const { assetTagResolver } = await import('../assets/registry_resolver.ts');
    const pack = await loadContentPack({ packId, resolveTag: assetTagResolver });
    bindings = parsePackAudioBindings(pack.manifest.audio);
  } catch (error) {
    // The pack could not be read at all. Fall back to the generic tag-first
    // path rather than guessing at an authored intent — the section is
    // optional, and a malformed one is already reported by pack validation.
    logger.warn('resolveAuthoredCue:pack-unreadable', {
      packId,
      target,
      context,
      reason: error instanceof Error ? error.message : String(error),
    });
    return UNBOUND;
  }

  if (!bindings) {
    return UNBOUND;
  }

  const selection = selectAudioCue({
    bindings,
    target,
    context,
    availableTags: await collectInstalledTags(target),
  });

  if (selection.kind === 'unbound' || !selection.binding) {
    logger.debug('resolveAuthoredCue:silence', {
      packId,
      target,
      context,
      required: selection.required,
    });
    return { url: null, binding: undefined, kind: selection.kind, authored: true };
  }

  const url = await resolveTagToUrl({ tag: selection.binding.tag, target });
  if (!url) {
    logger.warn('resolveAuthoredCue:unresolvable-tag', {
      packId,
      target,
      context,
      cueId: selection.binding.cueId,
      required: selection.required,
    });
    return { url: null, binding: selection.binding, kind: 'silence', authored: true };
  }

  // C-523 AC-5: the installed pack lock's `audioAssets` pins are the release's
  // statement about the bytes this cue should be. A `required` cue whose
  // installed bytes do not match its pin is refused rather than played — an
  // unverifiable accepted rendition is worse than declared silence. A lock
  // written before C-523 (or absent entirely) verifies nothing and changes
  // nothing, which is the documented rollback.
  const verification = await verifyPackLockAudio({
    originUrl: publicEnv.PUBLIC_ASSETS_BASE_URL,
    bindings,
    installedRows: assetStore.seed?.rows ?? [],
  });
  if (!verification.ok) {
    logger.error('resolveAuthoredCue:lock-verification-refused', {
      packId,
      target,
      context,
      cueId: selection.binding.cueId,
      failedCueIds: verification.failedCueIds,
    });
    return { url: null, binding: selection.binding, kind: 'silence', authored: true };
  }

  logger.debug('resolveAuthoredCue:resolved', {
    packId,
    target,
    context,
    cueId: selection.binding.cueId,
    kind: selection.kind,
    sha256: selection.binding.sha256,
    lockPresent: verification.lockPresent,
  });

  return { url, binding: selection.binding, kind: selection.kind, authored: true };
};
