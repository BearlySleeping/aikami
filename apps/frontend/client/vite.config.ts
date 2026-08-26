// apps/frontend/client/vite.config.ts
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { createLogger, defineConfig, type PluginOption } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { PORTS } from '../../../packages/shared/constants/src/index.ts';

// Default Vite logger, wrapped below to filter out warnings that cannot be
// suppressed via `build.rollupOptions.onwarn` (rolldown emits some warnings,
// e.g. EVAL, PLUGIN_TIMINGS, and INEFFECTIVE_DYNAMIC_IMPORT, through the
// logger instead).
const viteLogger = createLogger();

/** True for warnings that are expected for this codebase and can be dropped.
 *  Matched narrowly to their known sources so unrelated warnings stay visible. */
function isIgnoredWarning(msg: string): boolean {
  if (typeof msg !== 'string') {
    return false;
  }
  // rolldown EVAL warning — emitted only when bundling the eruda debug
  // console (the message carries the eruda module path)
  if (msg.includes('strongly discouraged') && msg.includes('eruda')) {
    return true;
  }
  // plugin timing diagnostics
  if (msg.includes('PLUGIN_TIMINGS')) {
    return true;
  }
  // The services barrel (src/lib/services/index.ts) is statically imported
  // by 150+ modules, so `import('$services')` can never split a chunk. Those
  // dynamic imports exist to break circular dependencies at module-init time,
  // not for code-splitting — the warning is expected for this architecture.
  if (msg.includes('src/lib/services/index.ts is dynamically imported')) {
    return true;
  }
  return false;
}

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(projectDirectory, '../../..');
const packagesDirectory = resolve(projectDirectory, '../../../packages');

/**
 * Convert a path to use forward slashes.
 *
 * SvelteKit's tsconfig generator strips a trailing `/*` from alias values by
 * checking `value.endsWith('/*')` (literal forward slash). `node:path`'s
 * `join()` emits backslashes on Windows, so that check silently fails there
 * and SvelteKit appends its own `/*`, producing a broken `**\/*\/*` pattern.
 * Keeping alias values posix-style avoids that on every platform.
 */
const toPosixPath = (path: string) => path.split('\\').join('/');
const toPackagesPath = (path: string) => toPosixPath(join(packagesDirectory, path));

/**
 * Get the absolute path from the src folder in the project directory
 */
const toSrcPath = (path: string) => toPosixPath(join(projectDirectory, 'src', path));

// ---------------------------------------------------------------------------
// Dev-route build gate (C-418 Feature B)
//
// Production builds must not ship the `(dev)` route group. SvelteKit 2.70 has
// no `kit.routes` filter, so the gate points `files.routes` at a filtered
// copy of the routes directory (`.svelte-kit/routes-prod`), materialized by
// scripts/gate_dev_routes.ts before every build (M3). The flag is a build
// flag, never a runtime check:
//
//   AIKAMI_INCLUDE_DEV_ROUTES=true   → always include `(dev)` (test builds)
//   AIKAMI_INCLUDE_DEV_ROUTES=false  → always exclude `(dev)`
//   unset                            → exclude iff the VITE BUILD MODE is
//                                       'production' (set by vite.config.ts)
//
// NODE_ENV is deliberately NOT consulted: moon sets NODE_ENV=production for
// every build task regardless of target mode, so using it here would strip
// the (dev) sandbox routes from test/QA builds (M4). The vite mode is the
// single source of truth.
// ---------------------------------------------------------------------------
const buildMode = process.env.AIKAMI_BUILD_MODE;
const devGateOverride = process.env.AIKAMI_INCLUDE_DEV_ROUTES;
const isProductionBuild = buildMode === 'production';
let includeDevRoutes;
if (devGateOverride === 'true') {
  includeDevRoutes = true;
} else if (devGateOverride === 'false') {
  includeDevRoutes = false;
} else {
  includeDevRoutes = !isProductionBuild;
}

