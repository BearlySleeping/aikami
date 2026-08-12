// apps/frontend/hub/src/lib/constants/routes.test.ts
//
// Regression guard for C-385 AC-4: the personas route was deleted, so the
// hub route table must not register it and `/dashboard` remains the
// authenticated landing route. Also keeps `hub:test` a green task now that
// the only pre-existing hub unit tests (persona feature) were deleted with
// the feature.
//
// The `@aikami/frontend/services` barrel is mocked because importing it
// executes Svelte-rune modules (e.g. dialog.svelte.ts) that require the
// client test preload, which the hub test runner does not provide.

import { describe, expect, mock, test } from 'bun:test';

mock.module('@aikami/frontend/services', () => ({
  toNavigateToAppHref: () => '/',
  toRouteHref: () => '/',
  toRoutePathFromRouteId: () => '/',
  toRoutePathFromURL: () => '/',
}));

const { routes } = await import('./routes.ts');

describe('hub routes — C-385 personas removal', () => {
  test('dashboard is registered as an authenticated route', () => {
    expect(routes.dashboard.getPath()).toBe('/dashboard');
    expect(routes.dashboard.routeId).toBe('/(authenticated)/dashboard');
  });

  test('the deleted personas route is not registered', () => {
    expect('personas' in routes).toBe(false);
  });

  test('no registered route resolves to /personas', () => {
    const paths = Object.values(routes).map((route) => route.getPath());
    expect(paths).not.toContain('/personas');
  });
});
