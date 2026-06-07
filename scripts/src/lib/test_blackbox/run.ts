#!/usr/bin/env bun

// scripts/src/lib/test_blackbox/run.ts
// Entry point for blackbox tests. Starts emulators + dev servers, runs suites, reports.
// Primary service lifecycle: tmux (bypasses Nix posix_spawn PATH loss).
// Fallback: process spawn (when tmux unavailable).

import { resolve } from 'node:path';
import { startDevServer, stopAllDevServers } from './dev_server_manager.ts';
import type { DockerServiceConfig } from './docker_manager.ts';
import { DockerManager } from './docker_manager.ts';
import { startEmulators, stopEmulators } from './emulator_manager.ts';
import { printTerminalReport, writeJsonReport } from './reporter.ts';
import { COMFYUI_DOCKER_CONFIG } from './suites/comfyui.ts';
import { runSuites } from './test_runner.ts';
import { startServices, stopServices } from './tmux_manager.ts';
import type { SuiteResult, TestSuites } from './types.ts';

const args = process.argv.slice(2);
const suiteFilterSet = new Set(args.filter((a) => !a.startsWith('--')));
const noCrossService = args.includes('--no-cross-service');
const noEmulator = args.includes('--no-emulator');
const withDocker = args.includes('--with-docker');
const force = args.includes('--force') || args.includes('--recreate');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Usage: bun run test:blackbox [suite...] [options]

Run blackbox tests against local emulators + dev servers.

Arguments:
  suite(s)          One or more suite names (runs all if omitted)

Options:
  --no-cross-service  Skip cross-service tests
  --no-emulator       Skip service startup (if already running)
  --with-docker       Start Docker containers for AI backend services
  --force, --recreate Kill existing sessions and recreate from scratch
  --help, -h          Show help

Suites:
  schema-check      Validate Zod schemas + TypeScript types
  functions         Firebase Functions tests (requires emulators)
  pwa               PWA browser tests (requires PWA dev server)
  game-e2e          Game Firebase REST integration (requires emulators + game dev server)
  cross-service     Multi-service flow tests

Examples:
  bun run test:blackbox                         # All suites
  bun run test:blackbox game-e2e                # Game only
  bun run test:blackbox schema-check            # Schema only
  bun run test:blackbox pwa functions           # PWA + Functions
  bun run test:blackbox --no-cross-service      # Skip cross-service
  `);
  process.exit(0);
}

/** Docker services to start when --with-docker flag is passed. */
const DOCKER_SERVICES: DockerServiceConfig[] = [COMFYUI_DOCKER_CONFIG];

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');

let dockerManager: DockerManager | undefined;

async function main() {
  const overallStart = Date.now();

  // ── 1. Load suites ────────────────────────────────────────
  type SuiteRef = { name: string; path: string; key: string };
  const suiteRefs: SuiteRef[] = [
    { name: 'schema-check', path: './suites/schema_check.ts', key: 'schemaCheckSuite' },
    { name: 'functions', path: './suites/functions.api.ts', key: 'functionsSuite' },
    { name: 'pwa', path: './suites/pwa.e2e.ts', key: 'pwaSuite' },
    { name: 'game-e2e', path: './suites/game_e2e.ts', key: 'gameE2eSuite' },
    { name: 'comfyui', path: './suites/comfyui.ts', key: 'comfyuiSuite' },
  ];
  if (!noCrossService) {
    // cross-service suite can be added later
  }

  const suites: TestSuites = [];
  for (const ref of suiteRefs) {
    if (suiteFilterSet.size > 0 && !suiteFilterSet.has(ref.name)) {
      continue;
    }
    try {
      const mod = await import(ref.path);
      if (mod[ref.key]) {
        suites.push(mod[ref.key]);
      }
    } catch {
      if (suiteFilterSet.size === 0) {
        console.warn(`  ⚠️  ${ref.name} suite not available`);
      }
    }
  }

  if (suites.length === 0) {
    console.log('No suites to run. Use --help for options.');
    process.exit(0);
  }

  // ── 2. Start services ─────────────────────────────────────
  const needsEmulator = suites.some(
    (s) => s.category === 'service' || s.category === 'cross-service',
  );
  const needsPwa = suites.some((s) => s.name === 'pwa');
  const needsGame = suites.some((s) => s.name === 'game-e2e');
  const needsAiServices = suites.some((s) => s.name === 'ai-services');

  // ── 2a. Docker services (AI backends) ────────────────────
  if ((withDocker || needsAiServices) && DOCKER_SERVICES.length > 0) {
    dockerManager = new DockerManager({ projectRoot: PROJECT_ROOT });
    const dockerAvailable = await dockerManager.isDockerAvailable();
    if (dockerAvailable) {
      try {
        await dockerManager.startServices(DOCKER_SERVICES);
      } catch (e) {
        console.error('  ⚠ Docker startup failed:', e instanceof Error ? e.message : e);
      }
    } else {
      console.warn('  ⚠ Docker not available — skipping AI backend services');
    }
  }

  if (!noEmulator) {
    const tmuxAvailable = await checkTmuxAvailable();

    if (tmuxAvailable) {
      const only: string[] = [];
      if (needsEmulator) {
        only.push('emulators');
      }
      if (needsGame) {
        only.push('game');
      }
      if (needsPwa) {
        only.push('pwa');
      }

      if (only.length > 0) {
        const startupDesc = force
          ? `🚀 Force-starting services via tmux (${only.join(', ')})...`
          : `🚀 Starting services via tmux (${only.join(', ')})...`;
        console.log(startupDesc);
        try {
          await startServices({ only, force });
        } catch (e) {
          console.error('  ⚠ Tmux startup failed:', e instanceof Error ? e.message : e);
        }
      }
    } else {
      // Fallback: process spawn (may fail in Nix env)
      const services: Promise<void>[] = [];

      if (needsEmulator) {
        services.push(
          startEmulators().catch((e) => {
            console.error('❌ Failed to start emulators:', e instanceof Error ? e.message : e);
          }),
        );
      }

      if (needsPwa) {
        services.push(
          startDevServer('pwa').catch((e) => {
            console.error('  ⚠ PWA dev server failed:', e instanceof Error ? e.message : e);
          }),
        );
      }

      if (services.length > 0) {
        console.log(`🚀 Starting ${services.length} service(s)...`);
        await Promise.all(services);
      }
    }
  } else {
    console.log('⏭  Skipping service startup (--no-emulator)');
  }

  // ── 3. Run suites ─────────────────────────────────────────
  const results: SuiteResult[] = await runSuites(suites, { noCrossService });

  // ── 4. Cleanup ────────────────────────────────────────────
  if (dockerManager) {
    await dockerManager.stopAllServices().catch(() => {});
  }
  await stopServices().catch(() => {});
  await stopAllDevServers().catch(() => {});
  await stopEmulators().catch(() => {});

  // ── 5. Report ─────────────────────────────────────────────
  const dur = Date.now() - overallStart;
  printTerminalReport(results, dur);
  writeJsonReport(results, dur);

  process.exit(results.filter((r) => r.status === 'fail').length > 0 ? 1 : 0);
}

/** Checks if tmux is available on the system. */
async function checkTmuxAvailable(): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const proc = spawn('tmux', ['-V'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

main().catch((e) => {
  console.error('Unhandled:', e);
  if (dockerManager) {
    dockerManager.stopAllServices().catch(() => {});
  }
  stopServices().catch(() => {});
  stopAllDevServers().catch(() => {});
  stopEmulators().catch(() => {});
  process.exit(1);
});
