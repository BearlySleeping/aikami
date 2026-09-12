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

export type NavigationDrawerViewModelOptions = BaseViewModelOptions;

export type NavigationDrawerViewModelInterface = BaseViewModelInterface & {
  readonly navigationItems: NavigationItem[];
  readonly isNavigating: boolean;
  readonly isLoggedIn: boolean;
  goToRoute(route: RouteName): Promise<void>;
  logout(): Promise<void>;
};

class NavigationDrawerViewModel
  extends BaseViewModel<NavigationDrawerViewModelOptions>
  implements NavigationDrawerViewModelInterface
{
  private _cachedNavigationItems: NavigationItem[] | undefined;
  private _lastNavKey: string | undefined;

  get isLoggedIn(): boolean {
    return authService.isLoggedIn;
  }

  get navigationItems(): NavigationItem[] {
    const currentRoute = routerService.currentRoute;
    const navKey = `${currentRoute}:${this.isLoggedIn ? 'in' : 'out'}`;

    if (this._cachedNavigationItems && this._lastNavKey === navKey) {
      return this._cachedNavigationItems;
    }

    this._lastNavKey = navKey;
    const isCatalogRoute =
      currentRoute === 'catalog' ||
      currentRoute === 'catalogCategory' ||
      currentRoute === 'catalogAsset';
    const items: NavigationItem[] = [
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
        label: 'LPC Preview',
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
        route: 'lpcPreview' as const,
        active: currentRoute === 'lpcPreview' || currentRoute === 'lpcPreviewAsset',
      },
    ];

    // Dashboard is the authenticated landing; anonymous visitors get the
    // public tools only.
    if (this.isLoggedIn) {
      items.push({
        label: 'Dashboard',
        icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
        route: 'dashboard' as const,
        active: currentRoute === 'dashboard',
      });
    }

    this._cachedNavigationItems = items;

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
