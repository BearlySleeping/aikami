import type { Routes } from '@aikami/frontend/services';

export const routes = {
  login: {
    getPath: () => '/login',
    queryParameters: undefined,
    routeId: 'login',
    type: 'unauthenticated',
  },
  register: {
    getPath: () => '/register',
    queryParameters: undefined,
    routeId: 'register',
    type: 'unauthenticated',
  },
  test: {
    getPath: () => '/test',
    queryParameters: undefined,
    routeId: 'test',
    type: 'public',
  },
  settings: {
    getPath: () => '/settings',
    queryParameters: undefined,
    routeId: 'settings',
    type: 'authenticated',
  },
} as const satisfies Routes;

export const searchParametersToKeep: Readonly<string[]> = [] as const;
