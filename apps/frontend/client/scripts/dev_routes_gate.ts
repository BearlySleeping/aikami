// apps/frontend/client/scripts/dev_routes_gate.ts
//
// C-418 Feature B: the single source of truth for whether the `(dev)` route
// group is part of the route graph.
//
// Two callers must agree on this decision:
//   - vite.config.ts          → sets `files.routes`
//   - scripts/gate_dev_routes.ts → materializes the filtered routes copy
//
// If they disagree the failure is silent and expensive: vite.config.ts builds
// from `src/routes` (dev routes included) while the gate believes it produced a
// filtered tree. The `(dev)` code is then bundled into a distributable build,
// and `check_deploy_assets.ts` cannot see it — an adapter-static SPA emits no
// per-route HTML directories, so the only symptom is an unexplained bundle-size
// regression. Keeping one resolver here makes that class of divergence
// impossible.
//
// Precedence:
//   1. AIKAMI_INCLUDE_DEV_ROUTES=true|false → explicit override, always wins
//   2. command === 'serve'                  → include (dev server)
//   3. command === 'build'                  → exclude (distributable build)
//
// The unset default is command-derived, not a constant. A dev server keeps the
// sandboxes with no configuration at all (it is running from source, which is
// exactly when they are useful), while every build — staging included — ships
// the production route graph unless a developer explicitly opts in.
//
// NODE_ENV is deliberately NOT consulted: moon sets NODE_ENV=production for
// every build task regardless of target mode, so using it here would strip the
// (dev) sandbox routes from test/QA builds (M4).

/** Vite's `ConfigEnv.command`. */
export type ViteCommand = 'build' | 'serve';

/** Environment variable that overrides the command-derived default. */
export const DEV_ROUTES_ENV_VAR = 'AIKAMI_INCLUDE_DEV_ROUTES';

/** Directory under `src/routes` holding development-only sandboxes. */
export const DEV_ROUTE_GROUP = '(dev)';

/**
 * Resolves whether `(dev)` routes belong in the route graph.
 *
 * @param command Vite's command for this invocation. `scripts/gate_dev_routes.ts`
 *   only ever runs on the build path, so it passes `'build'`.
 * @param env Environment to read the override from (injectable for tests).
 */
export const resolveIncludeDevRoutes = (
  command: ViteCommand,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const override = env[DEV_ROUTES_ENV_VAR];
  if (override === 'true') {
    return true;
  }
  if (override === 'false') {
    return false;
  }
  // Unset: the dev server keeps the sandboxes, builds do not.
  return command === 'serve';
};
