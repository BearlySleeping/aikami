// packages/shared/constants/src/lib/dev_route_build.ts
//
// Build-output record of how the client build resolved its `(dev)` sandbox
// route group.
//
// Why a file instead of re-reading the environment: the build process loads
// `.env.<mode>`, but the deploy orchestrator's own `check_deploy_assets` pass
// runs in a different process where that file is not loaded. Re-deriving the
// decision from `process.env` there made the deploy guard reject exactly the
// opt-in builds the build had already accepted.
//
// Why NOT a dotfile: `actions/upload-artifact` v4 excludes hidden files by
// default, so a `.marker` silently vanished on the path that matters most —
// the shared web bundle consumed by the desktop release legs.

/** File name written into the client build output directory. */
export const DEV_ROUTES_BUILD_MARKER_FILE = 'aikami-build-flags.json';
