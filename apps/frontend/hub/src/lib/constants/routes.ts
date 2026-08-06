import type { RouteName, Routes } from '@aikami/frontend/services';

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
  personas: {
    getPath: () => '/personas',
    queryParameters: undefined,
    routeId: '/(authenticated)/personas',
    type: 'authenticated',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;

export const defaultRoute: RouteName = 'dashboard';
