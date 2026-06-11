// apps/frontend/client/vite.config.ts
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { PORTS } from '../../../packages/shared/constants/src/index';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(projectDirectory, '../../..');

export default defineConfig(({ mode }) => {
  const port = Number(process.env.PORT || PORTS[mode as Mode]?.client || 5274);

  const plugins: PluginOption[] = [
    tailwindcss(),
    sveltekit() as PluginOption,
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
    }) as PluginOption,
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

    build: {
      rollupOptions: {
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

    server: {
      fs: {
        allow: [rootDirectory],
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      port,
      proxy: {
        '/api/voice': {
          target: `http://localhost:${PORTS.emulator.voice}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/voice/, ''),
        },
      },
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

          // 2. Build Outputs
          '**/.svelte-kit/**',
          '**/dist/**',
          '**/build/**',

          // 3. Project Documentation & Examples
          '**/docs/**',
          '**/examples/**',
          '**/references/**',

          // 4. Firebase Emulator Churn (Very important!)
          // The emulator constantly writes logs and database states which
          // triggers unnecessary watcher events
          '**/apps/backend/firebase/tmp/**',
          '**/*.log',

          // 5. Backend Generated Assets
          // Python/ComfyUI outputs that change rapidly and don't affect the PWA code
          '**/apps/backend/image/src/output/**',
          '**/apps/backend/image/src/cache/**',

          // 6. E2E Test Artifacts (Playwright)
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
      headers: {
        // Required for SharedArrayBuffer (crossOriginIsolated).
        // Without these, the worker falls back to N-buffer mode which
        // has a transfer-cycle race condition under setInterval ticks.
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
