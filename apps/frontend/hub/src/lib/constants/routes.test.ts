// apps/frontend/hub/src/lib/constants/routes.test.ts
//
// Regression guards for the hub route table:
//   - C-385 AC-4: the personas route was deleted, so the hub route table must
//     not register it and `/dashboard` remains the authenticated landing route.
//   - C-396 AC-1: the hub's default is PUBLIC — `/` and `/catalog/**` render
//     for anonymous visitors; authentication is the exception. Every route
//     marked 'authenticated' must resolve under the `(authenticated)` group,
//     and every public route must resolve under `(public)` — the auth
//     inversion guard (C-396 Edge Cases).
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
    expect(routes.dashboard.type).toBe('authenticated');
  });

  test('the deleted personas route is not registered', () => {
    expect('personas' in routes).toBe(false);
  });

  test('no registered route resolves to /personas', () => {
    const paths = Object.values(routes).map((route) =>
      route.getPath({ category: 'lpc', tag: 'lpc:hat:magic:x:thrust' }),
    );
    expect(paths).not.toContain('/personas');
  });
});

describe('hub routes — C-396 public catalog', () => {
  test('the catalog landing is the root path, typed public', () => {
    expect(routes.catalog.getPath()).toBe('/');
    expect(routes.catalog.routeId).toBe('/(public)');
    expect(routes.catalog.type).toBe('public');
  });

  test('catalog category routes are typed public and resolve under (public)', () => {
    expect(routes.catalogCategory.getPath({ category: 'lpc' })).toBe('/catalog/lpc');
    expect(routes.catalogCategory.routeId).toBe('/(public)/catalog/[category]');
    expect(routes.catalogCategory.type).toBe('public');
  });

  test('catalog asset routes are typed public and resolve under (public)', () => {
    expect(routes.catalogAsset.getPath({ category: 'lpc', tag: 'lpc:hat:magic:x:thrust' })).toBe(
      '/catalog/lpc/lpc%3Ahat%3Amagic%3Ax%3Athrust',
    );
    expect(routes.catalogAsset.routeId).toBe('/(public)/catalog/[category]/[tag]');
    expect(routes.catalogAsset.type).toBe('public');
  });

  test('auth inversion guard: every authenticated route lives under (authenticated)', () => {
    for (const [name, route] of Object.entries(routes)) {
      if (route.type === 'authenticated') {
        expect(route.routeId, `route '${name}' must resolve under (authenticated)`).toMatch(
          /^\/\(authenticated\)\//,
        );
      }
    }
  });

  test('every public route resolves under the (public) route group — future public routes cannot bypass the invariant', () => {
    const publicRoutes = Object.entries(routes).filter(([, route]) => route.type === 'public');
    // The two catalog browse surfaces the contract guarantees for anonymous
    // visitors: the landing and a category page.
    expect(publicRoutes.length).toBeGreaterThanOrEqual(3);
    for (const [name, route] of publicRoutes) {
      expect(route.routeId, `public route '${name}' must resolve under (public)`).toMatch(
        /^\/\(public\)/,
      );
    }
  });
});
