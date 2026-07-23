// apps/frontend/client/src/lib/constants/routes.ts
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
  index: {
    getPath: () => '/',
    queryParameters: undefined,
    routeId: '/',
    type: 'public',
  },
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
          from?: string;
        },
    routeId: '/setup',
    type: 'public',
  },
  personaCreate: {
    getPath: () => '/personas/create',
    queryParameters: undefined as
      | undefined
      | {
          onboarding?: string;
        },
    routeId: '/personas/create',
    type: 'public',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;

export const defaultRoute: RouteName = 'index';
