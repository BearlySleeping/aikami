// apps/frontend/pwa/src/lib/views/app/drawer/navigation/navigation-drawer-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import t from '$i18n';
import type { RouteName } from '$router';
import { authService, routerService } from '$services';

export type NavigationItem = {
  label: string;
  icon: string;
  route: RouteName;
  active: boolean;
};

export type NavigationSection = {
  title: string;
  items: NavigationItem[];
};

export type NavigationDrawerViewModelOptions = BaseViewModelOptions;

export type NavigationDrawerViewModelInterface = BaseViewModelInterface & {
  /**
   * The navigation sections.
   */
  readonly navigationItems: NavigationSection[];

  /**
   * Whether the app is currently navigating.
   */
  readonly isNavigating: boolean;

  /**
   * Navigates to a route.
   * @param route The route to navigate to.
   */
  goToRoute(route: RouteName): Promise<void>;

  /**
   * Logs out the current user.
   */
  logout(): Promise<void>;
};

class NavigationDrawerViewModel
  extends BaseViewModel<NavigationDrawerViewModelOptions>
  implements NavigationDrawerViewModelInterface
{
  private _cachedNavigationItems: NavigationSection[] | undefined;
  private _lastCurrentRoute: RouteName | undefined;

  get navigationItems(): NavigationSection[] {
    const currentRoute = routerService.currentRoute;

    // Use cached value if route hasn't changed
    if (this._cachedNavigationItems && this._lastCurrentRoute === currentRoute) {
      return this._cachedNavigationItems;
    }

    this._lastCurrentRoute = currentRoute;
    this._cachedNavigationItems = [
      {
        title: t.navigation(),
        items: [
          {
            label: t.home(),
            icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' as const,
            route: 'dashboard' as const,
            active: routerService.currentRoute === 'dashboard',
          },
          {
            label: t.npcs(),
            icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' as const,
            route: 'npcs' as const,
            active: routerService.currentRoute === 'npcs',
          },
          {
            label: t.personas(),
            icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' as const,
            route: 'personas' as const,
            active: routerService.currentRoute === 'personas',
          },
          {
            label: t.settings(),
            icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' as const,
            route: 'settings' as const,
            active: routerService.currentRoute === 'settings',
          },
        ],
      },
    ];

    return this._cachedNavigationItems;
  }

  get isNavigating(): boolean {
    return routerService.isNavigating;
  }

  async goToRoute(route: RouteName): Promise<void> {
    await routerService.goToRoute(route, {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  async logout(): Promise<void> {
    await authService.signOut();
  }
}

export const getNavigationDrawerViewModel = (
  options: NavigationDrawerViewModelOptions,
): NavigationDrawerViewModelInterface => new NavigationDrawerViewModel(options);
