// apps/frontend/client/src/lib/services/audio/authored_audio_cue_source.ts
//
// C-523 AC-3 — resolves an authored cue's declared registry tag to a playable
// URL, offline.
//
// The authored binding names an exact registry tag plus the SHA-256 of the
// accepted rendition. This module collects the renditions actually installed on
// the device (curated catalog + on-device registry, with their content hashes),
// runs the pure selection in `audio_cue_binding_reader.ts`, and turns the
// winning tag into a URL through the existing `assetStore` / `localAudioSource`
// seams — the same ones the generic resolver uses, so a freshly accepted
// generated row enters here after save and reload with no extra wiring.
//
// Nothing in this path reaches the network: `loadContentPack` resolves through
// the registry, and both URL sources are on-device. The audio lock it verifies
// against is the one the ACTIVE catalog's release pinned — the asset store
// retains it from release resolution, so this path never re-fetches the mutable
// `index/v1/pack_lock.json` alias. A pack that authors no audio returns
// `authored: false` and the caller keeps today's tag-first behavior; a pack
// whose authored section is *broken* is reported rather than silently treated
// as unauthored.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import type { AudioCueTarget, PackAudioCueBinding } from '@aikami/types';
import { logger } from '$logger';
import { assetStore } from '../assets/asset_store.svelte.ts';
import { verifyPackLockAudio } from '../assets/installed_pack_lock.ts';
import {
  inspectPackAudioBindings,
  parsePackAudioBindings,
  selectAudioCue,
} from './audio_cue_binding_reader.ts';
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
 * Collects every audio rendition of a category installed on this device,
 * including its content hash.
 *
 * Two sources, both offline: the boot-seed curated catalog the asset store
 * rebuilds from its local seed, and the on-device registry that carries
 * community imports and freshly accepted generated rows.
 *
 * The catalog is awaited first. A cold boot (or an offline reload) can reach a
 * cue request before the seed has landed, and an empty set would make a
 * `required` cue look uninstalled — resolving to silence on a device that
 * actually has the rendition. `fetchManifest` is idempotent and memoized, so
 * the common case is a no-op.
 */
