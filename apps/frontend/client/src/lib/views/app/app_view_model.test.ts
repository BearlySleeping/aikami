// apps/frontend/client/src/lib/views/app/app_view_model.test.ts
//
// Unit tests for the root AppViewModel — capability wiring, getter delegation,
// and the SSR hook seeding performed in the constructor. Collaborators are
// injected capabilities, so no global `$services` mock is required.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { CurrentUser } from '@aikami/types';
import {
  type AppAuthCapabilities,
  type AppEmulatorSeedCapabilities,
  type AppRouterCapabilities,
  type AppRuntimeConfigCapabilities,
  type AppShellCapabilities,
  type AppUpdaterCapabilities,
  type AppViewModelOptions,
  createAppViewModel,
} from './app_view_model.svelte';

const createAuth = (overrides: Partial<AppAuthCapabilities> = {}): AppAuthCapabilities => ({
  setCurrentUser: mock(() => {}),
  isLoggedIn: false,
  currentUser: undefined,
  isAuthReady: false,
  initialize: mock(async () => undefined),
  ...overrides,
});

const createApp = (overrides: Partial<AppShellCapabilities> = {}): AppShellCapabilities => ({
  setCurrentDevice: mock(() => {}),
  sessionId: null,
  ...overrides,
});

const createRouter = (overrides: Partial<AppRouterCapabilities> = {}): AppRouterCapabilities => ({
  setCurrentRoute: mock(() => {}),
  currentRoute: undefined,
  isNavigating: false,
  initialize: mock(() => {}),
  syncNavigation: mock(() => {}),
  ...overrides,
});

const createRuntimeConfig = (): AppRuntimeConfigCapabilities => ({
  loadConfig: mock(async () => ({})),
});

const createEmulatorSeed = (): AppEmulatorSeedCapabilities => ({
  seedIfEmpty: mock(async () => {}),
});

const createUpdater = (): AppUpdaterCapabilities => ({
  checkForUpdates: mock(async () => {}),
});

const createViewModel = (overrides: Partial<AppViewModelOptions> = {}) =>
  createAppViewModel({
    className: 'AppViewModelTest',
    data: {},
    auth: createAuth(),
    app: createApp(),
    router: createRouter(),
    runtimeConfig: createRuntimeConfig(),
    emulatorSeed: createEmulatorSeed(),
    updater: createUpdater(),
    ...overrides,
  });

describe('AppViewModel — getter delegation', () => {
  test('reads identity and route state from capabilities', () => {
    const currentUser = { uid: 'user-1' } as CurrentUser;
    const viewModel = createViewModel({
      auth: createAuth({ isLoggedIn: true, currentUser }),
      router: createRouter({ currentRoute: 'game' }),
    });

    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.currentUser).toBe(currentUser);
    expect(viewModel.currentRoute).toBe('game');
  });
});

describe('AppViewModel — hook seeding', () => {
  test('applies session id and current route from the layout data', () => {
    const app = createApp();
    const setCurrentRoute = mock(() => {});
    createViewModel({
      data: { sessionId: 'session-42', currentRoute: 'start' },
      app,
      router: createRouter({ setCurrentRoute }),
    });

    expect(app.sessionId).toBe('session-42');
    expect(setCurrentRoute).toHaveBeenCalledWith('start');
  });
});

describe('AppViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
