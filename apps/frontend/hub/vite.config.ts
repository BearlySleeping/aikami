// apps/frontend/hub/vite.config.ts
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { createLogger, defineConfig, type PluginOption } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { PORTS } from '../../../packages/shared/constants/src/index.ts';

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
const toSrcPath = (path: string) => toPosixPath(join(projectDirectory, 'src', path));

// Set by scripts/src/lib/herdr/session.ts for contract-scoped pipeline runs
// so this app's dev server targets its own per-contract emulator instance,
// not another contract's. 0 otherwise.

// Generate a list of all native Node.js modules (e.g., 'fs', 'stream', 'node:fs')
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Packages that are Node-only and should NEVER be bundled.
const SERVER_ONLY_PACKAGES = [
  '@google-cloud/secret-manager',
  'genkit',
  '@genkit-ai/google-genai',
  'iconv-lite',
];

// Client packages that SHOULD be inlined during the SSR build
const BUNDLE_ONLY_PACKAGES: string[] = [];

// Packages that MUST be externalized even when pulled in transitively.
// The ssr.external array alone doesn't catch subpath imports or transitive
// deps of bundled workspace packages. This plugin catches them at resolve time.
const FORCE_EXTERNAL = new Set([
  'iconv-lite',
  'node-fetch',
  'fetch-blob',
  'formdata-polyfill',
  'web-streams-polyfill',
  'data-uri-to-buffer',
  'node-domexception',
  '@sinclair/typebox',
]);

// Default Vite logger, wrapped below to filter out warnings that cannot be
// suppressed via `build.rolldownOptions.onwarn` (rolldown emits some warnings,
// e.g. EVAL, through the logger instead).
const viteLogger = createLogger();

