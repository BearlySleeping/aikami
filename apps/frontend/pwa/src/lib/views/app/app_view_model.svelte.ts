/** biome-ignore-all lint/style/useNamingConvention lint/style/noNonNullAssertion lint/style/useBlockStatements lint/style/noParameterAssign lint/suspicious/noAssignInExpressions lint/suspicious/noExplicitAny: pre-existing, external API field names and Svelte 5 patterns */

// apps/frontend/pwa/src/lib/views/app/app-view-model.svelte.ts

import { isDevelopmentModePublic } from '@aikami/frontend/configs';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { navigating, page } from '$app/state';
import { logger } from '$logger';
import type { RouteName } from '$router';
import {
  appService,
  authService,
  notificationService,
  onboardingService,
  routerService,
} from '$services';
import type { PWAHookData } from '$types';
import type { BaseMetaTags } from './metadata/head_tags_view_model.svelte.ts';

export type AppViewModelOptions = BaseViewModelOptions & {
  data: PWAHookData;
};

export type AppViewModelInterface = BaseViewModelInterface & {
  readonly isNavigationDrawerMinified: boolean;
  readonly navigationDrawerEnabled: boolean;
  readonly showAppBar: boolean;
  readonly isLoggedIn: boolean;
  readonly currentRoute: RouteName | undefined;
  readonly currentUser: CurrentUser | undefined;
  readonly showFooter: boolean;
  readonly showAppLoading: boolean;

  readonly defaultMetaTags: BaseMetaTags;

  handleAppClose(event: BeforeUnloadEvent): void;
  toggleNavigationDrawer(): void;
};

class AppViewModel extends BaseViewModel<AppViewModelOptions> implements AppViewModelInterface {
  isNavigationDrawerMinified = $state(false);

  // Set initial SSR data synchronously
  constructor(options: AppViewModelOptions) {
    super(options);
    const { userSession, device, logLevel, currentRoute, sessionId } = options.data;

    if (userSession) {
      authService.setCurrentUser(userSession);
    }
    if (device) {
      appService.setCurrentDevice(device);
    }

    if (currentRoute) {
      routerService.setCurrentRoute(currentRoute);
    }

    if (logLevel) {
      logger.setLogLevel(logLevel);
    }

    if (userSession) {
      logger.setContext?.({
        userId: userSession.id,
      });
    }

    if (device) {
      logger.setContext?.({ device });
    }

    if (sessionId) {
      logger.setContext?.({ sessionId });
      appService.sessionId = sessionId;
    }
  }

  // --------------------------------------------------------------------------
  // Reactive Getters (Replaces Svelte 4 `derived` and `writable`)
  // --------------------------------------------------------------------------

  get isLoggedIn() {
    return authService.isLoggedIn;
  }

  get currentUser() {
    return authService.currentUser;
  }

  get currentRoute() {
    return routerService.currentRoute;
  }

  get showFooter() {
    return false;
  }
  get showAppLoading() {
    return routerService.isNavigating;
  }
  get navigationDrawerEnabled() {
    if (!this.currentRoute) {
      return false;
    }
    // Example: Use your router's exact logic here
    const isPublic = ['login', 'register'].includes(this.currentRoute);
    return this.isLoggedIn && !isPublic && !this._isMinimalRouteView(this.currentRoute);
  }

  get showAppBar() {
    if (!this.currentRoute) {
      return false;
    }
    return !this._isMinimalRouteView(this.currentRoute, this.isLoggedIn);
  }

  get defaultMetaTags(): BaseMetaTags {
    return {
      title: 'Aikami',
      description: 'Aikami',
      keywords: ['aikami', 'pwa'],
    };
  }

  // --------------------------------------------------------------------------
  // Initialization & Effects (Replaces Svelte 4 `subscribe`)
  // --------------------------------------------------------------------------

