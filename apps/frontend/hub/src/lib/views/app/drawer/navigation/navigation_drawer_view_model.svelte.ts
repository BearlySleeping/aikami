// apps/frontend/hub/src/lib/views/app/drawer/navigation/navigation_drawer_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
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
  readonly navigationItems: NavigationSection[];
  readonly isNavigating: boolean;
  goToRoute(route: RouteName): Promise<void>;
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

    if (this._cachedNavigationItems && this._lastCurrentRoute === currentRoute) {
      return this._cachedNavigationItems;
    }

    this._lastCurrentRoute = currentRoute;
    const isCatalogRoute =
      currentRoute === 'catalog' ||
      currentRoute === 'catalogCategory' ||
      currentRoute === 'catalogAsset';
    this._cachedNavigationItems = [
      {
        title: 'Navigation',
        items: [
          {
            label: 'Catalog',
            icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
            route: 'catalog' as const,
            active: isCatalogRoute,
          },
          {
            label: 'Map Studio',
            icon: 'M9 20l-5.447-2.724A1 1 0 014 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
            route: 'mapStudio' as const,
            active: currentRoute === 'mapStudio',
          },
          {
            label: 'Dashboard',
            icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
            route: 'dashboard' as const,
            active: currentRoute === 'dashboard',
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
    try {
      await routerService.goToRoute(route, {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('goToRoute', error);
    }
  }

  async logout(): Promise<void> {
    try {
      await authService.signOut();
      // Only navigate after sign-out succeeds (matching AppBarViewModel).
      await routerService.goToRoute('login', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('logout', error);
    }
  }
}

export const getNavigationDrawerViewModel = (
  options: NavigationDrawerViewModelOptions,
): NavigationDrawerViewModelInterface => NavigationDrawerViewModel.create(options);