function forceExternalPlugin(): PluginOption {
  return {
    name: 'force-external',
    enforce: 'pre',
    resolveId(id) {
      for (const pkg of FORCE_EXTERNAL) {
        if (id === pkg || id.includes(`/node_modules/${pkg}/`)) {
          return { id, external: true };
        }
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // src/env.ts declares PUBLIC_APP_ID/PUBLIC_MODE as required+static via
  // SvelteKit's defineEnvVars — that reads Vite's resolved `env`, not our
  // `define` block below (define only affects the client bundle; the SSR
  // build's explicit-env codegen sources values from here instead). Without
  // a .env file (see .env.example), the value baked into the Worker build is
  // '' and every request 500s. PUBLIC_APP_ID never varies; PUBLIC_MODE
  // mirrors the resolved build mode — both safe to default when unset.
  process.env.PUBLIC_APP_ID ??= 'hub';
  process.env.PUBLIC_MODE ??= mode;
  const port = Number(process.env.PORT || PORTS[mode as Mode]?.hub || 5276);

  const plugins: PluginOption[] = [
    forceExternalPlugin(),
    tailwindcss(),
    sveltekit({
      // SvelteKit 3: configuration moved from svelte.config.js to here
      experimental: {
        explicitEnvironmentVariables: true,
      },
      preprocess: [vitePreprocess()],
      compilerOptions: {
        warningFilter: (warning: { code: string }) => warning.code !== 'state_referenced_locally',
      },
      adapter: adapter(),
      alias: {
        $components: toSrcPath('lib/components'),
        '$components/*': toSrcPath('lib/components/*'),
        $lib: toPackagesPath('lib'),
        '$lib/*': toSrcPath('lib/*'),
        $logger: toPackagesPath('shared/logger/src/lib/svelte_kit.ts'),
        $loggerServer: toPackagesPath('shared/logger/src/lib/log_context_backend.ts'),
        '$logger/*': toPackagesPath('shared/logger/src/*'),
        $router: toPackagesPath('frontend/services/src/lib/router/router_utils'),
        $routes: toSrcPath('lib/constants/routes'),
        $services: toSrcPath('lib/client/services'),
        '$services/*': toSrcPath('lib/client/services/*'),
        $types: toSrcPath('lib/types'),
        $utils: toSrcPath('lib/utils'),
        '$views/*': toSrcPath('lib/views/*'),

        '@aikami/backend/svelte-kit/*': toPackagesPath('backend/svelte-kit/src/lib/*'),
        '@aikami/backend/auth': toPackagesPath('backend/auth/src'),
        '@aikami/backend/auth/better-auth': toPackagesPath('backend/auth/src/lib/better_auth.ts'),
        '@aikami/backend/auth/*': toPackagesPath('backend/auth/src/lib/*'),
        '@aikami/backend/utils/*': toPackagesPath('backend/utils/src/lib/*'),
        '@aikami/backend/configs/*': toPackagesPath('backend/configs/src/lib/*'),

        '@aikami/constants': toPackagesPath('shared/constants/src'),
        '@aikami/lpc': toPackagesPath('shared/lpc/src'),
        '@aikami/lpc/*': toPackagesPath('shared/lpc/src/lib/*'),
        '@aikami/frontend/services': toPackagesPath('frontend/services/src'),
        '@aikami/frontend/services/*': toPackagesPath('frontend/services/src/lib/*'),
        '@aikami/logger': toPackagesPath('shared/logger/src'),

        '@aikami/frontend/components': toPackagesPath('frontend/components/src'),
        '@aikami/frontend/components/*': toPackagesPath('frontend/components/src/lib/*'),

        '@aikami/frontend/configs': toPackagesPath('frontend/configs/src'),
        '@aikami/frontend/configs/*': toPackagesPath('frontend/configs/src/lib/*'),
        '@aikami/frontend/theme': toPackagesPath('frontend/theme/src'),
        '@aikami/frontend/theme/*': toPackagesPath('frontend/theme/src/lib/*'),
        '@aikami/frontend/preview': toPackagesPath('frontend/preview/src'),
        '@aikami/frontend/preview/sandbox': toPackagesPath('frontend/preview/src/sandbox.ts'),
        '@aikami/frontend/preview/*': toPackagesPath('frontend/preview/src/lib/*'),
        '@aikami/frontend/engine': toPackagesPath('frontend/engine/src'),
        '@aikami/frontend/engine/*': toPackagesPath('frontend/engine/src/*'),
        '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
        '@aikami/frontend/utils/*': toPackagesPath('frontend/utils/src/lib/*'),
        '@aikami/frontend/storage': toPackagesPath('frontend/storage/src'),
        '@aikami/frontend/storage/*': toPackagesPath('frontend/storage/src/lib/*'),

        '@aikami/schemas': toPackagesPath('shared/schemas/src'),
        '@aikami/types': toPackagesPath('shared/types/src'),
        '@aikami/utils': toPackagesPath('shared/utils/src'),
      },
    }) as PluginOption,
  ];

  if (mode === 'development' && process.env.DEBUG === '1') {
    plugins.unshift(devtoolsJson());
  }

  if (mode === 'analyze') {
    plugins.push(
      visualizer({
        brotliSize: true,
        filename: 'dist/stats.html',
        gzipSize: true,
        open: true,
      }) as unknown as PluginOption, // guard-ignore lint/type-safety/casting: Vite plugin option type - PluginOption union includes non-TS types
    );
  }

  return {
    plugins,

    define: {
      // Ensure PUBLIC_APP_ID and PUBLIC_MODE are always available at runtime.
      // The configs package (@aikami/frontend-configs) requires these.
      'import.meta.env.PUBLIC_APP_ID': JSON.stringify(process.env.PUBLIC_APP_ID || 'hub'),
      'import.meta.env.PUBLIC_MODE': JSON.stringify(process.env.PUBLIC_MODE || mode),
    },

    envPrefix: ['PUBLIC_'],

    customLogger: {
      ...viteLogger,
      warn(msg, options) {
        if (typeof msg === 'string' && msg.includes('strongly discouraged')) {
          return;
        }
        viteLogger.warn(msg, options);
      },
      warnOnce(msg, options) {
        if (typeof msg === 'string' && msg.includes('strongly discouraged')) {
          return;
        }
        viteLogger.warnOnce(msg, options);
      },
    },

    build: {
      // build.rollupOptions is a deprecated alias for rolldownOptions in
      // Vite 8 — use the current option directly.
      rolldownOptions: {
        // Rewrite bare Node builtins (e.g. `crypto`, `util`) to their `node:`
        // prefixed form in the output. Only `/^node:/` specifiers are
        // externalized, so bare builtins left in the SSR output would produce
        // UNRESOLVED_IMPORT warnings. The `node:` form is what workerd
        // resolves under `nodejs_compat`, so behavior is unchanged.
        output: {
          paths: {
            crypto: 'node:crypto',
            util: 'node:util',
          },
        },
        // Prevent bundling Node-only packages AND Node native built-ins
        external: [...SERVER_ONLY_PACKAGES, 'body-parser', 'raw-body', ...NODE_BUILTINS],

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

          // Let everything else through
          warn(warning);
        },
      },
    },

    ssr: {
      // Use a Proxy: array-like for SvelteKit plugin compatibility (includes()),
      // function-like for Vite SSR resolution (id → boolean).
      external: new Proxy([], {
        get(target, prop) {
          if (prop === 'length') {
            return target.length;
          }
          return Reflect.get(target, prop);
        },
        apply(_target, _thisArg, args) {
          const id = String(args[0]);
          // Match by exact package name or path containing /node_modules/<pkg>/
          const externals = [
            ...SERVER_ONLY_PACKAGES,
            'genkit',
            '@genkit-ai/google-genai',
            'iconv-lite',
            'node-fetch',
            'fetch-blob',
            'formdata-polyfill',
            'web-streams-polyfill',
            'data-uri-to-buffer',
            'node-domexception',
            '@sinclair/typebox',
          ];
          for (const pkg of externals) {
            if (id === pkg || id.includes(`/node_modules/${pkg}/`)) {
              return true;
            }
          }
          for (const builtin of NODE_BUILTINS) {
            if (id === builtin || id.startsWith(`node:${builtin}`)) {
              return true;
            }
          }
          return false;
        },
      }) as unknown as string[], // guard-ignore lint/type-safety/casting: Vite plugin option type - PluginOption union includes non-TS types
      noExternal: BUNDLE_ONLY_PACKAGES,
    },

    server: {
      // Bind the IPv4 loopback explicitly: with `0.0.0.0` the server listens
      // on all interfaces but Vite's generated localhost URLs can resolve to
      // ::1 (IPv6) first, which the IPv4-only listener refuses. 127.0.0.1
      // keeps browser + e2e access working (scripts target 127.0.0.1) without
      // relying on IPv6 localhost resolution.
      host: '127.0.0.1',
      fs: {
        allow: [rootDirectory],
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      port,
      strictPort: true,
      proxy: {},
      watch: {
        ignored: [
          '**/examples/**',
          '**/docs/**',
          '**/dist/**',
          '**/.svelte-kit/**',
          '**/.pi/**',
          '**/node_modules/**',
          '**/.git/**',
          '**/build/**',
        ],
      },
    },
  };
});
