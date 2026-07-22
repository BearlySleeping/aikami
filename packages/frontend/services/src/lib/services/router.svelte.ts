// packages/frontend/services/src/lib/services/router.svelte.ts
import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from '@aikami/constants';
import type { Listener } from '@aikami/types';
import { BaseClass, toAppError } from '@aikami/utils';
import type { Page, Navigation as SvelteKitNavigation } from '@sveltejs/kit';
import { untrack } from 'svelte';
import {
  type AllRoutes,
  type PathParameters,
  type RouteName,
  type RouteOptions,
  toRouteHref,
  toRoutePathFromRouteId,
  toRoutePathFromURL,
} from '$router';
import type { BaseFrontendClassInterface } from '../base/base_frontend_class.ts';

type Navigation =
  | SvelteKitNavigation
  | {
      from: null;
      to: null;
      type: null;
      willUnload: null;
      delta: null;
      complete: null;
    };

/**
 * Returns a Promise that resolves when SvelteKit navigates (or fails to
 * navigate, in which case the promise rejects) to the specified `url`. For
 * external URLs, use `window.location = url` instead of calling `goto(url)`.
 *
 * @param {string | URL} url Where to navigate to. Note that if you've set
 *   [`config.kit.paths.base`](https://kit.svelte.dev/docs/configuration#paths)
 *   and the URL is root-relative, you need to prepend the base path if you want
 *   to navigate within the app.
 * @param {Object} [opts] Options related to the navigation
 * @param {boolean} [opts.replaceState] If `true`, will replace the current
 *   `history` entry rather than creating a new one with `pushState`
 * @param {boolean} [opts.noscroll] If `true`, the browser will maintain its
 *   scroll position rather than scrolling to the top of the page after
 *   navigation
 * @param {boolean} [opts.keepfocus] If `true`, the currently focused element
 *   will retain focus after navigation. Otherwise, focus will be reset to the
 *   body
 * @param {unknown} [opts.state] An optional object that will be available on
 *   the `$page.state` store
 * @returns {Promise<void>}
 */
type GoTo = (
  url: string | URL,
  opts?: {
    replaceState?: boolean;
    noscroll?: boolean;
    keepfocus?: boolean;
    state?: App.PageState | undefined;
  },
) => Promise<void>;

export type RouterServiceInterface = BaseFrontendClassInterface & {
  readonly url: URL;
  readonly searchParams: URLSearchParams;
  readonly currentRoute: RouteName | undefined;
  readonly initialized: boolean;
  readonly navigatingToRoute: RouteName | undefined;
  readonly isNavigating: boolean;
  readonly currentPathName: string | undefined;
  readonly previousPage: Page | undefined;

  toRouteHref<T extends RouteName>(
    route: T,
    options: RouteOptions & {
      queryParameters: AllRoutes[T]['queryParameters'];
      pathParameters: PathParameters<T>;
      url: URL | undefined;
    },
  ): string;
  /**
   * Navigate to the specified href.
   *
   * Only use this when it is not possible to use {@link goToRoute},
   * currently this use case is only for embed package.
   */
  goToHref(href: string): Promise<void>;
  goToRoute<T extends RouteName>(
    route: T,
    options: RouteOptions & {
      queryParameters: AllRoutes[T]['queryParameters'];
      pathParameters: PathParameters<T>;
    },
  ): Promise<void>;

  /** Navigate to a dev route. Accepts the path after /dev (e.g. 'combat', 'agent-editor'). */
  goToDevRoute(devPath: string): Promise<void>;

  /** Stores the SvelteKit goto function and marks the service as initialized. */
  initialize(options: { goto: GoTo; page: Page }): void;

  /**
   * Must be called from a reactive context (inside $effect) so Svelte
   * tracks changes to `navigating` and `page` from `$app/state`.
   * Updates internal navigation state accordingly.
   */
  syncNavigation(navigating: Navigation | null, page: Page): void;

  /**
   * Navigate to the app. This is used when the user comes from
   * login/register/connect page.
   *
   *      if {@link goto} is defined then navigate to that page.
   *      else use defaultHref, that is personal page/
   */
  navigateToApp(options?: { defaultHref?: string; forceRefresh?: boolean }): Promise<void>;

  setCurrentRoute(route?: RouteName): void;

  onPageChanged(listener: Listener<Page | undefined>): void;

  getRouteFromPage(page: Page): RouteName | undefined;
};

