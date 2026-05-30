// apps/frontend/pwa/src/lib/views/app/app-view-model.svelte.ts
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
import { appService, authService, onboardingService, routerService } from '$services';
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

  readonly defaultMetaTags: BaseMetaTags;

  handleAppClose(event: BeforeUnloadEvent): void;
  toggleNavigationDrawer(): void;
};

class AppViewModel extends BaseViewModel<AppViewModelOptions> implements AppViewModelInterface {
  isNavigationDrawerMinified = $state(false);

  constructor(options: AppViewModelOptions) {
    super(options);
    const { userSession, device, logLevel, currentRoute } = options.data;

    // Set initial SSR data synchronously
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
  get navigationDrawerEnabled() {
    if (!this.currentRoute) {
      return false;
    }
    // Example: Use your router's exact logic here
    const isPublic = ['login', 'register'].includes(this.currentRoute);
    return this.isLoggedIn && !isPublic && !this._isMinimalRouteView(this.currentRoute);
  }

  get showAppBar() {
    this.log('showAppBar', { currentRoute: this.currentRoute });
    if (!this.currentRoute) {
      return false;
    }
    return !this._isMinimalRouteView(this.currentRoute, this.isLoggedIn);
  }

  get defaultMetaTags(): BaseMetaTags {
    return {
      title: 'AiKami',
      description: 'AiKami',
      keywords: ['ai', 'game'],
    };
  }

  // --------------------------------------------------------------------------
  // Initialization & Effects (Replaces Svelte 4 `subscribe`)
  // --------------------------------------------------------------------------

  override async initialize(): Promise<void> {
    routerService.initialize({ goto, page, navigating });
    await authService.initialize();

    $effect.root(() => {
      $effect(() => {
        // 1. Read dependencies so Svelte tracks them
        const route = this.currentRoute;
        const user = this.currentUser;
        const isNavigating = routerService.isNavigating;

        // 2. Bail out if SvelteKit is currently processing a navigation
        if (isNavigating) return;

        // 3. Run the side-effects safely isolated from tracking
        untrack(() => {
          void this._handleRouteTransitions(route, user);
          void this._handleAuthStateChanges(user);
        });
      });
    });

    if (import.meta.env.PUBLIC_FLAVOR === 'development') {
      const eruda = (await import('eruda')).default;
      eruda.init();
    }

    await super.initialize();
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

    // Additional onboarding check (from your existing Aikami AppViewModel)
    if (user) {
      await onboardingService.redirectIfNeeded();
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

  private _isMinimalRouteView(route?: RouteName, isLoggedIn?: boolean): boolean {
    this.log('_isMinimalRouteView', { route, isLoggedIn });
    if (!route) {
      return false;
    }
    // Hide UI for these routes
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