const collectInstalledRenditions = async (
  target: AudioCueTarget,
): Promise<{ tag: string; sha256?: string }[]> => {
  const category = CATEGORY_BY_TARGET[target];
  const byTag = new Map<string, { tag: string; sha256?: string }>();

  if (!assetStore.manifest) {
    try {
      await assetStore.fetchManifest();
    } catch {
      // No catalog is not an error here — the local registry below may still
      // answer, and a genuine miss falls through to the declared fallback.
    }
  }

  // The seed's row hash IS the content hash of the installed bytes.
  for (const row of assetStore.seed?.rows ?? []) {
    if (row.category === category) {
      byTag.set(row.tag.trim().toLowerCase(), { tag: row.tag, sha256: row.hash });
    }
  }

  try {
    for (const entry of await localAudioSource.listEntries(category)) {
      byTag.set(entry.tag.trim().toLowerCase(), { tag: entry.tag, sha256: entry.sha256 });
    }
  } catch {
    // The registry is best-effort: a device with no local assets is not an
    // error, and the curated catalog above already answered.
  }

  return [...byTag.values()];
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
 * Walks the declared `declared_cue` fallback chain from `start`, bounded by the
 * number of bindings so a malformed chain can never loop.
 */
const fallbackChain = (options: {
  start: PackAudioCueBinding;
  bindings: readonly PackAudioCueBinding[];
}): PackAudioCueBinding[] => {
  const { start, bindings } = options;
  const chain: PackAudioCueBinding[] = [];
  const seen = new Set<string>();
  let cursor: PackAudioCueBinding | undefined = start;
  while (cursor && !seen.has(cursor.cueId) && chain.length <= bindings.length) {
    chain.push(cursor);
    seen.add(cursor.cueId);
    cursor =
      cursor.fallback === 'declared_cue' && cursor.fallbackCueId
        ? bindings.find((candidate) => candidate.cueId === cursor?.fallbackCueId)
        : undefined;
  }
  return chain;
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

  let rawAudio: unknown;
  try {
    const { loadContentPack } = await import('@aikami/frontend/engine');
    const { assetTagResolver } = await import('../assets/registry_resolver.ts');
    const pack = await loadContentPack({ packId, resolveTag: assetTagResolver });
    rawAudio = pack.manifest.audio;
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

  // Absent is genuinely unauthored: keep today's tag-first behavior.
  if (rawAudio === undefined || rawAudio === null) {
    return UNBOUND;
  }

  // Present but unparseable is a broken authored section, reported rather than
  // silently treated as an ordinary absent one (the caller keeps generic
  // behavior, but the defect is visible in diagnostics).
  const bindings = parsePackAudioBindings(rawAudio);
  if (!bindings) {
    const inspection = inspectPackAudioBindings(rawAudio);
    logger.error('resolveAuthoredCue:invalid-audio-section', {
      packId,
      target,
      context,
      structural: inspection.status === 'invalid' ? inspection.structural : false,
      issues: inspection.status === 'invalid' ? inspection.issues : [],
    });
    return UNBOUND;
  }
  const installedRenditions = await collectInstalledRenditions(target);
  const selection = selectAudioCue({ bindings, target, context, installedRenditions });

  if (selection.kind === 'unbound') {
    // The pack authors *some* contexts but not this one — a genuinely unbound
    // context, so the caller must keep generic tag-first behavior.
    return UNBOUND;
  }

  if (selection.kind === 'silence' || !selection.binding) {
    logger.debug('resolveAuthoredCue:silence', {
      packId,
      target,
      context,
      required: selection.required,
      miss: selection.miss,
    });
    return { url: null, binding: undefined, kind: 'silence', authored: true };
  }

  // The installed pack lock's `audioAssets` pins are the release's statement
  // about the bytes this cue should be. Verification is scoped to the selected
  // cue: an unrelated cue's problem must not suppress a valid one. The installed
  // set includes freshly accepted device-registry rows, not only boot-seed rows.
  //
  // The lock comes from the active catalog's own release (retained by
  // `assetStore` during release resolution), never from a separate fetch of the
  // mutable alias — a new-release catalog must not be paired with a lock from
  // another release.
  const verification = verifyPackLockAudio({
    lock: assetStore.packLock ?? undefined,
    provenance: assetStore.packLockSource ?? 'absent',
    bindings,
    installedRows: installedRenditions
      .filter(
        (rendition): rendition is { tag: string; sha256: string } => rendition.sha256 !== undefined,
      )
      .map((rendition) => ({ tag: rendition.tag, hash: rendition.sha256 })),
  });

  // Try the selected binding first, then its declared fallback chain when the
  // primary is missing, unreadable, unavailable locally, or refused by the
  // lock. Each candidate is verified independently against its own identity.
  const chain = fallbackChain({ start: selection.binding, bindings: bindings.bindings });
  for (const [index, candidate] of chain.entries()) {
    if (verification.failedCueIds.includes(candidate.cueId)) {
      logger.warn('resolveAuthoredCue:lock-verification-refused', {
        packId,
        target,
        context,
        cueId: candidate.cueId,
      });
      continue;
    }
    const url = await resolveTagToUrl({ tag: candidate.tag, target });
    if (!url) {
      logger.warn('resolveAuthoredCue:unresolvable-tag', {
        packId,
        target,
        context,
        cueId: candidate.cueId,
        required: selection.required,
      });
      continue;
    }
    const kind = index === 0 ? selection.kind : 'fallback-cue';
    logger.debug('resolveAuthoredCue:resolved', {
      packId,
      target,
      context,
      cueId: candidate.cueId,
      kind,
      sha256: candidate.sha256,
      lockPresent: verification.lockPresent,
    });
    return { url, binding: candidate, kind, authored: true };
  }

  return { url: null, binding: selection.binding, kind: 'silence', authored: true };
};
