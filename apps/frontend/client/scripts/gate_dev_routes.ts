// apps/frontend/client/scripts/gate_dev_routes.ts
//
// C-418 Feature B: builds the filtered routes directory used by production
// builds. Copies `src/routes` → `.svelte-kit/routes-prod`, excluding the
// `(dev)` route group, so SvelteKit never sees a `(dev)` route when
// svelte.config.js points `files.routes` at the filtered copy (guarded: a
// bare `vite build` without this script fails fast with a clear error — M3).
//
// After materializing, the sveltekit plugin regenerates `.svelte-kit/generated`
// against the current `files.routes` on its own — SvelteKit detects the
// routes-dir change (verified across prod→emulator→prod builds). No explicit
// `svelte-kit sync` here: running one with a stale env could regenerate for
// the wrong routes dir in the `bun run build --mode <mode>` passthrough case.
//
// Usage: `bun scripts/gate_dev_routes.ts [--mode <mode>]` (run before
// `vite build`). `--mode` mirrors the vite build mode so the exclusion
// decision here matches svelte.config.js exactly.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { logger } from '@aikami/logger';

// `new URL(...).pathname` keeps the URL form of the path, which on Windows is
// a leading-slash drive path (`/C:/...`) that fs rejects. fileURLToPath is the
// only correct file-URL → path conversion (matches svelte.config.js).
const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const sourceRoutes = join(projectDirectory, 'src', 'routes');
const outputRoutes = join(projectDirectory, '.svelte-kit', 'routes-prod');
const excludedDir = '(dev)';

// Accept an explicit `--mode <mode>` (mirrors `vite build --mode <mode>`).
// A bare `vite build` defaults to production, so this script does too.
const modeArgIndex = process.argv.indexOf('--mode');
const cliMode =
  modeArgIndex !== -1
    ? process.argv[modeArgIndex + 1]
    : process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);

const buildMode = cliMode || process.env.AIKAMI_BUILD_MODE || 'production';
const devGateOverride = process.env.AIKAMI_INCLUDE_DEV_ROUTES;
const isProductionBuild = buildMode === 'production';
let includeDevRoutes: boolean;
if (devGateOverride === 'true') {
  includeDevRoutes = true;
} else if (devGateOverride === 'false') {
  includeDevRoutes = false;
} else {
  includeDevRoutes = !isProductionBuild;
}

// Keep svelte.config.js and this script on the same decision.
process.env.AIKAMI_BUILD_MODE = buildMode;

// Remove any previous filtered copy so the build can never read stale files.
rmSync(outputRoutes, { recursive: true, force: true });

if (includeDevRoutes) {
  logger.info('[gate-dev-routes] dev routes INCLUDED — no filtered copy needed');
} else {
  if (!existsSync(sourceRoutes)) {
    logger.error(`[gate-dev-routes] source routes not found: ${sourceRoutes}`);
    process.exit(1);
  }

  mkdirSync(outputRoutes, { recursive: true });

  /** Recursively copies directory entries, skipping the `(dev)` group. */
  const copyEntries = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === excludedDir) {
        logger.info(`[gate-dev-routes] excluding (dev) route group: ${join(from, entry.name)}`);
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
  logger.info(`[gate-dev-routes] wrote filtered routes to ${outputRoutes}`);
}
