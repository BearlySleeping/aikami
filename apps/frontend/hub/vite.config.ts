// apps/frontend/hub/vite.config.ts
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { createLogger, defineConfig, loadEnv, type PluginOption, type ProxyOptions } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { PORTS } from '../../../packages/shared/constants/src/index.ts';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(projectDirectory, '../../..');

// Set by scripts/src/lib/herdr/session.ts for contract-scoped pipeline runs
// so this app's Firebase Auth emulator proxy targets its own per-contract
// emulator instance, not another contract's. 0 otherwise.
const emulatorPortOffset = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);
const emulatorAuthPort = PORTS.emulator.auth + emulatorPortOffset;

/** Firebase Auth emulator proxies so the SDK's popup/relay share one origin. */
// The auth emulator binds 127.0.0.1 only — target it directly (a `localhost`
// target resolves to ::1 first and the proxy fails, leaving the popup
// handler blank).
const emulatorAuthProxy: Record<string, string | ProxyOptions> = {
  '/emulator/auth': {
    target: `http://127.0.0.1:${emulatorAuthPort}`,
    changeOrigin: true,
  },
  '/identitytoolkit.googleapis.com': {
    target: `http://127.0.0.1:${emulatorAuthPort}`,
    changeOrigin: true,
  },
  '/securetoken.googleapis.com': {
    target: `http://127.0.0.1:${emulatorAuthPort}`,
    changeOrigin: true,
  },
};

// Generate a list of all native Node.js modules (e.g., 'fs', 'stream', 'node:fs')
// EXCEPT `node:module`. On Cloudflare Workers (adapter-cloudflare), leaving
// `node:module` external forces `createRequire(import.meta.url)` in SvelteKit's
// server core to run with `import.meta.url === undefined`, which throws at module
// load. Inlining `node:module` preserves `import.meta.url` and lets workerd's
// nodejs_compat provide createRequire correctly.
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)].filter(
  (m) => m !== 'node:module' && m !== 'module',
);

// Packages that are Node-only and should NEVER be bundled.
const SERVER_ONLY_PACKAGES = [
  'firebase-functions',
  '@google-cloud/secret-manager',
  'genkit',
  '@genkit-ai/google-genai',
  'iconv-lite',
];

// Client packages that SHOULD be inlined during the SSR build
// Note: Supplying the root package name ('firebase') handles all subpaths ('firebase/app', etc.)
const BUNDLE_ONLY_PACKAGES = ['firebase'];

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
  // Load the full env file for this mode so PUBLIC_MODE (set in .env.<mode>)
  // drives runtime behaviour instead of the Vite mode argument.
  const env = loadEnv(mode, projectDirectory, '');
  const port = Number(process.env.PORT || PORTS[mode as Mode]?.hub || 5276);

  const plugins: PluginOption[] = [
    forceExternalPlugin(),
    tailwindcss(),
    sveltekit() as PluginOption,
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
      }) as unknown as PluginOption,
    );
  }

  return {
    plugins,
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
      }) as unknown as string[],
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
        // Same-origin popup/iframe relay for the Firebase Auth emulator
        // sign-in flow (matches the client app's cross-origin isolation
        // headers — the hub has no SharedArrayBuffer usage, so COEP stays
        // unset to keep the relay cross-origin-safe).
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      port,
      strictPort: true,
      proxy: env.PUBLIC_MODE === 'emulator' ? emulatorAuthProxy : {},
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
          '**/.firebase/**',
        ],
      },
    },
  };
});
