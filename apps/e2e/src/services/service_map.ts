// apps/e2e/src/services/service_map.ts
//
// Single source of truth for which app servers the E2E suite uses and which
// of them each Playwright project actually needs.
//
// The preflight (services/preflight.ts, run from global_setup.ts) reads this
// map to decide what to probe, reuse, build or start for the requested
// `--project` selection — replacing Playwright's single global `webServer`
// array, which could only ever be all-or-nothing.
//
// Port numbers are hardcoded here (not imported from @aikami/constants)
// because Playwright loads the config tree with its own Node ESM loader and
// the monorepo packages are CJS/TS modules incompatible with it. They must
// stay in sync with packages/shared/constants/src/lib/development_ports.ts.

// ── Emulator port offset ─────────────────────────────────────

// Same offset formula as development_ports.ts's contractPortOffset(): set by
// scripts/src/lib/herdr for contract-scoped pipeline runs, 0 for manual runs.
const EMULATOR_PORT_OFFSET = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);

const isCI = Boolean(process.env.CI);

const offsetPort = (base: number): number => base + EMULATOR_PORT_OFFSET;

// ── Service catalog ──────────────────────────────────────────

export type ServiceId = 'client' | 'client-llm' | 'site' | 'hub';

export type ServeCommand = {
  command: string;
  /** Relative to the repo root. */
  cwd: string;
  env: Record<string, string>;
};

export type ServiceDef = {
  id: ServiceId;
  label: string;
  /** Absolute port (offset applied) the service must be reachable on. */
  port: number;
  baseUrl: string;
  /**
   * herdr service name (SERVICE_DEFS in scripts/src/lib/herdr/session.ts) to
   * start when herdr is available. `undefined` → the service is ALWAYS
   * self-managed by the preflight, because herdr cannot run it with the env
   * it needs (client-llm is a dev server with PUBLIC_COMBAT_LLM_AGENTS=1,
   * which is `static: true` and must be read at server startup).
   */
  herdrService?: string;
  /**
   * moon tasks producing the artifact this service serves. Only run when the
   * service actually serves built output (see `servesBuild`) and the artifact
   * is missing. Empty → never needs a build.
   */
  buildTasks: string[];
  /** Built-output existence check; empty for dev-server-only services. */
  artifactPath?: string;
  /** True when the fallback serve command serves BUILT output. */
  servesBuild: boolean;
  /** Fallback serve command, used when herdr is unavailable (e.g. CI). */
  serve: ServeCommand;
  readyTimeoutMs: number;
};

// Ports — see the sync warning in the file header.
const CLIENT_PORT = offsetPort(5274);
// C-526 AC-10: a SECOND client server, started with `PUBLIC_COMBAT_LLM_AGENTS=1`
// so the flag-off and enabled-agent lanes can run in one suite.
const CLIENT_LLM_PORT = offsetPort(5275);
const SITE_PORT = offsetPort(5280);
const HUB_PORT = offsetPort(5276);
const HUB_WORKER_PORT = offsetPort(5278);

// 🔴 The hub is served from a different port in CI than locally, deliberately.
// Locally (herdr tab or `vite dev`) SvelteKit's platform proxy supplies the D1
// and R2 bindings the /api routes need. `vite preview` does NOT set up the
// platform proxy, so CI serves the built hub through `wrangler dev --local`
// (dev:worker → run_hub_worker.ts) on its own port with genuine local D1/R2.
const HUB_SERVE_PORT = isCI ? HUB_WORKER_PORT : HUB_PORT;

// Env for the fallback builds (mirrors the "Build apps under test" step in
// .github/workflows/pr-checks.yml — the fallback must be exactly the CI recipe).
export const FALLBACK_BUILD_ENV: Record<string, string> = {
  PUBLIC_APP_ID: 'site',
  PUBLIC_MODE: 'development',
};

// Shared serve env: vite dev/preview read these at startup.
// PUBLIC_MODE=emulator installs the `__AIKAMI_TEST__` seam
// (installGameTestSeam no-ops in production); PUBLIC_MUTE_AUDIO pins
// AudioService's master gain to silence (browser --mute-audio covers the rest).
const CLIENT_SERVE_ENV = {
  PORT: String(CLIENT_PORT),
  PUBLIC_MUTE_AUDIO: '1',
  PUBLIC_MODE: 'emulator',
};

