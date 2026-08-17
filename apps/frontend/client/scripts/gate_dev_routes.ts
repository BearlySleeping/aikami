// apps/frontend/client/scripts/gate_dev_routes.ts
//
// C-418 Feature B: builds the filtered routes directory used by production
// builds. Copies `src/routes` → `.svelte-kit/routes-prod`, excluding the
// `(dev)` route group, so SvelteKit never sees a `(dev)` route when
// svelte.config.js points `files.routes` at the filtered copy.
//
// The copy is unconditional and always fresh: the build task that runs this
// script also chooses which routes dir SvelteKit reads (see svelte.config.js
// `includeDevRoutes`), so a stale `.svelte-kit/routes-prod` can never leak
// into a dev build or a stale dev route into a production build.
//
// Usage: `bun scripts/gate_dev_routes.ts` (run before `vite build`).

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const projectDirectory = new URL('..', import.meta.url).pathname;
const sourceRoutes = join(projectDirectory, 'src', 'routes');
const outputRoutes = join(projectDirectory, '.svelte-kit', 'routes-prod');
const excludedDir = '(dev)';

// Accept an explicit `--mode <mode>` (mirrors `vite build --mode <mode>`)
// because this script runs before Vite sets AIKAMI_BUILD_MODE itself. A bare
// `vite build` defaults to production, so this script does too.
const modeArgIndex = process.argv.indexOf('--mode');
const cliMode =
  modeArgIndex !== -1
    ? process.argv[modeArgIndex + 1]
    : process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);

const buildMode = cliMode || process.env.AIKAMI_BUILD_MODE || 'production';
const devGateOverride = process.env.AIKAMI_INCLUDE_DEV_ROUTES;
const isProductionBuild = buildMode === 'production' || process.env.NODE_ENV === 'production';
const includeDevRoutes =
  devGateOverride === 'true' ? true : devGateOverride === 'false' ? false : !isProductionBuild;

// Remove any previous filtered copy so the build can never read stale files.
rmSync(outputRoutes, { recursive: true, force: true });

if (includeDevRoutes) {
  console.log('[gate-dev-routes] dev routes INCLUDED — no filtered copy needed');
  process.exit(0);
}

if (!existsSync(sourceRoutes)) {
  console.error(`[gate-dev-routes] source routes not found: ${sourceRoutes}`);
  process.exit(1);
}

mkdirSync(outputRoutes, { recursive: true });

/** Recursively copies directory entries, skipping the `(dev)` group. */
const copyEntries = (from: string, to: string): void => {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === excludedDir) {
      console.log(`[gate-dev-routes] excluding (dev) route group: ${join(from, entry.name)}`);
      continue;
    }
    const fromPath = join(from, entry.name);
    const toPath = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(toPath, { recursive: true });
      copyEntries(fromPath, toPath);
    } else {
      cpSync(fromPath, toPath);
    }
  }
};

copyEntries(sourceRoutes, outputRoutes);
console.log(`[gate-dev-routes] wrote filtered routes to ${outputRoutes}`);
