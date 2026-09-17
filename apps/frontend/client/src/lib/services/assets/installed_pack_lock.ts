// apps/frontend/client/src/lib/services/assets/installed_pack_lock.ts
//
// C-523 AC-5 — hash-verifying *audio* against the installed pack lock.
//
// `InstalledPackLockSchema` pinned image and definition content hashes only,
// and its `PackLockedAssetSchema` is `additionalProperties: false`, so audio
// could not be hash-pinned without a new optional array. `audioAssets` is that
// array; `verifyInstalledAudioAgainstLock` is the comparison.
//
// This module is the production decision side of that pair: it compares the
// lock's audio pins with the content hashes the device actually holds — the
// boot seed records the SHA-256 of every installed asset, so "what this device
// installed" needs no extra bookkeeping.
//
// 🔴 The lock is NOT fetched here. It arrives as an already-verified argument
// belonging to the SAME selected release (C-523 AC-5): `assetStore.packLock`,
// resolved from the release graph the catalog booted from. An independent fetch
// of the mutable `index/v1/pack_lock.json` alias could pair release N+1's
// catalog with release N's lock, or observe the publication window in which
// the pointer has advanced but the alias has not. The only producer of a
// `legacy-alias` lock is the resolver's explicit pointer-less compatibility
// path, and it is reported as such.
//
// A lock *without* `audioAssets` is a legitimate legacy lock and verifies
// nothing. A lock *with* `audioAssets` is a new audio-enabled install, and
// every required cue must have a matching pin and matching bytes — a missing
// pin, missing bytes or a hash mismatch all fail. A malformed or missing lock
// from a release that pins one never reaches here: release resolution fails
// closed first, so it can never be misread as "legacy".
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { type InstalledPackLock, verifyInstalledAudioAgainstLock } from '@aikami/schemas';
import type { PackAudioBindings } from '@aikami/types';
import { logger } from '$logger';

/** Where the verified lock came from, so a caller can report the provenance. */
type PackLockProvenance = 'release' | 'legacy-alias' | 'absent';

/** The outcome of verifying this device's audio against the installed lock. */
type PackLockAudioVerification = {
  /**
   * False only when a lock that carries `audioAssets` pins bytes this device
   * contradicts — a required cue whose pin is missing, whose bytes are absent,
   * or whose installed bytes hash differently.
   *
   * A lock that simply does not carry `audioAssets` is legacy and passes:
   * refusing playback for an unpinned cue would be a regression, not a check.
   */
  ok: boolean;
  /**
   * Every cue id with a verification contradiction (orphan pins excluded), so
   * a caller can scope a refusal to the cue that actually failed rather than
   * silencing an unrelated, valid cue.
   */
  failedCueIds: string[];
  /** Whether a verified installed pack lock was available at all. */
  lockPresent: boolean;
};

/** Nothing to verify — no authored audio, or no lock on this install. */
const NOTHING_TO_VERIFY: PackLockAudioVerification = {
  ok: true,
  failedCueIds: [],
  lockPresent: false,
};

/**
 * The content hashes this device holds for the authored cues' declared tags.
 *
 * @param options.rows - The installed boot-seed rows (`tag` + `hash`).
 * @param options.bindings - The pack's authored audio section, if any.
 * @returns Installed SHA-256 by cue id, for cues whose tag is installed.
 */
const installedAudioHashes = (options: {
  rows: readonly { tag: string; hash: string }[];
  bindings: PackAudioBindings | undefined;
}): Record<string, string> => {
  const { rows, bindings } = options;
  const hashes: Record<string, string> = {};
  if (!bindings) {
    return hashes;
  }

  for (const binding of bindings.bindings) {
    const declared = binding.tag.trim().toLowerCase();
    const row = rows.find((candidate) => candidate.tag.trim().toLowerCase() === declared);
    if (row) {
      hashes[binding.cueId] = row.hash;
    }
  }
  return hashes;
};

/**
 * Verifies the device's installed audio bytes against the release's verified
 * installed pack lock.
 *
 * @param options.lock - The lock belonging to the selected release, or
 *   `undefined` when nothing pinned one.
 * @param options.provenance - Where that lock came from (diagnostics only).
 * @param options.bindings - The pack's authored audio section, if any.
 * @param options.installedRows - The installed boot-seed rows.
 * @returns Whether audio may play, plus the cues that failed.
 */
export const verifyPackLockAudio = (options: {
  lock: InstalledPackLock | undefined;
  provenance: PackLockProvenance;
  bindings: PackAudioBindings | undefined;
  installedRows: readonly { tag: string; hash: string }[];
}): PackLockAudioVerification => {
  const { lock, provenance, bindings, installedRows } = options;

  if (!bindings || bindings.bindings.length === 0) {
    return NOTHING_TO_VERIFY;
  }

  if (!lock) {
    return NOTHING_TO_VERIFY;
  }

  // A lock written before C-523 has no `audioAssets`: it is genuinely legacy
  // and verifies nothing. A *new* audio-enabled install must carry the pins.
  if (lock.audioAssets === undefined) {
    return { ok: true, failedCueIds: [], lockPresent: true };
  }

  const result = verifyInstalledAudioAgainstLock({
    bindings,
    audioAssets: lock.audioAssets,
    installedHashes: installedAudioHashes({ rows: installedRows, bindings }),
  });

  // Report every contradiction so a caller can scope a refusal to the failing
  // cue; orphan pins are extra pins the lock carries, not playback failures.
  const failedCueIds = [
    ...new Set(result.issues.filter((issue) => issue.kind !== 'orphan-pin').map((i) => i.cueId)),
  ];

  if (!result.ok) {
    logger.error('installedPackLock:audio-verification-failed', {
      provenance,
      failedCueIds,
      issues: result.issues,
    });
  }

  return { ok: result.ok, failedCueIds, lockPresent: true };
};