export const SERVICE_DEFS: Record<ServiceId, ServiceDef> = {
  client: {
    id: 'client',
    label: 'client (game/PWA)',
    port: CLIENT_PORT,
    baseUrl: `http://localhost:${CLIENT_PORT}`,
    herdrService: 'client',
    // Locally the fallback is a DEV server so the env is read at startup
    // instead of trusting whatever `build/` happens to hold. CI serves built
    // output (no HMR warm-up, no first-request compile stalls) per the
    // pr-checks recipe.
    serve: {
      command: isCI ? 'bun run preview' : 'bun run dev:emulator',
      cwd: 'apps/frontend/client',
      env: CLIENT_SERVE_ENV,
    },
    buildTasks: isCI ? ['client:build'] : [],
    artifactPath: 'apps/frontend/client/build',
    servesBuild: isCI,
    readyTimeoutMs: 120_000,
  },
  'client-llm': {
    id: 'client-llm',
    label: 'client-llm (enabled agents)',
    port: CLIENT_LLM_PORT,
    baseUrl: `http://localhost:${CLIENT_LLM_PORT}`,
    // No herdr service: the flag must be set on the server that serves the
    // app, and it is `static: true` — see the class comment on herdrService.
    serve: {
      command: 'bun run dev:emulator',
      cwd: 'apps/frontend/client',
      env: {
        PORT: String(CLIENT_LLM_PORT),
        PUBLIC_MUTE_AUDIO: '1',
        PUBLIC_MODE: 'emulator',
        PUBLIC_COMBAT_LLM_AGENTS: '1',
      },
    },
    buildTasks: [],
    // 🔴 Never build for this lane: `preview` would serve a build in which
    // import.meta.env.PUBLIC_COMBAT_LLM_AGENTS was already inlined (off).
    servesBuild: false,
    readyTimeoutMs: 120_000,
  },
  site: {
    id: 'site',
    label: 'site (marketing)',
    port: SITE_PORT,
    baseUrl: `http://localhost:${SITE_PORT}`,
    herdrService: 'site',
    // Astro static output — previewing is just serving files, CI or not.
    serve: {
      command: 'bun run preview',
      cwd: 'apps/frontend/site',
      env: { PORT: String(SITE_PORT) },
    },
    buildTasks: ['site:build'],
    artifactPath: 'apps/frontend/site/dist',
    servesBuild: true,
    readyTimeoutMs: 120_000,
  },
  hub: {
    id: 'hub',
    label: 'hub (SSR + API)',
    port: HUB_SERVE_PORT,
    baseUrl: `http://localhost:${HUB_SERVE_PORT}`,
    herdrService: 'hub',
    serve: {
      // See HUB_SERVE_PORT above for why CI and local differ here.
      command: isCI ? 'bun run dev:worker' : 'bun run dev',
      cwd: 'apps/frontend/hub',
      env: { PORT: String(HUB_SERVE_PORT) },
    },
    // hub:db-migrate-local creates the local D1 the hub worker binds to —
    // without it every hub /api route 500s (pr-checks.yml).
    buildTasks: isCI ? ['hub:build', 'hub:db-migrate-local'] : [],
    artifactPath: isCI ? 'apps/frontend/hub/build/_worker.js' : undefined,
    servesBuild: isCI,
    readyTimeoutMs: 180_000,
  },
};

// ── Project → services map ───────────────────────────────────

/**
 * Which services each Playwright project actually contacts. This is the
 * per-run replacement for the old global webServer array: only the union of
 * the requested projects' services is probed/started.
 *
 * 🔴 `client*` projects (and `setup`) include the hub because Playwright runs
 * the `setup` dependency for them and auth.setup.ts signs in against the hub.
 * `game` has NO setup dependency and its boot is offline-first — the hub is
 * deliberately optional there (engine_boot_check.spec.ts even allowlists hub
 * connection failures), so it is NOT started for a game-only run.
 */
export const PROJECT_SERVICES: Record<string, readonly ServiceId[]> = {
  setup: ['client', 'hub'],
  'site-chromium': ['site'],
  'site-mobile': ['site'],
  'site-firefox': ['site'],
  client: ['client', 'hub'],
  'client-llm-on': ['client', 'client-llm', 'hub'],
  hub: ['hub'],
  game: ['client'],
  // tests/ai-services/ is empty today — no servers until it has specs.
  'ai-services': [],
  'client-offline': ['client', 'hub'],
  'client-keyboard': ['client', 'hub'],
  'client-webgpu': ['client', 'hub'],
};

/**
 * Projects considered when Playwright runs WITHOUT `--project`. The
 * conditionally-defined projects are included only when their defining env
 * flag is set — matching the `projects:` array in playwright.config.ts.
 */
export const defaultProjectSelection = (): string[] =>
  Object.keys(PROJECT_SERVICES).filter((name) => {
    if (name === 'client-llm-on') {
      return process.env.E2E_LLM_LANE === '1';
    }
    if (name === 'client-webgpu') {
      return process.env.TEST_WEBGPU === 'true';
    }
    return true;
  });

/**
 * Union of services the requested projects need.
 *
 * Unknown project names are ignored: Playwright itself fails collection with
 * "Project … not found", and a preflight error would only mask that message.
 * An empty/absent selection means "run all" → the default selection above.
 */
export const resolveRequiredServices = (requested: readonly string[] | undefined): ServiceId[] => {
  const names = requested && requested.length > 0 ? requested : defaultProjectSelection();
  const matched = names.filter((name) => name in PROJECT_SERVICES);
  const effective = matched.length > 0 ? matched : defaultProjectSelection();

  const union = new Set<ServiceId>();
  for (const name of effective) {
    for (const service of PROJECT_SERVICES[name]) {
      union.add(service);
    }
  }
  return [...union];
};
