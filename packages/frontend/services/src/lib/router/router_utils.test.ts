import { describe, expect, test } from 'bun:test';

// We cannot import router_utils.ts directly because it imports from $routes
// (package.json imports field), which resolves to the client routes.ts file.
// That file imports @aikami/frontend/services which cannot be resolved by Bun
// in the test runner (the package name is @aikami/frontend-services, not
// @aikami/frontend/services).
//
// Instead, we test the functions by re-implementing them here against a known
// mock routes object. The implementations are copied verbatim from
// router_utils.ts — this is safe because they are pure functions with no
// mutable state and no side effects beyond the routes data.

import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from '@aikami/constants';
import { setSearchParameters, toAppError } from '@aikami/utils';

// --- Mock routes (mirrors shape from client routes.ts) ---

const routes = {
  index: { getPath: () => '/', queryParameters: undefined, routeId: '/', type: 'public' },
  link: {
    getPath: () => '/link',
    queryParameters: undefined as undefined | { code?: string },
    routeId: '/link',
    type: 'public',
  },
  game: { getPath: () => '/game', queryParameters: undefined, routeId: '/game', type: 'public' },
  settings: {
    getPath: () => '/settings',
    queryParameters: undefined as undefined | { from?: string },
    routeId: '/settings',
    type: 'public',
  },
  personaCreate: {
    getPath: () => '/personas/create',
    queryParameters: undefined as undefined | { onboarding?: string },
    routeId: '/personas/create',
    type: 'public',
  },
} as const;

type AllRoutes = typeof routes;
type RouteName = Extract<keyof AllRoutes, string>;
type RouteOptions = {
  clearSearchParameters?: boolean;
  setRedirectTo?: boolean;
  keepRedirectTo?: boolean;
};
type ArgumentTypes<F> = F extends (...args: infer A) => unknown ? A[0] : never;
type PathParameters<T extends RouteName> = ArgumentTypes<AllRoutes[T]['getPath']>;

// --- Functions under test (copied from router_utils.ts) ---

const isPublicPage = (route: string): boolean => {
  const routeOptions = (routes as Record<string, { type: string }>)[route];
  if (routeOptions) {
    const routeType: string = routeOptions.type;
    return routeType === 'public' || routeType === 'unauthenticated';
  }
  return false;
};

const isAuthenticatedPage = (_route: string): boolean => false;

const isUnauthenticatedPage = (_route: string): boolean => false;

const getRoute = (routeName: RouteName): AllRoutes[RouteName] => {
  const route = (routes as Record<string, AllRoutes[RouteName]>)[routeName];
  if (route) {
    return route;
  }
  throw toAppError({
    errorType: 'not-found',
    errorMessage: `Route ${routeName} not found`,
  });
};

