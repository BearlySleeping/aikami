// apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts

import { isDevelopmentModePublic, publicEnv } from '@aikami/frontend/configs';
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
  aiSettingsService,
  appService,
  authService,
  onboardingService,
  routerService,
} from '$services';
import type { PWAHookData } from '$types';

export type AppViewModelOptions = BaseViewModelOptions & {
  data: PWAHookData;
};

export type AppViewModelInterface = BaseViewModelInterface & {
  readonly isLoggedIn: boolean;
  readonly currentRoute: RouteName | undefined;
  readonly currentUser: CurrentUser | undefined;
  /** Whether the boot diagnostics screen is currently visible. */
  readonly showBootDiagnostics: boolean;
  /** Called when the player clicks "Initialize Core" on the boot screen. */
  onBootComplete(): void;
};

/**
 * Headless application bootstrapper.
 *
 * Manages the initialization sequence (router, auth, reactive listeners,
 * route transitions) without any UI chrome. Designed for the new offline-first
 * SPA where the root layout must remain minimal and `/game` has no inherited
 * drawers, app bars, or padding.
 */
class AppViewModel extends BaseViewModel<AppViewModelOptions> implements AppViewModelInterface {
  private _initialRouteHandled = false;

  /** Boot screen is shown only on first visit; subsequent refreshes skip it. */
  private _showBootDiagnostics = $state(!appService.bootComplete);

  constructor(options: AppViewModelOptions) {
    super(options);
    // this data comes from PWA hook (ssr), but since we are a SPA this is will always be {}, but keeping the code
    // here to handle it in case we ever switch back to SSR
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
      logger.setContext?.({ userId: userSession.id });
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
  // Reactive Getters
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

  get showBootDiagnostics() {
    const { url } = page;
    const { pathname, searchParams } = url;

    // Skip boot diagnostics on settings, dev routes, or when skip-onboarding is set.
    // These routes must work without the boot gate to avoid a deadlock
    // (user needs /settings to configure providers).
    if (
      pathname.startsWith('/settings') ||
      pathname.startsWith('/dev') ||
      searchParams.get('skip-onboarding') !== null
    ) {
      return false;
    }

    return this._showBootDiagnostics;
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /** Hides the boot diagnostics screen and persists the flag so it won't show again. */
  onBootComplete(): void {
    appService.markBootComplete();
    this._showBootDiagnostics = false;
  }

  override async initialize(): Promise<void> {
    // 0. Bootstrap AI settings from environment defaults (e.g. OpenRouter
    //    API key / model from .env) so text providers are available before
    //    the start screen checks for them.
    await aiSettingsService.loadFromVault();

    // 1. Wire router into SvelteKit primitives.
    routerService.initialize({ goto, page });

    // 2. Set up reactive listeners for routing and auth changes.
    this._setupReactiveListeners();

    // 3. Resolve auth state and handle the initial route.
    const user = await authService.initialize();

    this.log('initialize', {
      version: publicEnv.APP_VERSION,
      route: this.currentRoute,
      user: user ? 'authenticated' : 'anonymous',
    });

    await this._handleRouteTransitions(this.currentRoute, user);
    this._initialRouteHandled = true;

    if (isDevelopmentModePublic()) {
      const eruda = (await import('eruda')).default;
      eruda.init();
    }

    return await super.initialize();
  }

  // --------------------------------------------------------------------------
  // Reactive Listeners
  // --------------------------------------------------------------------------

  /**
   * Sets up Svelte 5 reactive subscriptions for routing and auth.
   *
   * Uses `registerEffectRoot` so BaseViewModel can clean up on dispose.
   */
  private _setupReactiveListeners(): void {
    this.registerEffectRoot(() => {
      // EFFECT 1: Bridge SvelteKit navigation state into RouterService.
      $effect(() => {
        routerService.syncNavigation(navigating, page);
      });

      // EFFECT 2: Route transitions on subsequent navigations.
      // The initial route decision is made in initialize().
      $effect(() => {
        const route = this.currentRoute;
        const user = this.currentUser;
        const isNavigating = routerService.isNavigating;
        const isAuthReady = authService.isAuthReady;

        if (isNavigating) {
          return;
        }

        if (!isAuthReady) {
          return;
        }

        if (!this._initialRouteHandled) {
          return;
        }

        untrack(() => {
          void this._handleRouteTransitions(route, user);
        });
      });
    });
  }

  // --------------------------------------------------------------------------
  // Route Guards
  // --------------------------------------------------------------------------

  /**
   * Handles route transition logic for the offline-first SPA.
   *
   * In the offline-first flow (C-119, C-121), all routes are public. There
   * are no login/register pages and no authenticated-required routes. This
   * guard is intentionally minimal — it only runs onboarding checks for
   * authenticated users.
   */
  private async _handleRouteTransitions(
    _route: RouteName | undefined,
    user: CurrentUser | undefined,
  ): Promise<void> {
    if (!user) {
      return;
    }

    // Run onboarding checks for authenticated users (e.g., missing providers).
    await onboardingService.redirectIfNeeded();
  }
}

export const getAppViewModel = (options: AppViewModelOptions): AppViewModelInterface =>
  new AppViewModel(options);
