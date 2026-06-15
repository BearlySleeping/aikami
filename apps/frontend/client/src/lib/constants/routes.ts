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
    queryParameters: undefined as
      | undefined
      | {
          from?: string;
        },
    routeId: '/settings',
    type: 'public',
  },
  chat: {
    getPath: (params: { chatId: string }) => `/chat/${params.chatId}`,
    queryParameters: {} as {
      npcId: string;
    },
    routeId: '/(authenticated)/chat/[id]',
    type: 'authenticated',
  },
  'personas/create': {
    getPath: () => '/personas/create',
    queryParameters: undefined,
    routeId: '/(authenticated)/personas/create',
    type: 'authenticated',
  },
  personas: {
    getPath: () => '/personas',
    queryParameters: undefined,
    routeId: '/(authenticated)/personas',
    type: 'authenticated',
  },
  npcs: {
    getPath: () => '/npcs',
    queryParameters: undefined,
    routeId: '/(authenticated)/npcs',
    type: 'authenticated',
  },
  game: {
    getPath: () => '/game',
    queryParameters: undefined,
    routeId: '/game',
    type: 'public',
  },
  setup: {
    getPath: () => '/setup',
    queryParameters: undefined,
    routeId: '/setup',
    type: 'public',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;
