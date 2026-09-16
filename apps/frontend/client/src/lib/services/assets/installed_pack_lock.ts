// apps/frontend/client/src/lib/services/assets/installed_pack_lock.ts
//
// C-523 AC-5 — hash-verifying *audio* against the installed pack lock.
//
// `InstalledPackLockSchema` pinned image and definition content hashes only,
// and its `PackLockedAssetSchema` is `additionalProperties: false`, so audio
// could not be hash-pinned without a new optional array. `audioAssets` is that
// array; `verifyInstalledAudioAgainstLock` is the comparison.
//
// This module is the production read side of that pair:
//
//   1. fetch the lock the origin published for this install, and
//   2. compare its audio pins with the content hashes the device actually
//      holds — the boot seed records the SHA-256 of every installed asset, so
//      "what this device installed" needs no extra bookkeeping.
//
// A lock *without* `audioAssets` is a legitimate legacy lock and verifies
// nothing. A lock *with* `audioAssets` is a new audio-enabled install, and
// every required cue must have a matching pin and matching bytes — a missing
// pin, missing bytes or a hash mismatch all fail. A network error, a malformed
// lock or a partial lock is never misread as "legacy".
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import {
  InstalledPackLockSchema,
  PACK_LOCK_KEY,
  verifyInstalledAudioAgainstLock,
} from '@aikami/schemas';
import type { PackAudioBindings } from '@aikami/types';
import { Value } from 'typebox/value';
import { logger } from '$logger';

/** Timeout for the lock fetch — a stalled origin must not hang playback. */
const LOCK_FETCH_TIMEOUT_MS = 10_000;

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
  /** Whether an installed pack lock was present at all. */
  lockPresent: boolean;
};

/** Nothing to verify — no authored audio, or no lock on this install. */
const NOTHING_TO_VERIFY: PackLockAudioVerification = {
  ok: true,
  failedCueIds: [],
  lockPresent: false,
};

/**
 * Memoized lock fetch keyed by origin.
 *
 * A failed read (timeout, network error, HTTP error, malformed body) is evicted
 * so a later request can retry after the transient failure clears; only a
 * successfully validated lock is retained.
 */
const _lockCache = new Map<string, Promise<unknown>>();

/**
 * Fetches and validates the installed pack lock from the catalog origin.
 *
 * @param options.originUrl - `PUBLIC_ASSETS_BASE_URL`, if configured.
 * @returns The validated lock, or `undefined` when absent/unreadable.
 */
const loadInstalledPackLock = async (options: {
  originUrl: string | undefined;
}): Promise<unknown> => {
  const { originUrl } = options;
  if (!originUrl) {
    return undefined;
  }

  const base = originUrl.replace(/\/$/, '');
  const cached = _lockCache.get(base);
  if (cached) {
    return cached;
  }

  const pending = (async (): Promise<unknown> => {
    try {
      const response = await fetch(`${base}/${PACK_LOCK_KEY}`, {
        signal: AbortSignal.timeout(LOCK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return undefined;
      }
      const raw: unknown = await response.json();
      if (!Value.Check(InstalledPackLockSchema, raw)) {
        logger.warn('installedPackLock:invalid', { originUrl: base });
        return undefined;
      }
      return raw;
    } catch {
      // No lock (or no network) is not an error: the pins are additive.
      return undefined;
    }
  })();

  _lockCache.set(base, pending);
  const resolved = await pending;
  if (resolved === undefined) {
    // Evict a transient failure so a later request can retry.
    _lockCache.delete(base);
  }
  return resolved;
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
 * Verifies the device's installed audio bytes against the installed pack lock.
 *
 * @param options.originUrl - `PUBLIC_ASSETS_BASE_URL`, if configured.
 * @param options.bindings - The pack's authored audio section, if any.
 * @param options.installedRows - The installed boot-seed rows.
 * @returns Whether audio may play, plus the cues that failed.
 */
export const verifyPackLockAudio = async (options: {
  originUrl: string | undefined;
  bindings: PackAudioBindings | undefined;
  installedRows: readonly { tag: string; hash: string }[];
}): Promise<PackLockAudioVerification> => {
  const { originUrl, bindings, installedRows } = options;

  if (!bindings || bindings.bindings.length === 0) {
    return NOTHING_TO_VERIFY;
  }

  const lock = await loadInstalledPackLock({ originUrl });
  if (!lock) {
    return NOTHING_TO_VERIFY;
  }

  const parsed = lock as {
    audioAssets?: readonly { id: string; renditionHash: string }[];
  };

  // A lock written before C-523 has no `audioAssets`: it is genuinely legacy
  // and verifies nothing. A *new* audio-enabled install must carry the pins.
  if (parsed.audioAssets === undefined) {
    return { ok: true, failedCueIds: [], lockPresent: true };
  }

  const result = verifyInstalledAudioAgainstLock({
    bindings,
    audioAssets: parsed.audioAssets,
    installedHashes: installedAudioHashes({ rows: installedRows, bindings }),
  });

  // Report every contradiction so a caller can scope a refusal to the failing
  // cue; orphan pins are extra pins the lock carries, not playback failures.
  const failedCueIds = [
    ...new Set(result.issues.filter((issue) => issue.kind !== 'orphan-pin').map((i) => i.cueId)),
  ];

  if (!result.ok) {
    logger.error('installedPackLock:audio-verification-failed', {
      failedCueIds,
      issues: result.issues,
    });
  }

  return { ok: result.ok, failedCueIds, lockPresent: true };
};
