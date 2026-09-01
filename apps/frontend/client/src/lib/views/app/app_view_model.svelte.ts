// apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts

import { getPublicMode, isDevelopmentModePublic, publicEnv } from '@aikami/frontend/configs';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { navigating, page } from '$app/state';
import type { RouteName } from '$router';
import {
  aiSettingsService,
  appService,
  authService,
  emulatorSeedService,
  routerService,
  runtimeConfigService,
  updaterService,
} from '$services';
import type { ClientHookData } from '$types';

/** Delay before the background desktop update check — keeps first paint clear. */
const UPDATE_CHECK_DELAY_MS = 5000;

export type AppViewModelOptions = BaseViewModelOptions & {
  data: ClientHookData;
};

export type AppViewModelInterface = BaseViewModelInterface & {
  readonly isLoggedIn: boolean;
  readonly currentRoute: RouteName | undefined;
  readonly currentUser: CurrentUser | undefined;
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
      BaseViewModel.setLogLevel(logLevel);
    }

    if (sessionId) {
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

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  override async initialize(): Promise<void> {
    // Anti-FOUC: unhide the body once the SPA mounts (see app.html inline style).
    document.body.classList.add('app-mounted');

    // 0. Bootstrap AI settings from environment defaults (e.g. OpenRouter
    //    API key / model from .env) so text providers are available before
    //    the start screen checks for them.
    await aiSettingsService.loadFromVault();

    // 0b. Resolve the runtime engine config (C-389) — config.json beside
    //    index.html, Tauri app config dir, or dev-only defaults. Loaded
    //    early so first engine requests target the configured hosts.
    await runtimeConfigService.loadConfig();

    // 1. Wire router into SvelteKit primitives.
    routerService.initialize({ goto, page });

    // 2. Set up reactive listeners for routing and auth changes.
    this._setupReactiveListeners();

    // 3. Resolve auth state and handle the initial route.
    const user = await authService.initialize();

    // Seed local personas/NPCs/custom agents in emulator mode BEFORE the
    // initial route renders, so a fresh browser (empty local DB) boots into
    // a playable game (C-386 AC-11). The Firebase emulator cannot reach the
    // browser's local DB — seeding is client-side.
    if (getPublicMode() === 'emulator') {
      await emulatorSeedService.seedIfEmpty();
    }

    this.log('initialize', {
      version: publicEnv.APP_VERSION,
      route: this.currentRoute,
      user: user ? 'authenticated' : 'anonymous',
    });

    await this._handleRouteTransitions(this.currentRoute, user);
    this._initialRouteHandled = true;

    if (isDevelopmentModePublic() || publicEnv.PUBLIC_ERUDA_ENABLED) {
      const eruda = (await import('eruda')).default;
      eruda.init();
    }

    // Tauri desktop only: check for updates a few seconds after startup so
    // first paint is never blocked. No-op in the browser PWA.
    setTimeout(() => {
      void updaterService.checkForUpdates();
    }, UPDATE_CHECK_DELAY_MS);

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
   * Intentionally performs NO navigation. A sign-in (or an existing session)
   * must never yank the user away from the page they're on: the /link
   * device-handoff page has to stay put until the desktop app confirms the
   * handoff, and after a normal sign-in the user expects to remain on the
   * start menu. Character creation is reached on demand via "Start New Game"
   * (start_view_model's _proceedWithPack) — the previous auto-redirect to
   * /personas/create fired on every route/auth change for persona-less users
   * and was removed because it interrupted flows like the device link.
   */
  private async _handleRouteTransitions(
    _route: RouteName | undefined,
    _user: CurrentUser | undefined,
  ): Promise<void> {
    // No-op — see doc comment above.
  }
}

export const getAppViewModel = (options: AppViewModelOptions): AppViewModelInterface =>
  AppViewModel.create(options);
