// scripts/src/lib/ops/dev_identity_plugin.ts
//
// Dev-only identity endpoint for contract-pipeline readiness probes (C-471
// AC-2, brief P1).
//
// 🔴 Why this exists. The pipeline starts the client/hub dev servers and then
// asks "is the CORRECT instance ready?" A TCP connect or an HTTP 200 on the
// ready port cannot answer that: a server from ANOTHER checkout (or an
// unrelated Vite server a developer already had running) answers exactly the
// same way. The identity probe needs the server to report which checkout and
// run it belongs to, so the probe can compare it to the expected identity and
// refuse a mismatch.
//
// The endpoint is registered ONLY by `configureServer`, which Vite runs for
// the dev server alone — it never exists in a build, so it cannot leak into
// production bundles or a deployed Worker.
//
// Runtime-agnostic on purpose: it takes a structural `DevServerLike` rather
// than importing `vite`'s types, so it adds no Vite dependency and can be
// imported by any app's vite config. It lives under scripts/ (build tooling)
// because it is a Node-time plugin, not frontend runtime code.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The subset of a Vite dev server this plugin touches. */
export type DevMiddlewareServer = {
  middlewares: {
    use: (
      route: string,
      handler: (
        request: { method?: string },
        response: {
          writeHead: (status: number, headers?: Record<string, string>) => void;
          end: (body?: string) => void;
        },
      ) => void,
    ) => void;
  };
};

/** The structural Vite plugin shape (no `vite` import needed). */
export type DevIdentityPlugin = {
  name: string;
  apply: 'serve';
  configureServer: (server: DevMiddlewareServer) => void;
};

/** Path the readiness probe requests. Kept stable across apps. */
export const DEV_IDENTITY_ROUTE = '/.aikami/identity';

/**
 * Walk up from a starting directory to the monorepo root — the first ancestor
 * that contains a `bun.lock`. This MUST match what the probe expects
 * (`resolveServiceRoot(process.cwd())` for a normal start), so we resolve it
 * structurally rather than trusting the app process's own cwd (always an app
 * subdirectory).
 */
const findRepoRoot = (start: string): string => {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth++) {
    if (existsSync(resolve(current, 'bun.lock'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(start);
};

/** The checkout this plugin's source belongs to (independent of app cwd). */
const pluginRepoRoot = (): string => findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Build the identity payload from the dev server's own environment.
 *
 * `checkout` is the checkout under test: the pipeline's WORKSPACE_PATH when a
 * contract run injected it, otherwise the monorepo root this plugin lives in.
 * `runId` and `service` come from the pipeline env vars the orchestrator
 * injects via `tab create --env`. `pid` is included so a probe log can
 * correlate the answer with the OS process.
 */
export const buildDevIdentity = (options: {
  service: string;
  env?: Record<string, string | undefined>;
}): {
  service: string;
  checkout: string;
  runId: string | undefined;
  pid: number;
} => {
  const env = options.env ?? process.env;
  return {
    service: options.service,
    // 🔴 The identity the probe compares against is the pipeline's recorded
    // WORKSPACE_PATH when present; otherwise the repo root the server's own
    // source belongs to — never the app subdirectory the dev server's cwd
    // happens to be in.
    checkout: env.CONTRACT_PIPELINE_WORKSPACE_PATH ?? pluginRepoRoot(),
    runId: env.CONTRACT_PIPELINE_RUN_ID,
    pid: process.pid,
  };
};

/**
 * Vite plugin exposing the dev identity endpoint.
 *
 * @param service - canonical service key (`client`, `hub`, …).
 */
export const devIdentityPlugin = (options: { service: string }): DevIdentityPlugin => ({
  name: 'aikami-dev-identity',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(DEV_IDENTITY_ROUTE, (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      const payload = buildDevIdentity({ service: options.service });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
    });
  },
});
