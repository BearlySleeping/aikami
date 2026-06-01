/** biome-ignore-all lint/style/useNamingConvention lint/style/noNonNullAssertion lint/style/useBlockStatements lint/style/noParameterAssign lint/suspicious/noAssignInExpressions lint/suspicious/noExplicitAny: pre-existing, external API field names and Svelte 5 patterns */

// apps/frontend/pwa/src/lib/views/app/app_view_model.svelte.ts

import { isDevelopmentModePublic, publicEnv } from '@aikami/frontend/configs';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  isPublicPage,
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
  readonly isFullscreen: boolean;
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
  private _isInitialized = $state(false);
  private _initialRouteHandled = false;

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

  get isAuthReady() {
    return authService.isAuthReady;
  }

  get currentUser() {
    return authService.currentUser;
  }

  get currentRoute() {
    return routerService.currentRoute;
  }

  /** Routes that render fullscreen without the app shell (app bar, drawer, footer). */
  private static readonly _FULLSCREEN_ROUTES: ReadonlySet<RouteName> = new Set(['game']);

  get isFullscreen() {
    if (!this.currentRoute) {
      return false;
    }
    return AppViewModel._FULLSCREEN_ROUTES.has(this.currentRoute);
  }

  get showFooter() {
    return false;
  }
  get showAppLoading() {
    if (!this._isInitialized) {
      return true;
    }

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
      // During auth initialization the route may not be synced yet.
      // Default to showing the app bar to avoid a white-screen flash.
      // The auth guard handles redirects once isAuthReady resolves.
      return true;
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
    routerService.initialize({ goto, page });

    // 2. Set up reactive listeners for future route/auth changes.
    this._setupReactiveListeners();

    // 3. Resolve initial auth state and make the first routing decision.
    //    This runs while _isInitialized is false, so the loading view
    //    covers any redirect — no visible flash.
    const user = await authService.initialize();

    this.log('initialize', {
      version: publicEnv.APP_VERSION,
      route: this.currentRoute,
      user,
    });

    await this._handleRouteTransitions(this.currentRoute, user);
    this._initialRouteHandled = true;

    if (isDevelopmentModePublic()) {
      const eruda = (await import('eruda')).default;
      eruda.init();
    }

    this._isInitialized = true;
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

      // EFFECT 2: Reactive auth + route guards for SUBSEQUENT changes.
      // The initial route decision is made in initialize(), before the
      // loading view disappears. This effect only handles changes after
      // initialization (logout, session expiry, manual navigation).
      $effect(() => {
        // Read dependencies at the top level to explicitly register them with Svelte.
        const route = this.currentRoute;
        const user = this.currentUser;
        const isNavigating = routerService.isNavigating;
        const isAuthReady = authService.isAuthReady;

        // GUARD: Bail out if SvelteKit is currently processing a navigation.
        if (isNavigating) {
          return;
        }

        // GUARD: Don't redirect until Firebase Auth has resolved.
        if (!isAuthReady) {
          return;
        }

        // GUARD: Initial routing is handled in initialize(). This effect
        // only manages subsequent auth/route changes.
        if (!this._initialRouteHandled) {
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
      // if we don't have a route defined, it is most likely a bug we should fallback to either login or dashboard
      return user
        ? await routerService.navigateToApp()
        : await routerService.goToRoute('login', {
            pathParameters: undefined,
            queryParameters: undefined,
          });
    }

    const isPublicRoute = isPublicPage(route);

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