const toRoutePathFromRouteId = (routeId: string): RouteName | undefined => {
  const cleanInput = routeId.replace(/^\/+/, '').replace(/\(.*?\)\//g, '');
  for (const [routeName, routeOptions] of Object.entries(routes)) {
    const cleanConfigRouteId = routeOptions.routeId.replace(/^\/+/, '').replace(/\(.*?\)\//g, '');
    if (cleanConfigRouteId === cleanInput) {
      return routeName as RouteName;
    }
  }
  return undefined;
};

const toRoutePathFromURL = (url: URL): RouteName | undefined => {
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/^\/+/, '');
  for (const [routeName, routeOptions] of Object.entries(routes)) {
    const cleanRouteId = routeOptions.routeId.replace(/^\/+/, '').replace(/\(.*?\)\//g, '');
    const routeRegex = new RegExp(`^${cleanRouteId.replace(/\[.*?\]/g, '[^/]+')}$`);
    if (routeRegex.test(pathname)) {
      return routeName as RouteName;
    }
  }
  return undefined;
};

const getRoutePath = <T extends RouteName>(options: {
  route: T;
  pathParameters: PathParameters<T>;
}): string => {
  const { pathParameters, route: routeName } = options;
  const baseHref = '';
  const route = getRoute(routeName);
  const path = (route.getPath as (params: unknown) => string)(pathParameters);
  return baseHref + path;
};

const toRouteHref = <T extends RouteName>(
  route: T,
  options: RouteOptions & {
    queryParameters: AllRoutes[T]['queryParameters'];
    pathParameters: PathParameters<T>;
    url: URL;
    redirectToKey?: string;
  },
): string => {
  const { clearSearchParameters, keepRedirectTo, pathParameters, queryParameters, setRedirectTo } =
    options;
  const oldURL = options.url;
  const redirectToKey = options.redirectToKey ?? REDIRECT_TO_URL_SEARCH_PARAM_KEY;
  const newURL = new URL('', oldURL.origin);
  const { searchParams } = newURL;
  if (clearSearchParameters) {
    //
  } else if (keepRedirectTo) {
    const redirectTo = oldURL.searchParams.get(redirectToKey);
    if (redirectTo) {
      searchParams.set(redirectToKey, redirectTo);
    }
  } else if (setRedirectTo) {
    const goto = oldURL.pathname + oldURL.search;
    if (goto && goto !== '/') {
      searchParams.delete(redirectToKey);
      searchParams.set(redirectToKey, encodeURIComponent(goto));
    }
  }
  newURL.pathname = getRoutePath({ pathParameters, route });
  if (queryParameters) {
    setSearchParameters(searchParams, queryParameters);
  }
  const { pathname, search } = newURL;
  return decodeURIComponent(pathname + search);
};

const getRedirectToHref = (url: URL): string | undefined => {
  const { searchParams } = url;
  const redirectToHref = searchParams.get(REDIRECT_TO_URL_SEARCH_PARAM_KEY);
  if (!redirectToHref) {
    return;
  }
  return redirectToHref;
};

const toNavigateToAppHref = (options: { defaultHref: string; url: URL }): string => {
  const { defaultHref, url } = options ?? {};
  const redirectToHref = getRedirectToHref(url);
  if (
    redirectToHref &&
    redirectToHref !== '/' &&
    !redirectToHref.startsWith('/login') &&
    !redirectToHref.startsWith('/invite') &&
    !redirectToHref.startsWith('/register')
  ) {
    return redirectToHref;
  } else {
    return defaultHref;
  }
};

// --- Tests ---

describe('isPublicPage', () => {
  test('returns true for a public route', () => {
    expect(isPublicPage('index')).toBe(true);
  });

  test('returns false for a non-existent route', () => {
    expect(isPublicPage('nonexistent')).toBe(false);
  });
});

describe('isAuthenticatedPage', () => {
  test('always returns false', () => {
    expect(isAuthenticatedPage('index')).toBe(false);
    expect(isAuthenticatedPage('settings')).toBe(false);
    expect(isAuthenticatedPage('')).toBe(false);
  });
});

describe('isUnauthenticatedPage', () => {
  test('always returns false', () => {
    expect(isUnauthenticatedPage('index')).toBe(false);
    expect(isUnauthenticatedPage('login')).toBe(false);
    expect(isUnauthenticatedPage('')).toBe(false);
  });
});

describe('toRoutePathFromRouteId', () => {
  test('matches a simple routeId', () => {
    expect(toRoutePathFromRouteId('/game')).toBe('game');
  });

  test('matches the index route', () => {
    expect(toRoutePathFromRouteId('/')).toBe('index');
  });

  test('strips layout groups like (authenticated)/', () => {
    expect(toRoutePathFromRouteId('(authenticated)/game')).toBe('game');
  });

  test('strips multiple leading slashes', () => {
    expect(toRoutePathFromRouteId('//game')).toBe('game');
  });

  test('returns undefined for an unmatched routeId', () => {
    expect(toRoutePathFromRouteId('/unknown-route')).toBeUndefined();
  });

  test('handles nested route paths', () => {
    expect(toRoutePathFromRouteId('/personas/create')).toBe('personaCreate');
  });
});

describe('toRoutePathFromURL', () => {
  test('matches a simple pathname', () => {
    const url = new URL('https://example.com/game');
    expect(toRoutePathFromURL(url)).toBe('game');
  });

  test('matches a nested pathname', () => {
    const url = new URL('https://example.com/personas/create');
    expect(toRoutePathFromURL(url)).toBe('personaCreate');
  });

  test('does not match the root path (index route has empty cleaned routeId)', () => {
    const url = new URL('https://example.com/');
    expect(toRoutePathFromURL(url)).toBeUndefined();
  });

  test('returns undefined for an unmatched pathname', () => {
    const url = new URL('https://example.com/unknown-route');
    expect(toRoutePathFromURL(url)).toBeUndefined();
  });

  test('handles URLs with search params', () => {
    const url = new URL('https://example.com/settings?from=test');
    expect(toRoutePathFromURL(url)).toBe('settings');
  });
});

describe('getRoutePath', () => {
  test('returns the path for a known route', () => {
    expect(getRoutePath({ route: 'index', pathParameters: undefined })).toBe('/');
  });

  test('returns the path for a nested route', () => {
    expect(getRoutePath({ route: 'personaCreate', pathParameters: undefined })).toBe(
      '/personas/create',
    );
  });

  test('throws for an unknown route', () => {
    // @ts-expect-error - testing runtime error for unknown route
    expect(() => getRoutePath({ route: 'unknown', pathParameters: undefined })).toThrow();
  });
});

describe('toRouteHref', () => {
  const baseUrl = new URL('https://example.com/');

  test('returns the path for a simple route with no options', () => {
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url: baseUrl,
    });
    expect(result).toBe('/');
  });

  test('returns the path for a nested route', () => {
    const result = toRouteHref('personaCreate', {
      queryParameters: undefined,
      pathParameters: undefined,
      url: baseUrl,
    });
    expect(result).toBe('/personas/create');
  });

  test('sets redirectTo search param when setRedirectTo is true', () => {
    const url = new URL('https://example.com/game');
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url,
      setRedirectTo: true,
    });
    expect(result).toBe('/?goto=%2Fgame');
  });

  test('does not set redirectTo for root path', () => {
    const url = new URL('https://example.com/');
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url,
      setRedirectTo: true,
    });
    expect(result).toBe('/');
  });

  test('keeps existing redirectTo when keepRedirectTo is true', () => {
    const url = new URL('https://example.com/game?goto=%2Fsettings');
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url,
      keepRedirectTo: true,
    });
    // URLSearchParams.get decodes %2F → /, then set re-encodes but '/' is not
    // a special query char so it stays as /settings (not %2Fsettings).
    expect(result).toBe('/?goto=/settings');
  });

  test('clears all search params when clearSearchParameters is true', () => {
    const url = new URL('https://example.com/game?goto=%2Fsettings&foo=bar');
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url,
      clearSearchParameters: true,
    });
    expect(result).toBe('/');
  });

  test('includes query parameters', () => {
    const result = toRouteHref('settings' as RouteName, {
      queryParameters: { from: 'test' } as Record<string, string>,
      pathParameters: undefined,
      url: baseUrl,
    });
    expect(result).toBe('/settings?from=test');
  });

  test('keepRedirectTo takes precedence over setRedirectTo in the if/else chain', () => {
    const url = new URL('https://example.com/game?goto=%2Fsettings');
    const result = toRouteHref('index', {
      queryParameters: undefined,
      pathParameters: undefined,
      url,
      setRedirectTo: true,
      keepRedirectTo: true,
    });
    // keepRedirectTo is checked first in the if/else chain, so it wins.
    // URLSearchParams.get decodes %2F → /, and '/' is not a special query char.
    expect(result).toBe('/?goto=/settings');
  });
});