export class RouterService extends BaseClass implements RouterServiceInterface {
  history = $state<Page[]>([]);
  initialized = $state(false);
  currentPathName = $state<string | undefined>();

  private readonly _pageChangedListener = this.createLiteObserver<Page | undefined>();

  private _goto: GoTo | undefined;
  private _pageValue = $state<Page | undefined>();
  private _navigating = $state<Navigation | undefined>();
  private _currentRoute = $state<RouteName | undefined>();
  private _lastSyncedUrl = '';
  private _lastNavType: string | undefined = undefined;
  private readonly _redirectToKey = REDIRECT_TO_URL_SEARCH_PARAM_KEY;

  protected get redirectToHref(): string | undefined {
    const { searchParams } = this.url;
    const redirectToHref = searchParams.get(this._redirectToKey);
    if (!redirectToHref) {
      return undefined;
    }
    return redirectToHref;
  }

  async goToHref(goto: string): Promise<void> {
    this.log('goToHref', { goto });
    if (!this._goto) {
      throw toAppError({ errorType: 'internal', errorMessage: 'RouterService is not initialized' });
    }

    return await this._goto(goto);
  }
  async goToRoute<T extends RouteName>(
    route: T,
    options: RouteOptions & {
      queryParameters: AllRoutes[T]['queryParameters'];
      pathParameters: PathParameters<T>;
    },
  ): Promise<void> {
    this.log('goToRoute', options);

    const href = this.toRouteHref(route, {
      ...options,
      url: this.url,
    });

    this.log('goToRoute:href', href);
    return await this.goToHref(href);
  }

  async goToDevRoute(devPath: string): Promise<void> {
    const path = devPath.startsWith('/') ? devPath : `/${devPath}`;
    return await this.goToHref(`/dev${path}`);
  }

  onPageChanged(listener: Listener<Page | undefined>): void {
    this._pageChangedListener.subscribe(listener);
  }

  get previousPage(): Page | undefined {
    return this.history[this.history.length - 2];
  }

  setCurrentRoute(route?: RouteName): void {
    if (route === this._currentRoute) {
      return;
    }
    this.log('setCurrentRoute', { route });
    this._currentRoute = route;
  }

  get url(): URL {
    if (!this._pageValue) {
      throw toAppError({
        errorType: 'internal',
        errorMessage: 'RouterService not initialized or page not set',
      });
    }
    return this._pageValue.url;
  }
  get searchParams(): URLSearchParams {
    return this.url.searchParams;
  }

  get isNavigating(): boolean {
    return !!this._navigating?.type;
  }

  get navigatingToRoute(): RouteName | undefined {
    if (!this._navigating?.to) {
      return undefined;
    }

    const { to } = this._navigating;
    const route = to.route.id
      ? this.toRoutePathFromRouteId(to.route.id)
      : toRoutePathFromURL(to.url);
    return route as RouteName;
  }

  get currentRoute(): RouteName | undefined {
    return this.navigatingToRoute ?? this._currentRoute;
  }
  get $currentRoute(): RouteName | undefined {
    return this.currentRoute;
  }

  toRouteHref<T extends RouteName>(
    route: T,
    options: RouteOptions & {
      queryParameters: AllRoutes[T]['queryParameters'];
      pathParameters: PathParameters<T>;
      url: URL | undefined;
    },
  ): string {
    return toRouteHref(route, {
      ...options,
      redirectToKey: this._redirectToKey,
      url: options.url ?? this.url,
    });
  }

