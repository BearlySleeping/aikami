#!/usr/bin/env bun
// scripts/src/test_blackbox/run.ts
// Entry point for blackbox tests. Starts emulators + dev servers, runs suites, reports.

import { startDevServer, stopAllDevServers } from './dev_server_manager.ts';
import { startEmulators, stopEmulators } from './emulator_manager.ts';
import { printTerminalReport, writeJsonReport } from './reporter.ts';
import { runSuites } from './test_runner.ts';
import type { SuiteResult, TestSuites } from './types.ts';

const args = process.argv.slice(2);
const suiteFilterSet = new Set(args.filter((a) => !a.startsWith('--')));
const noCrossService = args.includes('--no-cross-service');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Usage: bun run test:blackbox [suite...] [options]

Run blackbox tests against local emulators + dev servers.

Arguments:
  suite(s)          One or more suite names (runs all if omitted)

Options:
  --no-cross-service  Skip cross-service tests
  --no-emulator       Skip emulator startup (if already running)
  --help, -h          Show help

Suites:
  schema-check      Validate Zod schemas + TypeScript types
  functions         Firebase Functions tests (requires emulators)
  pwa               PWA browser tests (requires PWA dev server)
  cross-service     Multi-service flow tests

Examples:
  bun run test:blackbox                         # All suites
  bun run test:blackbox schema-check            # Schema only
  bun run test:blackbox pwa functions           # PWA + Functions
  bun run test:blackbox --no-cross-service      # Skip cross-service
  `);
  process.exit(0);
}

async function main() {
  const overallStart = Date.now();

  // ── 1. Load suites ────────────────────────────────────────
  type SuiteRef = { name: string; path: string; key: string };
  const suiteRefs: SuiteRef[] = [
    { name: 'schema-check', path: './suites/schema_check.ts', key: 'schemaCheckSuite' },
    { name: 'functions', path: './suites/functions.api.ts', key: 'functionsSuite' },
    { name: 'pwa', path: './suites/pwa.e2e.ts', key: 'pwaSuite' },
  ];
  if (!noCrossService) {
    // cross-service suite can be added later
  }

  const suites: TestSuites = [];
  for (const ref of suiteRefs) {
    if (suiteFilterSet.size > 0 && !suiteFilterSet.has(ref.name)) continue;
    try {
      const mod = await import(ref.path);
      if (mod[ref.key]) suites.push(mod[ref.key]);
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

  // ── 2. Start services in parallel ────────────────────────
  const needsEmulator = suites.some((s) => s.category === 'service' || s.category === 'cross-service');
  const needsPwa = suites.some((s) => s.name === 'pwa');

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

  // ── 4. Run suites ─────────────────────────────────────────
  const results: SuiteResult[] = await runSuites(suites, { noCrossService });

  // ── 5. Cleanup ────────────────────────────────────────────
  await stopAllDevServers().catch(() => {});
  await stopEmulators().catch(() => {});

  // ── 6. Report ─────────────────────────────────────────────
  const dur = Date.now() - overallStart;
  printTerminalReport(results, dur);
  writeJsonReport(results, dur);

  process.exit(results.filter((r) => r.status === 'fail').length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Unhandled:', e);
  stopAllDevServers().catch(() => {});
  stopEmulators().catch(() => {});
  process.exit(1);
});