const FILTERED_ROUTES_DIR = join(projectDirectory, '.svelte-kit', 'routes-prod');
let routesDir = 'src/routes';
if (!includeDevRoutes) {
  // Guard (M3): a bare `vite build` without the gate script would point
  // `files.routes` at a missing directory and fail confusingly (or worse,
  // build from a stale copy). Fail fast with a clear remedy instead.
  if (!existsSync(FILTERED_ROUTES_DIR)) {
    throw new Error(
      '[dev-route gate] the filtered routes copy (.svelte-kit/routes-prod) is missing. ' +
        'Run the build through the package scripts (bun run build:production) or execute ' +
        'scripts/gate_dev_routes.ts --mode production first.',
    );
  }
  routesDir = '.svelte-kit/routes-prod';
}

export default defineConfig(({ mode }) => {
  // Expose the Vite mode to svelte.config.js (loaded later by the SvelteKit
  // plugin) so the dev-route build gate (C-418 Feature B) can exclude the
  // `(dev)` route group from production builds without a runtime check.
  //
  // `??=`, never `=`: SvelteKit probes this config via `load_config_from_vite`
  // with its OWN default mode (production) before the real build mode is
  // known. An unconditional assignment leaks 'production' into the env for the
  // rest of the process, so a `--mode staging` build then demands the filtered
  // routes copy that the gate correctly did not create, and dies. When the
  // build runner has already exported the mode, that value is authoritative.
  process.env.AIKAMI_BUILD_MODE ??= mode;
  const port = Number(process.env.PORT || PORTS[mode as Mode]?.client || 5274);
  // Set by scripts/src/lib/herdr/session.ts for contract-scoped pipeline
  // runs so this app's Firebase Auth emulator proxy targets its own
  // per-contract emulator instance, not another contract's. 0 otherwise.
  const emulatorPortOffset = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);

  const plugins: PluginOption[] = [
    tailwindcss(),
    sveltekit({
      // SvelteKit 3: configuration moved from svelte.config.js to here
      preprocess: [vitePreprocess()],
      files: {
        routes: routesDir,
      },
      adapter: adapter({
        fallback: 'index.html',
        pages: 'build',
        assets: 'build',
      }),
      prerender: {
        handleUnseenRoutes: 'ignore',
      },
      alias: {
        $appCss: toSrcPath('app.css'),
        '$components/*': toSrcPath('lib/components/*'),
        $i18n: toSrcPath('lib/utils/i18n'),
        $lib: toPackagesPath('lib'),
        '$lib/*': toSrcPath('lib/*'),
        $router: toPackagesPath('frontend/services/src/lib/router/router_utils'),
        $routes: toSrcPath('lib/constants/routes'),
        $logger: toPackagesPath('shared/logger/src/lib/logger_browser.ts'), //if we use ssr we should use svelte_kit, but since it is client only we can safely use logger_browser
        $services: toSrcPath('lib/services'),
        '$services/*': toSrcPath('lib/services/*'),

        $types: toSrcPath('lib/types'),
        $utils: toSrcPath('lib/utils'),
        '$utils/*': toSrcPath('lib/utils/*'),
        '$views/*': toSrcPath('lib/views/*'),

        '@aikami/backend/auth/*': toPackagesPath('backend/auth/src/lib/*'),
        '@aikami/backend/onboarding': toPackagesPath('backend/onboarding/src'),
        '@aikami/backend/agent': toPackagesPath('backend/agent/src'),
        '@aikami/backend/knowledge': toPackagesPath('backend/knowledge/src'),
        '@aikami/backend/team': toPackagesPath('backend/team/src'),
        '@aikami/backend/admin': toPackagesPath('backend/admin/src'),
        '@aikami/backend/utils/*': toPackagesPath('backend/utils/src/lib/*'),
        '@aikami/backend/configs/*': toPackagesPath('backend/configs/src/lib/*'),

        '@aikami/lpc': toPackagesPath('shared/lpc/src'),
        '@aikami/lpc/*': toPackagesPath('shared/lpc/src/lib/*'),
        '@aikami/constants': toPackagesPath('shared/constants/src'),
        '@aikami/frontend/services': toPackagesPath('frontend/services/src'),
        '@aikami/frontend/services/*': toPackagesPath('frontend/services/src/lib'),
        '@aikami/frontend/components': toPackagesPath('frontend/components/src'),
        '@aikami/frontend/components/*': toPackagesPath('frontend/components/src/lib/*'),

        '@aikami/frontend/configs': toPackagesPath('frontend/configs/src'),
        '@aikami/frontend/configs/*': toPackagesPath('frontend/configs/src/lib'),
        '@aikami/frontend/theme': toPackagesPath('frontend/theme/src'),
        '@aikami/frontend/theme/*': toPackagesPath('frontend/theme/src/lib/*'),
        '@aikami/frontend/ai-gateway': toPackagesPath('frontend/ai-gateway/src'),
        '@aikami/frontend/ai-gateway/*': toPackagesPath('frontend/ai-gateway/src/lib/*'),
        '@aikami/frontend/local-runtime': toPackagesPath('frontend/local-runtime/src'),
        '@aikami/frontend/local-runtime/*': toPackagesPath('frontend/local-runtime/src/lib/*'),
        '@aikami/frontend/engine': toPackagesPath('frontend/engine/src'),
        '@aikami/frontend/engine/*': toPackagesPath('frontend/engine/src/*'),
        '@aikami/frontend/svelte-kit': toPackagesPath('frontend/svelte-kit/src'),
        '@aikami/frontend-svelte-kit/*': toPackagesPath('frontend/svelte-kit/src/lib/*'),

        '@aikami/frontend/test': toPackagesPath('frontend/test/src'),
        '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
        '@aikami/frontend/utils/*': toPackagesPath('frontend/utils/src/lib'),
        '@aikami/frontend/storage': toPackagesPath('frontend/storage/src'),
        '@aikami/frontend/storage/*': toPackagesPath('frontend/storage/src/lib'),

        '@aikami/mocks': toPackagesPath('shared/mocks/src'),
        '@aikami/schemas': toPackagesPath('shared/schemas/src'),
        '@aikami/table': toPackagesPath('frontend/table/src'),
        '@aikami/types': toPackagesPath('shared/types/src'),
        '@aikami/utils': toPackagesPath('shared/utils/src'),
      },
    }) as PluginOption,
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
    }) as PluginOption,
    {
      name: 'internal-logging-endpoint',
      configureServer(server) {
        server.middlewares.use('/api/internal_logging', (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405).end();
            return;
          }
          const chunks: Uint8Array[] = [];
          req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf-8');
              const parsed = JSON.parse(body);
              const ts = new Date().toISOString();
              const label = parsed.label || 'api';
              const payload = parsed.payload;
              // biome-ignore lint/suspicious/noConsole: /api/internal_logging dev endpoint — writes to herdr stdout
              console.log(`[internal-logs] ${ts} [${label}]`, JSON.stringify(payload));
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.writeHead(400).end();
            }
          });
        });
      },
    } as PluginOption,
  ];

  if (mode === 'staging' && process.env.DEBUG === '1') {
    plugins.unshift(devtoolsJson());
  }

  if (mode === 'analyze') {
    plugins.push(
      visualizer({
        brotliSize: true,
        filename: 'dist/stats.html',
        gzipSize: true,
        open: true,
      }) as unknown as PluginOption,
    );
  }

  return {
    plugins,

    envPrefix: ['PUBLIC_'],

    customLogger: {
      ...viteLogger,
      warn(msg, options) {
        if (isIgnoredWarning(msg)) {
          return;
        }
        viteLogger.warn(msg, options);
      },
      warnOnce(msg, options) {
        if (isIgnoredWarning(msg)) {
          return;
        }
        viteLogger.warnOnce(msg, options);
      },
    },

    build: {
      emptyOutDir: true,
      // The app bundles a game engine (PixiJS), Firebase, and a large services
      // layer. Measured budget (staging build, 2026-08): largest JS chunk
      // ~596 kB raw / ~150 kB gzip (services + engine), plus the kokoro TTS
      // worker at ~520 kB and lazy-loaded ONNX/SQLite worker assets far above
      // this limit. 1000 keeps the warning useful for real regressions without
      // false positives for the inherent engine/barrel chunk sizes.
      chunkSizeWarningLimit: 1000,
      // build.rollupOptions is a deprecated alias for rolldownOptions in
      // Vite 8 — use the current option directly.
      rolldownOptions: {
        // Mute unavoidable warnings from third-party dependencies
        onwarn(warning, warn) {
          // Silence all eval warnings
          if (warning.code === 'EVAL' || warning.message.includes('Use of direct `eval`')) {
            return;
          }
          // Silence plugin timing diagnostics
          if (warning.code === 'PLUGIN_TIMINGS' || warning.message.includes('PLUGIN_TIMINGS')) {
            return;
          }
          // The services barrel (src/lib/services/index.ts) is statically
          // imported by 150+ modules, so any `import('$services')` can never
          // split a chunk. Those dynamic imports exist to break circular
          // dependencies at module-init time, not for code-splitting — the
          // warning is expected for this architecture.
          if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') {
            return;
          }

          // Let everything else through
          warn(warning);
        },
      },
    },

    worker: {
      // Vite's default format is 'iife', but we override to 'es' because
      // ecs_worker_bootstrap.ts uses import('./ecs_worker.ts'), which requires
      // ES module format. IIFE/UMD worker builds do not support code-splitting
      // dynamic imports.
      format: 'es',
    },

    server: {
      fs: {
        allow: [rootDirectory],
      },
      port,
      strictPort: true,
      proxy:
        mode === 'emulator'
          ? {
              '/api/voice': {
                target: `http://localhost:${PORTS.emulator.voice}`,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/voice/, ''),
              },
              '/api/text': {
                target: `http://localhost:${PORTS.emulator.text}`,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/text/, ''),
              },
              '/api/image': {
                target: `http://localhost:${PORTS.emulator.image}`,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/image/, ''),
              },
              // C-418 Feature D: proxy hub-hosted auth endpoints (formerly
              // Firebase Callable Functions) to the hub's dev server. The
              // hub's Elysia app lives under its own /api prefix, so strip
              // the /api/hub prefix after forwarding.
              '/api/hub': {
                target: `http://localhost:${PORTS.emulator.hub + emulatorPortOffset}`,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/hub/, '/api'),
              },
              '/api/kokoro-tts': {
                target: 'http://localhost:8880',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/kokoro-tts/, ''),
              },
            }
          : {},
      watch: {
        ignored: [
          // 1. Tooling & OS Caches (The biggest culprits)
          '**/.direnv/**', // Nix store symlinks (Infinite depth)
          '**/.moon/**', // Moonrepo cache
          '**/.git/**', // Git history
          '**/node_modules/**', // Let Vite handle deps via pre-bundling
          '**/.pi/**', // Pi agent cache
          '**/pi-offloads/**',
          '**/tmp/**',
          '**/.screenshots/**',
          '**/static/**',

          // 2. Build Outputs
          '**/.svelte-kit/**',
          '**/dist/**',
          '**/build/**',

          // 3. Project Documentation & Examples
          '**/docs/**',
          '**/examples/**',
          '**/references/**',

          // 4. Backend Generated Assets
          // Python/ComfyUI outputs that change rapidly and don't affect the PWA code
          '**/apps/backend/image/src/output/**',
          '**/apps/backend/image/src/cache/**',

          // 5. E2E Test Artifacts (Playwright)
          '**/playwright-report/**',
          '**/test-results/**',
          '**/blob-report/**',
        ],
      },
    },

    // Use the same port for vite preview so Playwright E2E tests
    // can target a single port regardless of dev vs preview mode.
    preview: {
      port,
      strictPort: true,
    },
  };
});
