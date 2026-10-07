// apps/frontend/client/scripts/dev_routes_gate.ts
//
// C-418 Feature B: the single source of truth for whether the `(dev)` route
// group is part of the route graph.
//
// Callers that must agree on this decision:
//   - vite.config.ts                    → sets `files.routes`
//   - scripts/gate_dev_routes.ts        → materializes the filtered routes copy
//   - scripts/build_client.ts           → derives the build marker + guard flags
//   - scripts/src/lib/deploy/cloudflare.ts → the last deploy-time guard
//
// If the first two disagree the failure is silent and expensive:
// vite.config.ts builds from `src/routes` (dev routes included) while the gate
// believes it produced a filtered tree. The `(dev)` code is then bundled into a
// distributable build, and `check_deploy_assets.ts` cannot see it — an
// adapter-static SPA emits no per-route HTML directories, so the only symptom is
// an unexplained bundle-size regression. Keeping one resolver here makes that
// class of divergence impossible.
//
// Precedence:
//   1. AIKAMI_INCLUDE_DEV_ROUTES=true|false → explicit override, always wins
//   2. unset + command === 'serve'         → include (dev server)
//   3. unset + mode === 'staging'          → include (staging build)
//   4. anything else                       → exclude (production, and every
//                                             other build mode)
//
// Step 3 is a temporary product-development escape hatch: staging is the mode
// QA reviews, so it is the one place the sandboxes are reachable in a deployed
// build with no configuration. It is NOT the steady state — before the escape
// hatch the default was purely command-derived (`serve` includes, `build`
// excludes), which is one line away: return false at step 3.
//
// Everything that is not a `serve` or a `staging` build — production above all —
// strips `(dev)`, so a release cannot accidentally publish the sandboxes.
// `AIKAMI_INCLUDE_DEV_ROUTES=true` still opts any build in explicitly, which is
// what the moon `typecheck` / `test*` tasks and `build:emulator` do.
//
// NODE_ENV is deliberately NOT consulted: moon sets NODE_ENV=production for
// every build task regardless of target mode, so using it here would strip the
// (dev) sandbox routes from test/QA builds (M4).

/** Vite's `ConfigEnv.command`. */
export type ViteCommand = 'build' | 'serve';

/**
 * The build mode whose default is `include`.
 *
 * Named rather than inlined because it is referenced by the resolver, the
 * `AIKAMI_BUILD_MODE` handoff, and the revert.
 */
export const DEV_ROUTES_DEFAULT_INCLUDE_MODE = 'staging';

/** Environment variable that overrides the command/mode-derived default. */
export const DEV_ROUTES_ENV_VAR = 'AIKAMI_INCLUDE_DEV_ROUTES';

/** Directory under `src/routes` holding development-only sandboxes. */
export const DEV_ROUTE_GROUP = '(dev)';

/**
 * Inputs to the dev-route decision.
 *
 * An options object rather than positionals: three pieces of context reach this
 * function, and a positional `mode` is exactly the kind of argument that gets
 * transposed without a type error.
 */
export type DevRouteDecision = {
  /**
   * Vite's command for this invocation. `scripts/gate_dev_routes.ts`,
   * `scripts/build_client.ts` and the deploy guard only ever run on the build
   * path and pass `'build'`.
   */
  readonly command: ViteCommand;
  /**
   * The build mode, as Vite reports it (`process.env.AIKAMI_BUILD_MODE` first,
   * then the config's own `mode`). Deliberately `string | undefined` and not the
   * `Mode` union from `@aikami/types`: Vite's mode is an open string — the dev
   * server runs in `'development'`, `--mode analyze` exists — and the modes
   * union only covers the deployment modes. `undefined` means "not stated",
   * which is treated as not-staging, i.e. exclude.
   */
  readonly mode?: string;
  /** Environment to read the override from (injectable for tests). */
  readonly env?: Record<string, string | undefined>;
};

/**
 * Resolves whether `(dev)` routes belong in the route graph.
 *
 * The mode must be the AUTHORITATIVE one — see `AIKAMI_BUILD_MODE` in
 * vite.config.ts, which resolves it before this call so SvelteKit's config
 * probe and the real build cannot disagree about the route graph.
 */
export const resolveIncludeDevRoutes = (decision: DevRouteDecision): boolean => {
  const env = decision.env ?? process.env;
  const override = env[DEV_ROUTES_ENV_VAR];
  if (override === 'true') {
    return true;
  }
  if (override === 'false') {
    return false;
  }
  // Unset. The dev server runs from source, which is exactly when the sandboxes
  // are useful, so it always keeps them regardless of mode.
  if (decision.command === 'serve') {
    return true;
  }
  return decision.mode === DEV_ROUTES_DEFAULT_INCLUDE_MODE;
};
