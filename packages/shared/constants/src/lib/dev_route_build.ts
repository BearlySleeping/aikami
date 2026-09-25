// packages/shared/constants/src/lib/dev_route_build.ts
//
// Build-output marker recording whether a client build's route graph contains
// the `(dev)` sandbox group.
//
// Why a file instead of re-reading the environment: the build process loads
// `.env.<mode>`, but the deploy orchestrator's own `check_deploy_assets` pass
// runs in a different process where that file is not loaded. Re-deriving the
// decision from `process.env` there made the deploy guard reject exactly the
// opt-in builds the build had already accepted. The marker travels with the
// artifact — including checksum-cache hits and CI artifact reuse — so the
// guard reads the build's own answer instead of guessing it.

/** File name written into the client build output directory. */
export const DEV_ROUTES_BUILD_MARKER_FILE = '.aikami-include-dev-routes';
