// scripts/src/lib/ops/emberwatch_studio.ts
//
// One local entry point for the Emberwatch authoring loop:
//
//   validate authored tile table → build atlases and maps → validate maps → scan
//   assets → build/update the boot seed → check the candidate plane → serve the
//   local candidate origin → launch the client → print the URL and the debug
//   toggles.
//
// It performs NO network write and NO model generation. Everything it serves is
// local; assets it does not override are proxied read-only by
// `local_asset_origin.ts`.
//
// Run:
//   bun run emberwatch:studio
//   bun run emberwatch:studio --watch
//   bun run emberwatch:studio --no-client --no-serve
//
// Flags: --port <n> · --watch · --skip-build · --no-serve · --no-client

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBERWATCH_BUILD_STEPS } from './emberwatch_build_steps.ts';
import {
  findPublishedSeedPath,
  missingCandidateOverrides,
  readPublishedSeedHashes,
} from './emberwatch_candidate_plane.ts';
import { validateEmberwatchMaps } from './emberwatch_map_validation.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const ops = join(here);
const packRoot = join(repository, 'content/packs/emberwatch');
const snapshotRoot = join(repository, '.local/catalog/production/snapshots');

const DEFAULT_PORT = 8788;

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);

/** Resolves a valid TCP port, falling back for missing or malformed flags. */
export const parseStudioPort = (arguments_: readonly string[]): number => {
  const index = arguments_.indexOf('--port');
  if (index < 0) {
    return DEFAULT_PORT;
  }
  const candidate = Number(arguments_[index + 1]);
  return Number.isFinite(candidate) &&
    Number.isInteger(candidate) &&
    candidate >= 1 &&
    candidate <= 65_535
    ? candidate
    : DEFAULT_PORT;
};

/**
 * Exact `--port` behavior:
 *   `--port 4321`  → 4321
 *   `--port`       (missing value) → `NaN` → DEFAULT_PORT (8788)
 *   `--port NaN`   → DEFAULT_PORT
 *   `--port 0`     → out of range → DEFAULT_PORT
 *   `--port -1`    → out of range → DEFAULT_PORT
 *   `--port 65536` → out of range → DEFAULT_PORT
 *   `--port 12.5`  → not an integer → DEFAULT_PORT
 *   no `--port`    → DEFAULT_PORT
 * The fallback is the documented local-origin port, so an invalid flag never
 * launches a service on port 0/NaN.
 */

export type StudioLaunchPlan = {
  /** True when Studio should spawn the local candidate origin. */
  startOrigin: boolean;
  /** True when Studio should spawn the client dev server. */
  startClient: boolean;
  /** The port the local origin (and the client's asset base URL) use. */
  originPort: number;
  /** Environment for the client process. */
  clientEnv: Record<string, string | undefined>;
  /** True when `PUBLIC_ASSETS_BASE_URL` was pointed at the local origin. */
  overrideAssetOrigin: boolean;
};

/**
 * Pure launch planning: decides which services to start and whether to point
 * the client at the local origin. `PUBLIC_ASSETS_BASE_URL` is only overridden
 * when Studio will actually start the local origin; otherwise the caller's
 * configured/external asset origin is preserved.
 */
export const planStudioLaunch = (options: {
  args: readonly string[];
  snapshotExists: boolean;
  env: Readonly<Record<string, string | undefined>>;
}): StudioLaunchPlan => {
  const noServe = options.args.includes('--no-serve');
  const noClient = options.args.includes('--no-client');
  const originPort = parseStudioPort(options.args);
  const startOrigin = !noServe && options.snapshotExists;
  const startClient = !noClient;
  const clientEnv: Record<string, string | undefined> = { ...options.env };
  if (startOrigin) {
    clientEnv.PUBLIC_ASSETS_BASE_URL = `http://localhost:${originPort}`;
  }
  return {
    startOrigin,
    startClient,
    originPort,
    clientEnv,
    overrideAssetOrigin: startOrigin,
  };
};

const port = parseStudioPort(args);

/**
 * Runs a repository-relative script with `bun`. `EMBERWATCH_BUILD_STEPS` stores
 * repo-relative paths (they are shared with the release build), so the path is
 * joined against the repository root — not `ops/`.
 */
const run = (script: string, extra: string[] = []): void => {
  console.log(`\n▶ bun ${script} ${extra.join(' ')}`.trimEnd());
  execFileSync('bun', [join(repository, script), ...extra], { cwd: repository, stdio: 'inherit' });
};

/**
 * The authored sources the watch loop rebuilds from.
 *
 * The generated `content/packs/emberwatch/maps/` directory is deliberately NOT
 * watched: `generate_emberwatch_maps.ts` rewrites those files on every rebuild,
 * so watching them makes each rebuild trigger the next one (an endless rebuild
 * storm). Authored map changes happen in the TypeScript builders below, which
 * are watched.
 */
const WATCH_TARGETS = [
  join(packRoot, 'props'),
  join(ops, 'emberwatch_authoring.ts'),
  join(ops, 'emberwatch_map_village.ts'),
  join(ops, 'emberwatch_map_retained.ts'),
  join(ops, 'emberwatch_map_shared.ts'),
  join(ops, 'generate_emberwatch_maps.ts'),
  join(ops, 'generate_emberwatch_maps_extra.ts'),
  join(ops, 'generate_emberwatch_tables.ts'),
];

