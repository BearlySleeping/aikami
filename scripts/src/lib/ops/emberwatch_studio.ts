// scripts/src/lib/ops/emberwatch_studio.ts
//
// One local entry point for the Emberwatch authoring loop:
//
//   validate → regenerate maps → regenerate prop atlas (when stale) → scan
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
// Flags: --port <n> · --watch · --skip-build · --no-serve · --no-client · --update-seed

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingCandidateOverrides } from './emberwatch_candidate_plane.ts';
import { validateEmberwatchMaps } from './emberwatch_map_validation.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const ops = join(here);
const packRoot = join(repository, 'content/packs/emberwatch');
const gameData = join(repository, 'apps/frontend/client/static/game-data');
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

const port = parseStudioPort(args);

const run = (script: string, extra: string[] = []): void => {
  console.log(`\n▶ bun ${script} ${extra.join(' ')}`.trimEnd());
  execFileSync('bun', [join(ops, script), ...extra], { cwd: repository, stdio: 'inherit' });
};

/** The authored sources the watch loop rebuilds from. */
const WATCH_TARGETS = [
  join(packRoot, 'props'),
  join(packRoot, 'maps'),
  join(ops, 'emberwatch_authoring.ts'),
  join(ops, 'emberwatch_map_village.ts'),
  join(ops, 'emberwatch_map_retained.ts'),
  join(ops, 'emberwatch_map_shared.ts'),
  join(ops, 'generate_emberwatch_maps.ts'),
  join(ops, 'generate_emberwatch_maps_extra.ts'),
  join(ops, 'generate_emberwatch_tables.ts'),
];

const newestMtime = (path: string): number => {
  if (!existsSync(path)) {
    return 0;
  }
  if (statSync(path).isFile()) {
    return statSync(path).mtimeMs;
  }
  return readdirSync(path).reduce(
    (newest, name) => Math.max(newest, newestMtime(join(path, name))),
    0,
  );
};

/** Regenerates the prop atlas only when its sources are newer than the output. */
const propAtlasIsStale = (): boolean =>
  newestMtime(join(packRoot, 'props')) >
  newestMtime(join(gameData, 'sprites/tilesets/props.pages.json'));

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
  validateInputs();
  run('generate_emberwatch_maps.ts');
  if (propAtlasIsStale() || has('--force-props')) {
    run('generate_emberwatch_props_atlas.ts');
  } else {
    console.log('• prop atlas is up to date');
  }
  run('scan_assets.ts');
  if (has('--update-seed') || !existsSync(join(gameData, 'asset_seed.json'))) {
    run('generate_asset_seed.ts', ['--write']);
  } else {
    console.log('• boot seed is present');
  }
  // Re-validate AFTER regeneration so the report reflects the built maps.
  validateInputs();

  const missing = missingCandidateOverrides(repository);
  if (missing.length > 0) {
    console.error(
      `\n❌ candidate plane incomplete — stale published rows for:\n   ${missing.join('\n   ')}`,
    );
    throw new Error(`candidate plane is missing ${missing.length} override(s)`);
  }
  console.log(`✅ candidate plane complete`);
};

const launch = (): void => {
  const services: Array<{ name: string; child: ReturnType<typeof Bun.spawn> }> = [];
  const originReady = existsSync(snapshotRoot);
  let localOriginStarted = false;

  if (!has('--no-serve')) {
    if (!originReady) {
      console.warn(
        `⚠ no catalog snapshot at ${snapshotRoot} — skipping the local origin.\n` +
          '  Run a catalog snapshot first, or start the client against another origin.',
      );
    } else {
      console.log(`\n▶ local candidate origin on http://localhost:${port}`);
      services.push({
        name: 'local candidate origin',
        child: Bun.spawn(['bun', join(ops, 'local_asset_origin.ts'), '--port', String(port)], {
          cwd: repository,
          stdio: ['inherit', 'inherit', 'inherit'],
        }),
      });
      localOriginStarted = true;
    }
  }

  if (!has('--no-client')) {
    console.log('\n▶ client dev server (vite --mode emulator)');
    const env = { ...process.env };
    if (localOriginStarted) {
      env.PUBLIC_ASSETS_BASE_URL = `http://localhost:${port}`;
    }
    services.push({
      name: 'client dev server',
      child: Bun.spawn(['bun', 'run', 'dev'], {
        cwd: join(repository, 'apps/frontend/client'),
        stdio: ['inherit', 'inherit', 'inherit'],
        env,
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
