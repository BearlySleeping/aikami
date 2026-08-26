// apps/frontend/client/svelte.config.js
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const packagesDirectory = resolve(projectDirectory, '../../../packages');
/**
 * Get the absolute path from the root directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
/**
 * Convert a path to use forward slashes.
 *
 * SvelteKit's tsconfig generator strips a trailing `/*` from alias values by
 * checking `value.endsWith('/*')` (literal forward slash). `node:path`'s
 * `join()` emits backslashes on Windows, so that check silently fails there
 * and SvelteKit appends its own `/*`, producing a broken `**\/*\/*` pattern.
 * Keeping alias values posix-style avoids that on every platform.
 *
 * @param {string} path
 * @returns {string}
 */
const toPosixPath = (path) => path.split('\\').join('/');
const toPackagesPath = (path) => toPosixPath(join(packagesDirectory, path));
/**
 * Get the absolute path from the src folder in the project directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
const toSrcPath = (path) => toPosixPath(join(projectDirectory, 'src', path));

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
const devGateOverride = process.env.AIKAMI_INCLUDE_DEV_ROUTES ?? true; // We include dev routes by default while we are in early stage
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

const config = {
  preprocess: [vitePreprocess()],
  kit: {
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

      '@aikami/frontend/preview': toPackagesPath('frontend/preview/src'),
      '@aikami/frontend/preview/*': toPackagesPath('frontend/preview/src/*'),

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
  },
};

export default config;
