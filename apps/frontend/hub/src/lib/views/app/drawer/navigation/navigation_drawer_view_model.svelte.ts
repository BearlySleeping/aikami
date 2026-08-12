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
    this._cachedNavigationItems = [
      {
        title: 'Navigation',
        items: [
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
