// apps/frontend/client/src/lib/services/game/pack_version_compat.ts
//
// Pack-version compatibility for save hydration.
//
// Two related concerns live here because they share one decision:
//   1. C-381 AC-3 — a save pins the pack version it was created against. If
//      the installed pack has advanced and the saved map is gone, hydration
//      redirects to the pack's starting map.
// The planner intentionally does not claim retained-revision resolution:
// installed locks pin hashes but do not provide a loadable manifest/map URL.

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

  const warnings: PackVersionWarning[] = [
    {
      event: 'stage:hydrating_snapshot:pack-version-mismatch',
      details: {
        savedVersion,
        currentVersion,
        packId: input.packId,
        hint: 'The pack has been updated since this save was created. If the saved map no longer exists, the starting map will be used instead.',
      },
    },
  ];

  if (input.currentMapIds.includes(input.savedMapId)) {
    return { kind: 'mismatch', savedVersion, currentVersion, warnings };
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
  return { kind: 'mismatch', savedVersion, currentVersion, warnings, redirect };
};