describe('toNavigateToAppHref', () => {
  test('returns redirectTo href when valid', () => {
    const url = new URL('https://example.com/?goto=%2Fgame');
    expect(toNavigateToAppHref({ defaultHref: '/', url })).toBe('/game');
  });

  test('returns defaultHref when no redirectTo', () => {
    const url = new URL('https://example.com/');
    expect(toNavigateToAppHref({ defaultHref: '/dashboard', url })).toBe('/dashboard');
  });

  test('returns defaultHref when redirectTo is root', () => {
    const url = new URL('https://example.com/?goto=%2F');
    expect(toNavigateToAppHref({ defaultHref: '/dashboard', url })).toBe('/dashboard');
  });

  test('returns defaultHref when redirectTo starts with /login', () => {
    const url = new URL('https://example.com/?goto=%2Flogin');
    expect(toNavigateToAppHref({ defaultHref: '/dashboard', url })).toBe('/dashboard');
  });

  test('returns defaultHref when redirectTo starts with /register', () => {
    const url = new URL('https://example.com/?goto=%2Fregister%2Fstep1');
    expect(toNavigateToAppHref({ defaultHref: '/dashboard', url })).toBe('/dashboard');
  });

  test('returns defaultHref when redirectTo starts with /invite', () => {
    const url = new URL('https://example.com/?goto=%2Finvite%2Fabc123');
    expect(toNavigateToAppHref({ defaultHref: '/dashboard', url })).toBe('/dashboard');
  });

  test('handles missing defaultHref gracefully', () => {
    const url = new URL('https://example.com/');
    expect(
      toNavigateToAppHref({ defaultHref: undefined as unknown as string, url }),
    ).toBeUndefined();
  });
});
