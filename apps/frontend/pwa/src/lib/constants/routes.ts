import type { Routes } from '@aikami/frontend/services';

export const routes = {
  login: {
    getPath: () => '/login',
    queryParameters: undefined as
      | undefined
      | {
          returnUrl?: boolean;
        },
    routeId: 'login',
    type: 'unauthenticated',
  },
  register: {
    getPath: () => '/register',
    queryParameters: undefined,
    routeId: 'register',
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
    routeId: 'settings',
    type: 'authenticated',
  },
  about: {
    getPath: () => '/about',
    queryParameters: undefined,
    routeId: 'about',
    type: 'public',
  },
  'character/create': {
    getPath: () => '/character/create',
    queryParameters: undefined,
    routeId: 'character/create',
    type: 'authenticated',
  },
  'character/[id]': {
    getPath: (params: { id: string }) => `/character/${params.id}`,
    queryParameters: undefined,
    routeId: 'character/[id]',
    type: 'authenticated',
  },
  characters: {
    getPath: () => '/characters',
    queryParameters: undefined,
    routeId: 'characters',
    type: 'authenticated',
  },
  'chat/[id]': {
    getPath: (params: { id: string }) => `/chat/${params.id}`,
    queryParameters: undefined,
    routeId: 'chat/[id]',
    type: 'authenticated',
  },
  profile: {
    getPath: () => '/profile',
    queryParameters: undefined,
    routeId: 'profile',
    type: 'authenticated',
  },
  'character/[id]/image': {
    getPath: (params: { id: string }) => `/character/${params.id}/image`,
    queryParameters: undefined,
    routeId: 'character/[id]/image',
    type: 'authenticated',
  },
  'personas/create': {
    getPath: () => '/personas/create',
    queryParameters: undefined,
    routeId: 'personas/create',
    type: 'authenticated',
  },
  npcs: {
    getPath: () => '/npcs',
    queryParameters: undefined,
    routeId: 'npcs',
    type: 'authenticated',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;