  toRoutePathFromRouteId(routeId: string): RouteName | undefined {
    // Memoized in toRoutePathFromRouteId (router-utils.ts) — O(1) after first call.
    // Debug log removed: this getter fires 40+ times per navigation otherwise.
    return toRoutePathFromRouteId(routeId);
  }
  private _isNavigatingToApp = false;

  async navigateToApp(options?: { defaultHref?: string; forceRefresh?: boolean }): Promise<void> {
    this.log('navigateToApp', { _isNavigatingToApp: this._isNavigatingToApp });

    if (this._isNavigatingToApp) {
      return;
    }
    const { defaultHref, forceRefresh } = options ?? {};
    this._isNavigatingToApp = true;

    const redirectToHref = this.redirectToHref;
    this.log('navigateToApp', {
      defaultHref,
      redirectToHref,
    });
    if (
      redirectToHref &&
      redirectToHref !== '/' &&
      !redirectToHref.startsWith('/login') &&
      !redirectToHref.startsWith('/invite') &&
      !redirectToHref.startsWith('/register')
    ) {
      if (forceRefresh) {
        globalThis.window.open(redirectToHref, '_self');
      } else {
        await this.goToHref(redirectToHref);
      }
    } else {
      if (forceRefresh) {
        globalThis.window.open(
          defaultHref ??
            this.toRouteHref('settings', {
              pathParameters: undefined,
              queryParameters: undefined,
              url: this.url,
            }),
        );
      } else {
        await (defaultHref
          ? this.goToHref(defaultHref)
          : this.goToRoute('settings', {
              pathParameters: undefined,
              queryParameters: undefined,
            }));
      }
    }

    this._isNavigatingToApp = false;
  }

  initialize(options: { goto: GoTo; page: Page }): void {
    this.log('initialize', options);
    this._goto = options.goto;
    this.initialized = true;
    const currentRoute = this.getRouteFromPage(options.page);
    if (currentRoute) {
      this._currentRoute = currentRoute;
    }
  }

  getRouteFromPage(page: Page): RouteName | undefined {
    return page.route.id
      ? this.toRoutePathFromRouteId(page.route.id)
      : toRoutePathFromURL(page.url);
  }

  /**
   * Must be called from a reactive context (inside $effect) so Svelte
   * tracks changes to `navigating` and `page` from `$app/state`.
   *
   * The caller passes the reactive values directly — not through a
   * captured parameter — so the $effect re-runs when navigation
   * starts and ends.
   */
  syncNavigation(navigating: Navigation | null, page: Page): void {
    // Guard: skip if page URL hasn't changed. Prevents infinite loops
    // during SSR hydration where $app/state may return new page references
    // for the same route, triggering this effect repeatedly.
    const urlKey = `${page.url.pathname}${page.url.search}`;
    const navType = navigating?.type; // Will be null when NOT navigating
    this.debug('syncNavigation', {
      urlKey,
      navType,
    });

    // Guard: Prevent loops by checking if the URL and active navigation type are unchanged
    if (urlKey === this._lastSyncedUrl && navType === this._lastNavType) {
      return;
    }
    this._lastSyncedUrl = urlKey;
    this._lastNavType = navType ?? undefined;

    untrack(() => {
      this._navigating = navigating ?? undefined;
      this._pageValue = page;

      this.log('page changed:routeId', page.route.id);

      const currentRoute = page.route.id
        ? this.toRoutePathFromRouteId(page.route.id)
        : toRoutePathFromURL(page.url);

      this.log('page changed:route', currentRoute);

      if (!currentRoute) {
        this.warn('Page has no route');
        return;
      }

      this.setCurrentRoute(currentRoute);
      this.currentPathName = page.url.pathname;

      this._pushPageToHistory(page);

      const prev = this.previousPage;
      this._pageChangedListener.publish(prev);
    });
  }

  private _pushPageToHistory(route: Page): void {
    this.history.push(route);
    if (this.history.length > 50) {
      this.history.shift();
    }
  }
}

export const routerService: RouterServiceInterface = RouterService.create({
  className: 'RouterService',
});
