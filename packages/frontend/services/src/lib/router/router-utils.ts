// packages/frontend/services/src/lib/router/router-utils.ts
import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from '@aikami/constants';
import { setSearchParameters, toAppError } from '@aikami/utils';
import { routes, searchParametersToKeep } from '$routes';

export type AllRoutes = typeof routes;

export type RouteName = Extract<keyof AllRoutes, string>;

export type RouteOptions = {
  clearSearchParameters?: boolean;
  setRedirectTo?: boolean;
  keepRedirectTo?: boolean;
};

type ArgumentTypes<F> = F extends (...args: infer A) => unknown ? A[0] : never;

export type PathParameters<T extends RouteName> = ArgumentTypes<AllRoutes[T]['getPath']>;

// export type PathParameters<T extends RouteName> =
// 	AllRoutes[T]['getPath'] extends () => string
// 		? void
// 		: AllRoutes[T]['getPath'] extends (args: infer P) => string
// 		  ? P
// 		  : never;

export const isPublicPage = (route: string): boolean => {
  const routeOptions = routes[route as RouteName];
  if (routeOptions) {
    return routeOptions.type === 'public' || routeOptions.type === 'unauthenticated';
  }
  return false;
};
export const isAuthenticatedPage = (route: string): boolean => {
  const routeOptions = routes[route as RouteName];
  if (routeOptions) {
    return routeOptions.type === 'authenticated';
  }
  return false;
};
export const isUnauthenticatedPage = (route: string): boolean => {
  const routeOptions = routes[route as RouteName];
  if (routeOptions) {
    return routeOptions.type === 'unauthenticated';
  }
  return false;
};

const getRoute = (routeName: RouteName): AllRoutes[RouteName] => {
  const route = routes[routeName];
  if (route) {
    return route;
  }

  throw toAppError({
  errorType: 'not-found',
  errorMessage: `Route ${routeName} not found`
});
};

export const toRouteHref = <T extends RouteName>(
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
      // set and replace
      searchParams.delete(redirectToKey);
      searchParams.set(redirectToKey, encodeURIComponent(goto));
    }
  }

  newURL.pathname = getRoutePath({
    pathParameters,
    route: route,
  });

  if (!clearSearchParameters && searchParametersToKeep) {
    for (const searchParamsKey of searchParametersToKeep) {
      const value = oldURL.searchParams.get(searchParamsKey);
      if (value) {
        searchParams.set(searchParamsKey, value);
      }
    }
  }

  if (queryParameters) {
    setSearchParameters(searchParams, queryParameters);
  }

  const { pathname, search } = newURL;

  const href = pathname + search;
  // if (href.includes('%252F')) {
  // 	return href.replace('%252F', '/');
  // }
  return decodeURIComponent(href);

  // return href;
};

export const toRoutePathFromRouteId = (routeId: string): RouteName | undefined => {
  // 1. Clean the incoming SvelteKit routeId
  // Removes leading slashes AND any layout groups like "(authenticated)/"
  const cleanInput = routeId
    .replace(/^\/+/, '')
    .replace(/\(.*?\)\//g, '');

  for (const [routeName, routeOptions] of Object.entries(routes) as [
    string,
    AllRoutes[RouteName],
  ][]) {
    // 2. Clean the config routeId exactly the same way
    // This makes it safe even if your routes.ts has inconsistent routeIds
    const cleanConfigRouteId = routeOptions.routeId
      .replace(/^\/+/, '')
      .replace(/\(.*?\)\//g, '');

    // 3. Compare the cleaned strings (e.g., 'characters' === 'characters')
    if (cleanConfigRouteId === cleanInput) {
      return routeName as RouteName;
    }
  }

  return undefined;
};

export const toRoutePathFromURL = (url: URL): RouteName | undefined => {
  // https://github.com/sveltejs/kit/issues/6126
  // this.log('toRoutePathFromURL', { url });

  // Normalize the URL pathname (e.g., "/dashboard" -> "dashboard")
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/^\/+/, '');

  for (const [routeName, routeOptions] of Object.entries(routes) as [
    string,
    AllRoutes[RouteName],
  ][]) {
    // Clean route groups like (authenticated)/ from the config routeId
    const cleanRouteId = routeOptions.routeId.replace(/^\/+/, '').replace(/\(.*?\)\//g, '');
    // remove all the optional parameters
    // example (settings)/settings/account => settings/account
    // nb remember to remove / after the } in the routeId
    // find (...)/ and replace it with ''
    // Convert dynamic segments like [id] to regex wildcards so /chat/123 matches chat/[id]
    const routeRegex = new RegExp('^' + cleanRouteId.replace(/\[.*?\]/g, '[^/]+') + '$');

    if (routeRegex.test(pathname)) {
      return routeName as RouteName;
    }
  }
  return undefined;
};
export const getRoutePath = <T extends RouteName>(options: {
  route: T;
  pathParameters: PathParameters<T>;
}): string => {
  const { pathParameters, route: routeName } = options;

  const baseHref = '';

  const route = getRoute(routeName);

  // pathParameters can be undefined for the entire router, or be defined for some on another router
  const path = (route.getPath as (params: unknown) => string)(pathParameters);

  return baseHref + path;
};

const getRedirectToHref = (url: URL): string | undefined => {
  const { searchParams } = url;
  const redirectToHref = searchParams.get(REDIRECT_TO_URL_SEARCH_PARAM_KEY);
  if (!redirectToHref) {
    return;
  }
  return redirectToHref;
};

export const toNavigateToAppHref = (options: { defaultHref: string; url: URL }): string => {
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
