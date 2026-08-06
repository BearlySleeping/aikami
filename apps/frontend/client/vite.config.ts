// apps/frontend/client/vite.config.ts
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
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

export default defineConfig(({ mode }) => {
  const port = Number(process.env.PORT || PORTS[mode as Mode]?.client || 5274);

  /** COEP relaxed in emulator so Firebase Auth emulator popup/iframe relay works cross-origin.
   * In emulator mode, COEP is unset (matching hooks.server.ts behavior) to allow the Firebase
   * Auth popup/iframe relay to work. In other modes, 'require-corp' enables crossOriginIsolated
   * (SharedArrayBuffer for TTS). */
  const crossOriginEmbedderPolicy = mode === 'emulator' ? undefined : 'require-corp';

  const plugins: PluginOption[] = [
    tailwindcss(),
    sveltekit() as PluginOption,
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
    }) as PluginOption,
    {
      name: 'cross-origin-isolation',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          if (crossOriginEmbedderPolicy) {
            res.setHeader('Cross-Origin-Embedder-Policy', crossOriginEmbedderPolicy);
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          if (crossOriginEmbedderPolicy) {
            res.setHeader('Cross-Origin-Embedder-Policy', crossOriginEmbedderPolicy);
          }
          next();
        });
      },
    } as PluginOption,
    {
      name: 'api-logs-endpoint',
      configureServer(server) {
        server.middlewares.use('/api/logs', (req, res) => {
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
              // biome-ignore lint/suspicious/noConsole: /api/logs server-side endpoint — writes to herdr stdout
              console.log(`[api-logs] ${ts} [${label}]`, JSON.stringify(payload));
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
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        ...(crossOriginEmbedderPolicy
          ? { 'Cross-Origin-Embedder-Policy': crossOriginEmbedderPolicy }
          : {}),
      },
      port,
      strictPort: true,
      proxy:
        mode === 'emulator'
          ? {
              // Proxy Firebase Auth emulator through the dev server so the
              // popup, relay iframe, and main page all share localhost:5274.
              // This fixes the "No matching frame" error in signInWithPopup.
              '/emulator/auth': {
                target: `http://localhost:${PORTS.emulator.auth}`,
                changeOrigin: true,
              },
              // Proxy Firebase Auth REST API calls to the emulator.
              // The SDK calls identitytoolkit + securetoken endpoints to
              // exchange OAuth credentials for Firebase tokens.
              '/identitytoolkit.googleapis.com': {
                target: `http://localhost:${PORTS.emulator.auth}`,
                changeOrigin: true,
              },
              '/securetoken.googleapis.com': {
                target: `http://localhost:${PORTS.emulator.auth}`,
                changeOrigin: true,
              },
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
      strictPort: true,
      headers: {
        // Required for SharedArrayBuffer (crossOriginIsolated).
        // Without these, the worker falls back to N-buffer mode which
        // has a transfer-cycle race condition under setInterval ticks.
        'Cross-Origin-Opener-Policy': 'same-origin',
        ...(crossOriginEmbedderPolicy
          ? { 'Cross-Origin-Embedder-Policy': crossOriginEmbedderPolicy }
          : {}),
      },
    },
  };
});
