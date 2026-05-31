// apps/frontend/pwa/vite.config.ts
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { PWA_EMULATOR_PORT, PWA_PORT } from '../../../packages/shared/constants/src/index';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(projectDirectory, '../../..');

// Generate a list of all native Node.js modules (e.g., 'fs', 'stream', 'node:fs')
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Packages that are Node-only and should NEVER be bundled.
const SERVER_ONLY_PACKAGES = [
  'firebase-admin',
  'firebase-admin/app',
  'firebase-admin/auth',
  'firebase-admin/firestore',
  'firebase-functions',
  '@google-cloud/firestore',
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
  const port = Number(process.env.PORT || mode === 'emulator' ? PWA_EMULATOR_PORT : PWA_PORT);

  const plugins: PluginOption[] = [
    forceExternalPlugin(),
    tailwindcss(),
    sveltekit() as PluginOption,
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
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
      }) as unknown as PluginOption,
    );
  }

  return {
    plugins,
    envPrefix: ['PUBLIC_'],

    build: {
      rollupOptions: {
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
      fs: {
        allow: [rootDirectory],
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      port,
    },
  };
});
