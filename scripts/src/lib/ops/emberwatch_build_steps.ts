// scripts/src/lib/ops/emberwatch_build_steps.ts
//
// The canonical, ordered Emberwatch content-build steps (C-548).
//
// One source of truth for "what turns the authored pack into the local
// candidate plane": install portraits and audio, generate the terrain atlas,
// prop-atlas pages and canonical maps, rescan the manifest, then derive the
// boot seed. `emberwatch_release.ts` runs them to build and seal a release
// candidate; `emberwatch_studio.ts` runs them to make a fresh worktree
// playable. Duplicating the list in the studio is exactly how a studio run
// drifts from the release build.
//
// The order matters: the atlas must exist before the maps can be validated
// against it, and the scan/seed steps derive from everything above them.

export type BuildStep = {
  /** Human-readable label for logs. */
  label: string;
  /** Script path relative to the repository root. */
  script: string;
  /** Extra argv passed to the script. */
  args?: readonly string[];
};

/**
 * The deterministic content build, in order.
 *
 * `--write` on the seed step is deliberate: `asset_seed.json` is a DERIVED
 * artifact of the scan above it, exactly like the atlas and the maps, and it
 * must exist before a seal. The candidate lock has a `seed` group, and
 * `runSeedPublish` refuses to publish a release whose seed is absent from both
 * the candidate and the previous release. Leaving it out of this list is what
 * made `asset_seed.json` a file that only existed in whoever's working tree had
 * run the generator by hand.
 *
 * There is deliberately no `--merge-origin`: the step is mode-independent and
 * must be reproducible from the source tree alone. Carrying the published
 * catalog's rows in happens at PUBLISH time, against the target's verified
 * release.
 *
 * These steps must NOT run during `--apply`: a release promotes a candidate that
 * was sealed once, and rebuilding during publication is exactly how staging and
 * production end up publishing different bytes while both report success.
 */
export const EMBERWATCH_BUILD_STEPS: readonly BuildStep[] = [
  {
    label: 'install portraits',
    script: 'scripts/src/lib/ops/install_emberwatch_portraits.ts',
  },
  {
    label: 'install authored audio beds',
    script: 'scripts/src/lib/ops/install_emberwatch_audio.ts',
  },
  {
    label: 'generate terrain/grid atlas',
    script: 'scripts/src/lib/ops/generate_emberwatch_atlas.ts',
  },
  {
    label: 'generate prop atlas pages',
    script: 'scripts/src/lib/ops/generate_emberwatch_props_atlas.ts',
  },
  {
    label: 'regenerate canonical maps',
    script: 'scripts/src/lib/ops/generate_emberwatch_maps.ts',
  },
  {
    label: 'scan manifest + hashes + credits',
    script: 'scripts/src/lib/ops/scan_assets.ts',
  },
  {
    label: 'generate asset seed',
    script: 'scripts/src/lib/ops/generate_asset_seed.ts',
    args: ['--write'],
  },
];
