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
  DEV_ROUTES_ENV_VAR,
  resolveIncludeDevRoutes,
} from '../scripts/dev_routes_gate.ts';

describe('resolveIncludeDevRoutes', () => {
  test('excludes dev routes for a build when the flag is unset', () => {
    expect(resolveIncludeDevRoutes('build', {})).toBe(false);
  });

  test('includes dev routes for a dev server when the flag is unset', () => {
    expect(resolveIncludeDevRoutes('serve', {})).toBe(true);
  });

  test('the explicit true override wins on a build', () => {
    expect(resolveIncludeDevRoutes('build', { [DEV_ROUTES_ENV_VAR]: 'true' })).toBe(true);
  });

  test('the explicit false override wins on a dev server', () => {
    expect(resolveIncludeDevRoutes('serve', { [DEV_ROUTES_ENV_VAR]: 'false' })).toBe(false);
  });

  test('only the exact strings true/false count as an override', () => {
    for (const value of ['1', 'TRUE', 'yes', '']) {
      expect(resolveIncludeDevRoutes('build', { [DEV_ROUTES_ENV_VAR]: value })).toBe(false);
      expect(resolveIncludeDevRoutes('serve', { [DEV_ROUTES_ENV_VAR]: value })).toBe(true);
    }
  });

  test('the excluded route group is named (dev)', () => {
    expect(DEV_ROUTE_GROUP).toBe('(dev)');
  });
});