const validateInputs = (): void => {
  const validation = validateEmberwatchMaps();
  const warnings = validation.findings.length - validation.blockers.length;
  if (validation.blockers.length > 0) {
    console.error(
      `\n❌ semantic map validation failed — ${validation.blockers.length} blocker(s):`,
    );
    for (const blocker of validation.blockers) {
      console.error(`   [${blocker.rule}] ${blocker.map}/${blocker.subject} — ${blocker.detail}`);
    }
    throw new Error(`semantic map validation failed with ${validation.blockers.length} blocker(s)`);
  }
  console.log(`✅ semantic map validation passed — ${warnings} warning(s), 0 blocker(s)`);
};

const pipe = (): void => {
  // C-548: the studio must produce the SAME local plane the release build
  // produces, so it runs the shared step list rather than a hand-maintained
  // subset. A fresh worktree previously failed its first build because the
  // terrain atlas / portraits / audio were never generated here.
  buildG();
  for (const step of EMBERWATCH_BUILD_STEPS) {
    run(step.script, [...(step.args ?? [])]);
  }
  // Re-validate AFTER regeneration so the report reflects the built maps.
  validateInputs();

  const seedPath = findPublishedSeedPath(repository);
  const missing = missingCandidateOverrides(
    repository,
    seedPath ? readPublishedSeedHashes(seedPath) : undefined,
  );
  if (missing.length > 0) {
    console.error(
      `\n❌ candidate plane incomplete — stale published rows for:\n   ${missing.join('\n   ')}`,
    );
    throw new Error(`candidate plane is missing ${missing.length} override(s)`);
  }
  console.log(`✅ candidate plane complete`);
};

const launch = (): void => {
  const plan = planStudioLaunch({
    args,
    snapshotExists: existsSync(snapshotRoot),
    env: process.env,
  });
  const services: Array<{ name: string; child: ReturnType<typeof Bun.spawn> }> = [];

  if (!has('--no-serve') && !plan.startOrigin) {
    console.warn(
      `⚠ no catalog snapshot at ${snapshotRoot} — skipping the local origin.\n` +
        '  Run a catalog snapshot first, or start the client against another origin.',
    );
  }
  if (plan.startOrigin) {
    console.log(`\n▶ local candidate origin on http://localhost:${plan.originPort}`);
    services.push({
      name: 'local candidate origin',
      child: Bun.spawn(
        ['bun', join(ops, 'local_asset_origin.ts'), '--port', String(plan.originPort)],
        {
          cwd: repository,
          stdio: ['inherit', 'inherit', 'inherit'],
        },
      ),
    });
  }

  if (plan.startClient) {
    console.log('\n▶ client dev server (vite --mode emulator)');
    services.push({
      name: 'client dev server',
      child: Bun.spawn(['bun', 'run', 'dev'], {
        cwd: join(repository, 'apps/frontend/client'),
        stdio: ['inherit', 'inherit', 'inherit'],
        env: plan.clientEnv,
      }),
    });
  }

  let stopping = false;
  const stop = async (options: {
    exitCode: number;
    exitedChild?: ReturnType<typeof Bun.spawn>;
  }): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    const siblings = services.filter((service) => service.child !== options.exitedChild);
    for (const service of siblings) {
      service.child.kill();
    }
    await Promise.allSettled(siblings.map((service) => service.child.exited));
    process.exit(options.exitCode);
  };
  for (const service of services) {
    void service.child.exited.then((exitCode) => {
      if (stopping) {
        return;
      }
      if (exitCode !== 0) {
        console.error(`✗ ${service.name} exited with status ${exitCode}`);
      } else {
        console.error(`✗ ${service.name} exited unexpectedly`);
      }
      void stop({ exitCode: exitCode === 0 ? 1 : exitCode, exitedChild: service.child });
    });
  }
  process.on('SIGINT', () => void stop({ exitCode: 0 }));
  process.on('SIGTERM', () => void stop({ exitCode: 0 }));
};

const startWatch = (): void => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      console.log('\n↻ change detected — rebuilding');
      try {
        pipe();
      } catch (error) {
        console.error('✗ rebuild failed:', error instanceof Error ? error.message : String(error));
      }
    }, 300);
  };
  for (const target of WATCH_TARGETS) {
    if (existsSync(target)) {
      watch(target, { recursive: statSync(target).isDirectory() }, rebuild);
    }
  }
  console.log('\n👀 watching authored sources for changes (Ctrl-C to stop)');
};

const banner = (): void => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Emberwatch Studio — local authoring + verification');
  console.log('  Client:  http://localhost:5173   (vite --mode emulator)');
  console.log(`  Origin:  http://localhost:${port}`);
  console.log('');
  console.log('  Debug overlays (development only, never the production HUD):');
  console.log('    ?e2e=true                     walkability grid');
  console.log('    ?authoring=true               authoring overlay');
  console.log('    ?authoring=true&authoringLayers=grid,collision,transitions,props,npcs,ids');
  console.log('');
  console.log('  Checks:  bun run emberwatch:validate · emberwatch:audit');
  console.log('           emberwatch:visual-report · emberwatch:visual-audit');
  console.log('           emberwatch:locked-ids · emberwatch:legacy-props');
  console.log('══════════════════════════════════════════════════════════════\n');
};

const main = (): void => {
  banner();
  if (!has('--skip-build')) {
    try {
      pipe();
    } catch (error) {
      console.error(
        '✗ initial Studio build failed:',
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  }
  launch();
  if (has('--watch')) {
    startWatch();
  } else if (has('--no-client') && has('--no-serve')) {
    console.log('✅ checks complete (nothing launched)');
  }
};

if (import.meta.main) {
  main();
}
