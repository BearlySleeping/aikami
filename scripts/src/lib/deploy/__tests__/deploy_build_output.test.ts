// scripts/src/lib/deploy/__tests__/deploy_build_output.test.ts
//
// Focused tests for two deploy-path invariants that only fail together:
//
//   1. `cleanBuildOutput` — the adapter output directory must start empty.
//      moon hydrates a cached task's `outputs` by copying the archived tree in
//      without removing files that are not in it, so a cache hit overlays this
//      build onto the previous one. A dev-route build followed by a cached
//      production build leaves `build/dev/` behind, which then fails the
//      deploy-asset guard on a build that correctly excluded the sandboxes.
//
//   2. `runDeployAssetGuard` — the guard must be told when the `(dev)` output
//      is expected. Otherwise a deliberate dev-route deploy is rejected by its
//      own last gate, after the build already passed the identical check.
//
// Both are exercised against real fixture trees rather than mocks, because the
// failures they guard against are filesystem- and argv-shaped.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_ROUTES_BUILD_MARKER_FILE } from '@aikami/constants';
import { cleanBuildOutput } from '../build_output';
import { type DeployAssetGuardOptions, runDeployAssetGuard } from '../cloudflare';
import type { AppConfig } from '../deployment_config';

const temporaryDirectories: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-deploy-output-'));
  temporaryDirectories.push(root);
  return root;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.AIKAMI_INCLUDE_DEV_ROUTES;
});

describe('cleanBuildOutput', () => {
  test('removes a Cloudflare app build output directory', () => {
    const root = temporaryRoot();
    const buildDir = join(root, 'apps/frontend/client/build');
    mkdirSync(join(buildDir, '_app/immutable/entry'), { recursive: true });
    writeFileSync(join(buildDir, '_app/immutable/entry/app.stale.js'), 'stale');
    mkdirSync(join(buildDir, 'dev/tauri-test'), { recursive: true });

    expect(cleanBuildOutput('client', root)).toBe(true);
    expect(existsSync(buildDir)).toBe(false);
  });

  test('is a no-op when there is nothing to remove', () => {
    const root = temporaryRoot();
    expect(cleanBuildOutput('client', root)).toBe(false);
  });

  test('leaves non-Cloudflare apps alone', () => {
    // Docker/Tauri service types have no `cloudflare.buildOutputDir`, and their
    // layout is not ours to assume — guessing could delete something we did not
    // produce.
    const root = temporaryRoot();
    expect(cleanBuildOutput('voice', root)).toBe(false);
    expect(cleanBuildOutput('not-an-app', root)).toBe(false);
  });
});

describe('runDeployAssetGuard', () => {
  /**
   * Builds a fixture app whose guard script records the argv it was called with,
   * so the test asserts the real command line rather than a mocked one.
   *
   * The default mode is `production` because that is the case where being wrong
   * is expensive — a production deploy must not ship the sandboxes.
   */
  const guardFixture = (
    mode = 'production',
  ): { argvPath: string; options: DeployAssetGuardOptions } => {
    const appRoot = temporaryRoot();
    const argvPath = join(appRoot, 'argv.txt');
    mkdirSync(join(appRoot, 'scripts'), { recursive: true });
    writeFileSync(
      join(appRoot, 'scripts/check_deploy_assets.ts'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.GUARD_ARGV_OUT as string, process.argv.slice(2).join(' '));",
      ].join('\n'),
    );
    process.env.GUARD_ARGV_OUT = argvPath;
    const config = { cloudflare: { buildOutputDir: 'build' } } as unknown as AppConfig;
    return { argvPath, options: { config, appRoot, mode } };
  };

  test('passes --allow-dev-routes when the opt-in is set', () => {
    const { argvPath, options } = guardFixture();
    process.env.AIKAMI_INCLUDE_DEV_ROUTES = 'true';

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).toContain('--allow-dev-routes');
  });

  // 🔴 TEMPORARY: staging defaults to shipping the `(dev)` sandboxes with no
  // configuration. Un-merge with the production case below when the escape hatch
  // is reverted — see apps/frontend/client/scripts/dev_routes_gate.ts.
  test('defaults to shipping dev routes on staging when the env is unset', () => {
    const { argvPath, options } = guardFixture('staging');

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).toContain('--allow-dev-routes');
  });

  test('does not pass --allow-dev-routes for a production deploy when the env is unset', () => {
    const { argvPath, options } = guardFixture();

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).not.toContain('--allow-dev-routes');
  });

  test('treats an explicit false as an ordinary deploy', () => {
    const { argvPath, options } = guardFixture('staging');
    process.env.AIKAMI_INCLUDE_DEV_ROUTES = 'false';

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).not.toContain('--allow-dev-routes');
  });

  test('returns false when the app has no guard script', () => {
    const appRoot = temporaryRoot();
    const config = { cloudflare: { buildOutputDir: 'build' } } as unknown as AppConfig;
    expect(runDeployAssetGuard({ config, appRoot, mode: 'production' })).toBe(false);
  });

  test("honors the build's own record when the env is not loaded", () => {
    // The real CI shape: the build read `.env.<mode>`, this process did not,
    // so `process.env` says nothing about the route graph that was produced.
    // The mode default must not override what the build actually recorded.
    const { argvPath, options } = guardFixture('production');
    mkdirSync(join(options.appRoot, 'build'), { recursive: true });
    writeFileSync(
      join(options.appRoot, 'build', DEV_ROUTES_BUILD_MARKER_FILE),
      JSON.stringify({ includeDevRoutes: true }),
    );

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).toContain('--allow-dev-routes');
  });

  test('an explicit false record overrides a stale opt-in env on staging', () => {
    const { argvPath, options } = guardFixture('staging');
    mkdirSync(join(options.appRoot, 'build'), { recursive: true });
    writeFileSync(
      join(options.appRoot, 'build', DEV_ROUTES_BUILD_MARKER_FILE),
      JSON.stringify({ includeDevRoutes: false }),
    );
    process.env.AIKAMI_INCLUDE_DEV_ROUTES = 'true';

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).not.toContain('--allow-dev-routes');
  });

  test('an unreadable record falls back to the env rather than guessing', () => {
    const { argvPath, options } = guardFixture('production');
    mkdirSync(join(options.appRoot, 'build'), { recursive: true });
    writeFileSync(join(options.appRoot, 'build', DEV_ROUTES_BUILD_MARKER_FILE), 'not json');
    process.env.AIKAMI_INCLUDE_DEV_ROUTES = 'true';

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).toContain('--allow-dev-routes');
  });

  test('an unreadable record on staging falls back to the mode, not to a guess', () => {
    // The mode default is only consulted when the record is missing/unreadable,
    // so a staging deploy with a corrupt record relaxes the guard (matching the
    // build it is guarding) instead of failing on a build that did include them.
    const { argvPath, options } = guardFixture('staging');
    mkdirSync(join(options.appRoot, 'build'), { recursive: true });
    writeFileSync(join(options.appRoot, 'build', DEV_ROUTES_BUILD_MARKER_FILE), 'not json');

    expect(runDeployAssetGuard(options)).toBe(true);
    expect(readFileSync(argvPath, 'utf-8')).toContain('--allow-dev-routes');
  });
});
