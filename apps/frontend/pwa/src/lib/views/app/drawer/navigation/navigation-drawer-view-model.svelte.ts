import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import t from '$i18n.ts';
import type { RouteName } from '$router';
import { authService, routerService } from '$services/index.ts';

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
  navigationItems = $derived<NavigationSection[]>([
    {
      title: t.navigation(), // TODO: add to i18n
      items: [
        {
          label: t.home(), // TODO: add to i18n
          icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
          route: 'dashboard' as const,
          active: routerService.currentRoute === 'dashboard',
        },
        {
          label: 'Characters', // TODO: add to i18n
          icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
          route: 'characters' as const,
          active: routerService.currentRoute === 'characters',
        },
        {
          label: t.profile(),
          icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
          route: 'profile' as const,
          active: routerService.currentRoute === 'profile',
        },
        {
          label: t.settings(), // TODO: add to i18n
          icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
          route: 'settings' as const,
          active: routerService.currentRoute === 'settings',
        },
      ],
    },
  ]);

  isNavigating = $derived(routerService.isNavigating);

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