  override async initialize(): Promise<void> {
    // 1. Inject static dependencies into our framework-agnostic service.
    routerService.initialize({ goto });

    // 2. Set up our reactive tracking safely attached to the class lifecycle
    this._setupReactiveListeners();

    await authService.initialize();

    // Log build version for cache-busting debugging
    try {
      const constants = await import('@aikami/constants');
      this.log('App version', {
        version: (constants as { APP_VERSION?: string }).APP_VERSION ?? 'unknown',
      });
    } catch {
      this.log('App version', { error: 'could not load constants' });
    }

    if (isDevelopmentModePublic()) {
      const eruda = (await import('eruda')).default;
      eruda.init();
    }

    return await super.initialize();
  }

  /**
   * Initializes Svelte 5 reactive subscriptions for the application.
   * * ### SvelteKit 5 & Class-Based State Workaround
   * SvelteKit's `$app/state` (`navigating`, `page`) are reactive proxies.
   * If we try to read them inside an asynchronous method in a plain `.ts` file,
   * Svelte 5 loses the tracking context and goes blind to future updates.
   * * To fix this, we wrap them in a managed `$effect.root`. We use
   * `this.registerEffectRoot` so the `BaseViewModel` can cache the cleanup function.
   * When the UI unmounts the `BaseViewModelContainer`, it calls `dispose()`,
   * instantly destroying these effects and preventing memory leaks.
   */
  private _setupReactiveListeners(): void {
    this.registerEffectRoot(() => {
      // EFFECT 1: The SvelteKit Bridge (The Microphone)
      // This effect binds to SvelteKit's internal routing engine. Whenever the
      // user navigates, Svelte updates the proxies, triggering this effect,
      // and we safely pipe that data into our internal RouterService.
      $effect(() => {
        routerService.syncNavigation(navigating, page);
      });

      // EFFECT 2: The Business Logic Guards
      // This effect strictly watches OUR internal application state.
      $effect(() => {
        // Read dependencies at the top level to explicitly register them with Svelte.
        const route = this.currentRoute;
        const user = this.currentUser;
        const isNavigating = routerService.isNavigating;

        // GUARD: Bail out if SvelteKit is currently processing a navigation.
        // We only want to evaluate auth/routing rules on fully resolved pages.
        if (isNavigating) {
          return;
        }

        // CRITICAL: untrack() prevents synchronous infinite loops.
        // We want to execute these transitions *because* the route/user changed,
        // but we DO NOT want this $effect to subscribe to any internal state mutations
        // (like redirect histories or internal flags) that happen inside these methods.
        untrack(() => {
          void this._handleRouteTransitions(route, user);
          void this._handleAuthStateChanges(user);
        });
      });
    });
  }

  // --------------------------------------------------------------------------
  // Methods
  // --------------------------------------------------------------------------

  private async _handleRouteTransitions(
    route: RouteName | undefined,
    user: CurrentUser | undefined,
  ) {
    if (!route) {
      return;
    }

    const isPublicRoute = ['login', 'register'].includes(route);

    // Rule 1: Authenticated users shouldn't be on auth pages
    if (user && isPublicRoute && route !== 'register') {
      this.log('Redirecting authenticated user to app');
      await routerService.navigateToApp();
      return;
    }

    // Rule 2: Unauthenticated users shouldn't be on protected pages
    if (!user && !isPublicRoute) {
      this.log('Redirecting unauthenticated user to login');
      await routerService.goToRoute('login', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
      return;
    }

    // Additional onboarding check
    if (user) {
      await onboardingService.redirectIfNeeded();
    }
  }

  private async _handleAuthStateChanges(user: CurrentUser | undefined) {
    if (!user) {
      return;
    }

    // Start real-time notification listener for this user
    await notificationService.listenForNotifications(user.id);
  }

  private _isMinimalRouteView(route?: RouteName, _isLoggedIn?: boolean): boolean {
    if (!route) {
      return false;
    }
    const minimalRoutes: RouteName[] = ['login', 'register'];
    return minimalRoutes.includes(route);
  }

  handleAppClose(event: BeforeUnloadEvent): void {
    // Check uploads or active processes here before close
    this.debug('handleAppClose', { event });
  }

  toggleNavigationDrawer(): void {
    this.isNavigationDrawerMinified = !this.isNavigationDrawerMinified;
  }
}

export const getAppViewModel = (options: AppViewModelOptions): AppViewModelInterface =>
  new AppViewModel(options);
