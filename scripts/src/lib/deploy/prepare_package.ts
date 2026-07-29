// scripts/src/lib/deploy/prepare_package.ts
/**
 * Generate a minimal package.json for Cloud Run containers.
 *
 * The SvelteKit build externalizes server-only packages (firebase-admin, etc.).
 * Workspace packages are bundled by Vite, so they don't need to be installed
 * at runtime. This script strips workspace deps and devDependencies, leaving
 * only the runtime npm packages that the container needs to install.
 */

import { parseCliArgs } from '../cli_utils';

export type PreparePackageOptions = {
  appName: string;
  buildDir: string;
  appPath?: string;
};

/** Packages bundled by Vite that don't need container install. */
const BUNDLED_PACKAGES = new Set([
  'firebase', // Client SDK — bundled into client chunks
  'eruda', // Browser devtools — bundled, server import is dev-only
]);

/**
 * Generates a minimal package.json for a Cloud Run container.
 */
export async function prepareCloudRunPackage(options: PreparePackageOptions): Promise<void> {
  const appPath = options.appPath ?? `apps/frontend/${options.appName}`;
  const appPkgPath = `${appPath}/package.json`;
  const appPkgFile = Bun.file(appPkgPath);

  if (!(await appPkgFile.exists())) {
    throw new Error(`Package.json not found: ${appPkgPath}`);
  }

  const appPkg = (await appPkgFile.json()) as {
    name?: string;
    type?: string;
    dependencies?: Record<string, string>;
  };

  const runtimeDeps: Record<string, string> = {};
  for (const [name, version] of Object.entries(appPkg.dependencies ?? {})) {
    if (typeof version !== 'string') {
      continue;
    }
    if (version.startsWith('workspace:')) {
      continue;
    }
    if (BUNDLED_PACKAGES.has(name)) {
      continue;
    }
    runtimeDeps[name] = version;
  }

  const minimalPkg = {
    name: appPkg.name ?? `@aikami/${options.appName}`,
    type: appPkg.type ?? 'module',
    dependencies: runtimeDeps,
  };

  await Bun.write(`${options.buildDir}/package.json`, `${JSON.stringify(minimalPkg, null, 2)}\n`);
  console.log(`✓ Generated minimal package.json for ${options.appName}`);
}

// CLI entry point
if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    app: { type: 'string' },
    'build-dir': { type: 'string' },
  });
  const appName = opts.app as string;
  const buildDir = opts['build-dir'] as string;

  if (!appName || !buildDir) {
    console.error('Usage: --app=<name> --build-dir=<path>');
    process.exit(1);
  }

  await prepareCloudRunPackage({ appName, buildDir });
}
