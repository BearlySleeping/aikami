// apps/frontend/client/src/lib/services/game/pack_version_compat.ts
//
// Pack-version compatibility and old-revision resolution for save hydration.
//
// Two related concerns live here because they share one decision:
//   1. C-381 AC-3 — a save pins the pack version it was created against. If
//      the installed pack has advanced and the saved map is gone, hydration
//      redirects to the pack's starting map.
//   2. C-496 installed pack lock — a retained lock pins the image/definition
//      content hashes of an older revision, so a save can resolve against the
//      exact bytes it was made from instead of silently using current bytes.
//
// The module is intentionally self-contained: `game_boot_service` consumes
// the planner and the process-wide revision store, and everything else stays
// private so the compatibility policy can be unit-tested without an engine.

import { type InstalledPackLock, InstalledPackLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';

/** A locked pack revision, keyed by the semver a save pins. */
type InstalledPackRevision = {
  version: string;
  lock: InstalledPackLock;
};

/** An asset identity/verification pair from an installed pack lock. */
type LockedAsset = {
  id: string;
  imageHash: string;
  definitionHash: string;
};

/** How a save's pinned pack version resolves against installed revisions. */
type SaveRevisionResolution =
  | { kind: 'current' }
  | { kind: 'installed-revision'; version: string; releaseId: string }
  | { kind: 'unresolved'; savedVersion: string; currentVersion: string };

/** A map fallback chosen when the saved map vanished in a newer pack. */
type PackVersionFallback = {
  mapId: string;
  x: number;
  y: number;
};

/** A warning the boot service should emit, with its structured details. */
type PackVersionWarning = {
  event: string;
  details: Record<string, unknown>;
};

type PackVersionHydrationPlan =
  | { kind: 'compatible'; warnings: [] }
  | {
      kind: 'mismatch';
      savedVersion: string;
      currentVersion: string;
      revisionResolution: SaveRevisionResolution;
      warnings: PackVersionWarning[];
      /** Present only when the saved map is gone and must be redirected. */
      redirect?: PackVersionFallback;
    };

type PackVersionCompatInput = {
  /** Version pinned by the save (v4+). Absent on v3 saves. */
  savedVersion?: string;
  /** Version of the currently installed pack. */
  currentVersion?: string;
  /** Pack id the save routes through (for diagnostics). */
  packId: string;
  /** Map the save was recorded on. */
  savedMapId: string;
  /** Map ids that exist in the installed pack. */
  currentMapIds: readonly string[];
  /** The installed pack's starting map id. */
  startingMapId: string;
  /** The installed pack's starting-map defaults, when available. */
  startingMap?: { defaultX?: number; defaultY?: number };
  /** Saved player coordinates, retained when no starting-map default exists. */
  savedX: number;
  savedY: number;
  /** Retained installed pack locks, for old-revision resolution. */
  installedRevisions: readonly InstalledPackRevision[];
  /**
   * The asset identities actually installed. When supplied, a retained lock
   * only resolves if every pinned hash matches these bytes.
   */
  installedAssets?: readonly LockedAsset[];
};

const findInstalledRevision = (
  revisions: readonly InstalledPackRevision[],
  version: string,
): InstalledPackRevision | undefined => revisions.find((revision) => revision.version === version);

/**
 * Verifies that an installed pack lock's pinned asset hashes match the bytes
 * the client actually has. A lock is only useful for old-revision resolution
 * if every pinned asset is present and identical.
 */
const verifyInstalledPackLock = (
  lock: InstalledPackLock,
  installed: readonly LockedAsset[],
): boolean => {
  const byId = new Map(installed.map((asset) => [asset.id, asset]));
  for (const pinned of lock.assets) {
    const actual = byId.get(pinned.id);
    if (!actual) {
      return false;
    }
    if (actual.imageHash !== pinned.imageHash || actual.definitionHash !== pinned.definitionHash) {
      return false;
    }
  }
  return true;
};

/**
 * Resolves a save's pinned pack version against the installed pack and any
 * retained older revisions.
 *
 * A missing/equal saved version resolves to `current` (v3 saves and saves on
 * the installed revision). A mismatch resolves to `installed-revision` when a
 * lock for that exact version is retained (and, when installed assets are
 * supplied, verifies), otherwise `unresolved` — the caller must surface a
 * resolution path instead of silently using current bytes under an old save.
 */
const resolveSaveRevision = (input: {
  savedVersion?: string;
  currentVersion?: string;
  installedRevisions: readonly InstalledPackRevision[];
  installedAssets?: readonly LockedAsset[];
}): SaveRevisionResolution => {
  const { savedVersion, currentVersion } = input;
  if (!savedVersion || savedVersion === currentVersion) {
    return { kind: 'current' };
  }
  const match = findInstalledRevision(input.installedRevisions, savedVersion);
  if (
    match &&
    (!input.installedAssets || verifyInstalledPackLock(match.lock, input.installedAssets))
  ) {
    return {
      kind: 'installed-revision',
      version: match.version,
      releaseId: match.lock.releaseId,
    };
  }
  return {
    kind: 'unresolved',
    savedVersion,
    currentVersion: currentVersion ?? 'unknown',
  };
};

/**
 * Plans how a save's pinned pack version relates to the installed pack.
 *
 * Missing versions (v3 saves, or a pack whose version could not be read) are
 * compatible: the installed pack is authoritative. On a real mismatch, a
 * still-present map is restored in place (the loader clamps the saved
 * position against the new grid); only a vanished map redirects.
 */
export const planPackVersionHydration = (
  input: PackVersionCompatInput,
): PackVersionHydrationPlan => {
  const { savedVersion, currentVersion } = input;
  if (!savedVersion || !currentVersion || savedVersion === currentVersion) {
    return { kind: 'compatible', warnings: [] };
  }

  const revisionResolution = resolveSaveRevision({
    savedVersion,
    currentVersion,
    installedRevisions: input.installedRevisions,
    installedAssets: input.installedAssets,
  });
  const warnings: PackVersionWarning[] = [
    {
      event: 'stage:hydrating_snapshot:pack-version-mismatch',
      details: {
        savedVersion,
        currentVersion,
        packId: input.packId,
        revisionResolution: revisionResolution.kind,
        hint: 'The pack has been updated since this save was created. If the saved map no longer exists, the starting map will be used instead.',
      },
    },
  ];

  if (input.currentMapIds.includes(input.savedMapId)) {
    return { kind: 'mismatch', savedVersion, currentVersion, revisionResolution, warnings };
  }

  const redirect: PackVersionFallback = {
    mapId: input.startingMapId,
    x: input.startingMap?.defaultX ?? input.savedX,
    y: input.startingMap?.defaultY ?? input.savedY,
  };
  warnings.push({
    event: 'stage:hydrating_snapshot:map-not-found-in-updated-pack',
    details: {
      mapId: input.savedMapId,
      packId: input.packId,
      fallbackMapId: redirect.mapId,
    },
  });
  return { kind: 'mismatch', savedVersion, currentVersion, revisionResolution, warnings, redirect };
};

/**
 * In-memory store of installed pack revisions.
 *
 * The store is intentionally process-local for now: the resolution contract
 * and validation are the deliverable, and a persistent backend can implement
 * the same surface later. Recording an invalid lock throws so corrupt
 * catalog data cannot masquerade as an installed revision.
 */
class InstalledPackRevisionStore {
  private _revisions = new Map<string, InstalledPackLock>();

  record(version: string, lock: unknown): void {
    if (!Value.Check(InstalledPackLockSchema, lock)) {
      throw new Error(`InstalledPackRevisionStore: invalid lock for revision "${version}"`);
    }
    this._revisions.set(version, lock as InstalledPackLock);
  }

  get(version: string): InstalledPackLock | undefined {
    return this._revisions.get(version);
  }

  list(): InstalledPackRevision[] {
    return [...this._revisions.entries()].map(([version, lock]) => ({ version, lock }));
  }

  clear(): void {
    this._revisions.clear();
  }
}

/** Process-wide revision store consumed by save hydration. */
export const installedPackRevisionStore = new InstalledPackRevisionStore();
