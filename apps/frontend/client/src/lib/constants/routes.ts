// apps/frontend/client/src/lib/constants/routes.ts
import type { Routes } from '@aikami/frontend/services';

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
  capability: {
    getPath: () => '/capability',
    queryParameters: undefined as
      | undefined
      | {
          reason?: string;
        },
    routeId: '/capability',
    type: 'public',
  },
  game: {
    getPath: () => '/game',
    queryParameters: undefined,
    routeId: '/game',
    type: 'public',
  },
  personas: {
    getPath: () => '/personas',
    queryParameters: undefined,
    routeId: '/personas',
    type: 'public',
  },
  settings: {
    getPath: () => '/settings',
    queryParameters: undefined as
      | undefined
      | {
          from?: string;
        },
    routeId: '/settings',
    type: 'public',
  },
  setup: {
    getPath: () => '/setup',
    queryParameters: undefined as
      | undefined
      | {
          'skip-wizard'?: string;
        },
    routeId: '/setup',
    type: 'public',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;
