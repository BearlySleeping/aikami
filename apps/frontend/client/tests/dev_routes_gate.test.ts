// apps/frontend/client/tests/dev_routes_gate.test.ts
//
// Focused tests for the shared dev-route inclusion decision
// (scripts/dev_routes_gate.ts).
//
// The decision is load-bearing twice over: vite.config.ts uses it to pick
// `files.routes`, and scripts/gate_dev_routes.ts uses it to decide whether to
// materialize `.svelte-kit/routes-prod`. When the two disagreed, dev routes
// were bundled into distributable builds and the only symptom was a bundle-size
// regression — `check_deploy_assets.ts` cannot see the leak in an SPA build
// because no per-route HTML is emitted. These tests pin the rule so the two
// callers cannot drift apart again.

import { describe, expect, test } from 'bun:test';
import {
  DEV_ROUTE_GROUP,
  DEV_ROUTES_DEFAULT_INCLUDE_MODE,
  DEV_ROUTES_ENV_VAR,
  resolveIncludeDevRoutes,
} from '../scripts/dev_routes_gate.ts';

describe('resolveIncludeDevRoutes', () => {
  test('includes dev routes for a staging build when the flag is unset', () => {
    expect(resolveIncludeDevRoutes({ command: 'build', mode: 'staging', env: {} })).toBe(true);
  });

  test('excludes dev routes for a production build when the flag is unset', () => {
    expect(resolveIncludeDevRoutes({ command: 'build', mode: 'production', env: {} })).toBe(false);
  });

  test('includes dev routes for a dev server regardless of mode', () => {
    // The dev server runs from source, which is exactly when the sandboxes are
    // useful. Vite's dev mode is 'development', which is not a deploy mode.
    expect(resolveIncludeDevRoutes({ command: 'serve', mode: 'development', env: {} })).toBe(true);
    expect(resolveIncludeDevRoutes({ command: 'serve', mode: 'production', env: {} })).toBe(true);
  });

  // 🔴 TEMPORARY: staging is the one deployed mode that defaults to including
  // `(dev)`. Un-merge this with the production case above when the escape hatch
  // is reverted — see the header note in scripts/dev_routes_gate.ts.
  test('the staging exception is exactly staging', () => {
    expect(DEV_ROUTES_DEFAULT_INCLUDE_MODE).toBe('staging');
    // Every other build mode behaves like production.
    for (const mode of ['production', 'emulator', 'testing', 'analyze', 'development']) {
      expect(resolveIncludeDevRoutes({ command: 'build', mode, env: {} })).toBe(false);
    }
  });

  test('an unstated mode excludes, so a bare build behaves like production', () => {
    expect(resolveIncludeDevRoutes({ command: 'build', env: {} })).toBe(false);
    expect(resolveIncludeDevRoutes({ command: 'build', mode: undefined, env: {} })).toBe(false);
  });

  test('the explicit true override wins on a production build', () => {
    expect(
      resolveIncludeDevRoutes({
        command: 'build',
        mode: 'production',
        env: { [DEV_ROUTES_ENV_VAR]: 'true' },
      }),
    ).toBe(true);
  });

  test('the explicit false override wins on a staging build', () => {
    expect(
      resolveIncludeDevRoutes({
        command: 'build',
        mode: 'staging',
        env: { [DEV_ROUTES_ENV_VAR]: 'false' },
      }),
    ).toBe(false);
  });

  test('the explicit false override wins on a dev server', () => {
    expect(
      resolveIncludeDevRoutes({
        command: 'serve',
        mode: 'development',
        env: { [DEV_ROUTES_ENV_VAR]: 'false' },
      }),
    ).toBe(false);
  });

  test('only the exact strings true/false count as an override', () => {
    for (const value of ['1', 'TRUE', 'yes', '']) {
      const env = { [DEV_ROUTES_ENV_VAR]: value };
      // Falls through to the command/mode default.
      expect(resolveIncludeDevRoutes({ command: 'build', mode: 'staging', env })).toBe(true);
      expect(resolveIncludeDevRoutes({ command: 'build', mode: 'production', env })).toBe(false);
      expect(resolveIncludeDevRoutes({ command: 'serve', mode: 'development', env })).toBe(true);
    }
  });

  test('falls back to process.env when no env is injected', () => {
    const previous = process.env[DEV_ROUTES_ENV_VAR];
    process.env[DEV_ROUTES_ENV_VAR] = 'false';
    try {
      expect(resolveIncludeDevRoutes({ command: 'build', mode: 'staging' })).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[DEV_ROUTES_ENV_VAR];
      } else {
        process.env[DEV_ROUTES_ENV_VAR] = previous;
      }
    }
  });

  test('the excluded route group is named (dev)', () => {
    expect(DEV_ROUTE_GROUP).toBe('(dev)');
  });
});
