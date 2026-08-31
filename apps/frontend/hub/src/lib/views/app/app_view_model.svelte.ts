// apps/frontend/hub/src/lib/views/app/app_view_model.svelte.ts
import { isDevelopmentModePublic } from '@aikami/frontend/configs';
import type { Page } from '@aikami/frontend/services';
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
import { routeTypeOf } from '$routes';
import { appService, authService, routerService } from '$services';
import type { AdminHookData } from '$types';
import type { BaseMetaTags } from './metadata/head_tags_view_model.svelte';

export type AppViewModelOptions = BaseViewModelOptions & {
  data: AdminHookData;
};

export type AppViewModelInterface = BaseViewModelInterface & {
  readonly isNavigationDrawerMinified: boolean;
  readonly navigationDrawerEnabled: boolean;
  readonly showAppBar: boolean;
  readonly isLoggedIn: boolean;
  readonly currentRoute: RouteName | undefined;
  readonly currentUser: CurrentUser | undefined;
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
    }
  }

  // --------------------------------------------------------------------------
  // Reactive Getters (Replaces Svelte 4 `derived` and `writable`)
  // --------------------------------------------------------------------------
  get defaultMetaTags(): BaseMetaTags {
    return {
      title: 'Aikami',
      description: 'Aikami',
      keywords: ['aikami', 'hub'],
    };
  }

  get isLoggedIn() {
    return authService.isLoggedIn;
  }

  get currentUser() {
    return authService.currentUser;
  }

  get currentRoute() {
    return routerService.currentRoute;
  }

  get showAppLoading() {
    return routerService.isNavigating;
  }
  get navigationDrawerEnabled() {
    if (!this.currentRoute) {
      return false;
    }
    // Drawer shows for signed-in users on every non-auth page — including
    // the public catalog (C-396): a signed-in visitor browsing the catalog
    // keeps their navigation. Only the auth pages stay minimal.
    const isAuthPage = routeTypeOf(this.currentRoute) === 'unauthenticated';
    return this.isLoggedIn && !isAuthPage && !this._isMinimalRouteView(this.currentRoute);
  }

  get showAppBar() {
    if (!this.currentRoute) {
      return false;
    }
    return !this._isMinimalRouteView(this.currentRoute, this.isLoggedIn);
  }

  // --------------------------------------------------------------------------
  // Initialization & Effects (Replaces Svelte 4 `subscribe`)
  // --------------------------------------------------------------------------

  override async initialize(): Promise<void> {
    // 0. Reveal the page — the anti-FOUC CSS in app.html hides the body
    //    until the SPA mounts and adds this class.
    document.body.classList.add('app-mounted');

    // 1. Inject static dependencies into our framework-agnostic service.
    routerService.initialize({ goto, page: page as unknown as Page });
    // The cast `as unknown as Page` bridges SvelteKit's generic Page type
    // (state: PageState) to the router service's minimal Page interface
    // (state: Record<string, unknown>).

    // 2. Set up our reactive tracking safely attached to the class lifecycle
    this._setupReactiveListeners();

    try {
      await authService.initialize();
    } catch (error) {
      this.error('initialize: authService', error);
    }

    if (isDevelopmentModePublic()) {
      try {
        const eruda = (await import('eruda')).default;
        eruda.init();
      } catch (error) {
        this.warn('initialize: failed to load eruda', error);
      }
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
        routerService.syncNavigation(navigating, page as unknown as Page);
      });

      // EFFECT 2: The Business Logic Guards
      // Guards auth state based on route changes. Only depends on
      // currentRoute and currentUser — NOT isNavigating — to avoid
      // cascading re-runs when syncNavigation toggles _navigating.
      let _lastRouteKey = '';
      $effect(() => {
        const route = this.currentRoute;
        const user = this.currentUser;

        if (!route) {
          return;
        }

        // Bail while SvelteKit is actively navigating — we only want to
        // evaluate auth rules on fully resolved pages. Checked BEFORE the
        // duplicate-route guard and before recording the route, so the
        // evaluation re-runs when navigation completes.
        if (routerService.isNavigating) {
          return;
        }

        // Guard: skip if route + user haven't changed since last run.
        const routeKey = `${route}:${user?.id ?? 'anonymous'}`;
        if (routeKey === _lastRouteKey) {
          return;
        }
        _lastRouteKey = routeKey;

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

    try {
      // Route-type-driven guards (C-396): the hub's default is PUBLIC. Only
      // `authenticated` routes send anonymous visitors to login, and only
      // `unauthenticated` routes (login) send signed-in users back to the
      // app. Public catalog routes welcome everyone.
      const routeType = routeTypeOf(route);

      // Rule 1: Authenticated users shouldn't be on auth pages
      if (user && routeType === 'unauthenticated') {
        this.log('Redirecting authenticated user to app');
        await routerService.navigateToApp();
        return;
      }

      // Rule 2: Unauthenticated users shouldn't be on protected pages
      if (!user && routeType === 'authenticated') {
        this.log('Redirecting unauthenticated user to login');
        await routerService.goToRoute('login', {
          pathParameters: undefined,
          queryParameters: undefined,
        });
        return;
      }
    } catch (error) {
      this.error('_handleRouteTransitions', error);
    }
  }

  private async _handleAuthStateChanges(user: CurrentUser | undefined) {
    if (!user) {
      // Clean up when user logs out
      // notificationService.unsubscribe();
      return;
    }

    // Initialize dependencies now that we have a user
    // e.g., notificationService.listenForNotifications(user.id);
    // preferenceService.initialize(user.id);
  }

  private _isMinimalRouteView(route?: RouteName, _isLoggedIn?: boolean): boolean {
    if (!route) {
      return false;
    }
    const minimalRoutes: RouteName[] = ['login'];
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
  AppViewModel.create(options);
