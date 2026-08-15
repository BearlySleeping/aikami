import type { RouteName, Routes, RouteType } from '@aikami/frontend/services';

export {
  type AllRoutes,
  type PathParameters,
  type RouteName,
  type RouteOptions,
  toNavigateToAppHref,
  toRouteHref,
  toRoutePathFromRouteId,
  toRoutePathFromURL,
} from '@aikami/frontend/services';

/**
 * Hub route table (C-396).
 *
 * The hub's default is PUBLIC: the catalog landing at `/` and every
 * `/catalog/**` page render for anyone, signed in or not. Authentication is
 * the exception, not the default — only routes registered with
 * `type: 'authenticated'` sit under the `(authenticated)` guard group.
 *
 * The `RouteType` union in `@aikami/frontend/services` already includes
 * `'public'`, and `router_utils.ts` (`isPublicPage`) already treats it as
 * renderable either way — this table simply starts using it.
 */
export const routes = {
  login: {
    getPath: () => '/login',
    queryParameters: undefined,
    routeId: '/(unauthenticated)/login',
    type: 'unauthenticated',
  },
  dashboard: {
    getPath: () => '/dashboard',
    queryParameters: undefined,
    routeId: '/(authenticated)/dashboard',
    type: 'authenticated',
  },
  /** Catalog landing — replaces the old root redirect. Public for everyone. */
  catalog: {
    getPath: () => '/',
    queryParameters: undefined,
    routeId: '/(public)',
    type: 'public',
  },
  /** One catalog category — a shard-backed browse page. Public for everyone. */
  catalogCategory: {
    getPath: ({ category }: { category: string }) => `/catalog/${category}`,
    queryParameters: undefined,
    routeId: '/(public)/catalog/[category]',
    type: 'public',
  },
  /** One catalog asset — preview, license, attribution. Public for everyone. */
  catalogAsset: {
    getPath: ({ category, tag }: { category: string; tag: string }) =>
      `/catalog/${category}/${encodeURIComponent(tag)}`,
    queryParameters: undefined,
    routeId: '/(public)/catalog/[category]/[tag]',
    type: 'public',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;

/**
 * Type of a registered route — `undefined` for unknown routes.
 *
 * The shell view models (C-396) use this instead of hardcoded route lists:
 * the hub's default is PUBLIC, so auth decisions must follow the route
 * table, not an in-memory `['login', 'register']` array that silently
 * forgets new public routes.
 */
export const routeTypeOf = (route: RouteName): RouteType | undefined => routes[route]?.type;

export const defaultRoute: RouteName = 'dashboard';
