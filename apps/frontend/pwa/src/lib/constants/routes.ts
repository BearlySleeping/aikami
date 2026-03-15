// apps/frontend/pwa/src/lib/constants/routes.ts
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
  login: {
    getPath: () => '/login',
    queryParameters: undefined as
      | undefined
      | {
          returnUrl?: boolean;
        },
    routeId: '/(unauthenticated)/login',
    type: 'unauthenticated',
  },
  register: {
    getPath: () => '/register',
    queryParameters: undefined,
    routeId: '/(unauthenticated)/register',
    type: 'unauthenticated',
  },
  dashboard: {
    getPath: () => '/dashboard',
    queryParameters: undefined,
    routeId: '/(authenticated)/dashboard',
    type: 'authenticated',
  },
  settings: {
    getPath: () => '/settings',
    queryParameters: undefined,
    routeId: '/(authenticated)/settings',
    type: 'authenticated',
  },
  about: {
    getPath: () => '/about',
    queryParameters: undefined,
    routeId: '/(public)/about',
    type: 'public',
  },
  'character/create': {
    getPath: () => '/character/create',
    queryParameters: undefined,
    routeId: '/(authenticated)/character/create',
    type: 'authenticated',
  },
  'character/[id]': {
    getPath: (params: { id: string }) => `/character/${params.id}`,
    queryParameters: undefined,
    routeId: '/(authenticated)/character/[id]',
    type: 'authenticated',
  },
  characters: {
    getPath: () => '/characters',
    queryParameters: undefined,
    routeId: '/(authenticated)/characters',
    type: 'authenticated',
  },
  'chat/[id]': {
    getPath: (params: { id: string }) => `/chat/${params.id}`,
    queryParameters: undefined,
    routeId: '/(authenticated)/chat/[id]',
    type: 'authenticated',
  },
  'character/[id]/image': {
    getPath: (params: { id: string }) => `/character/${params.id}/image`,
    queryParameters: undefined,
    routeId: '/(authenticated)/character/[id]/image',
    type: 'authenticated',
  },
  'personas/create': {
    getPath: () => '/personas/create',
    queryParameters: undefined,
    routeId: '/(authenticated)/personas/create',
    type: 'authenticated',
  },
  npcs: {
    getPath: () => '/npcs',
    queryParameters: undefined,
    routeId: '/(authenticated)/npcs',
    type: 'authenticated',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;
