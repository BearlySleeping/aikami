// apps/frontend/client/src/lib/views/app/bar/app-bar-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import t from '$i18n';
import type { RouteName } from '$router';
import { appService, authService, routerService } from '$services';

export type ProfileMenuOption = {
  icon: string;
  text: string;
  click: () => void;
};

export type AppBarViewModelOptions = BaseViewModelOptions;

export type AppBarViewModelInterface = BaseViewModelInterface & {
  /**
   * Whether the user is logged in.
   */
  readonly isLoggedIn: boolean;

  /**
   * The current user.
   */
  readonly currentUser: CurrentUser | undefined;

  /**
   * The current route.
   */
  readonly currentRoute: string | undefined;

  /**
   * The options for the profile menu.
   */
  readonly profileMenuOptions: ProfileMenuOption[];

  /**
   * The title of the app bar.
   */
  readonly appBarTitle: string | undefined;

  /**
   * Whether to show the drawer button.
   */
  readonly showDrawerButton: boolean;

  /**
   * Navigates to the home page.
   */
  goToHome(): Promise<void>;

  /**
   * Navigates to the login page.
   */
  goToLogin(): Promise<void>;

  /**
   * Navigates to the register page.
   */
  goToRegister(): Promise<void>;

  /**
   * Navigates to the profile page.
   */
  goToProfile(): Promise<void>;

  /**
   * Navigates to the settings page.
   */
  goToSettings(): Promise<void>;

  /**
   * Logs out the current user.
   */
  logout(): Promise<void>;

  toggleNavigationDrawer(): void;
};

class AppBarViewModel
  extends BaseViewModel<AppBarViewModelOptions>
  implements AppBarViewModelInterface
{
  get isLoggedIn() {
    return authService.isLoggedIn;
  }

  get currentUser() {
    return authService.currentUser;
  }

  get currentRoute() {
    return routerService.currentRoute;
  }

  get showDrawerButton() {
    if (!this.currentUser) {
      return false;
    }

    if (!this.currentRoute) {
      return true;
    }

    const publicRoutes: RouteName[] = ['login', 'register'];
    return !publicRoutes.includes(this.currentRoute);
  }

  get appBarTitle() {
    switch (this.currentRoute) {
      case 'settings':
        return t.settings();
      case 'login':
        return t.login();
      case 'register':
        return t.register();
      default:
        return undefined;
    }
  }

  get profileMenuOptions(): ProfileMenuOption[] {
    return [
      {
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
        text: t.profile(),
        click: () => this.goToProfile(),
      },
      {
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37... ', // truncated for brevity
        text: t.settings() || 'Settings',
        click: () => this.goToSettings(),
      },
      {
        icon: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
        text: t.logout() || 'Logout',
        click: () => this.logout(),
      },
    ];
  }

  toggleNavigationDrawer(): void {
    appService.toggleNavigationDrawer();
  }

  async goToHome(): Promise<void> {
    if (this.isLoggedIn) {
      await routerService.goToRoute('settings', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } else {
      await routerService.goToRoute('settings', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    }
  }

  async goToLogin(): Promise<void> {
    await routerService.goToRoute('login', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async goToRegister(): Promise<void> {
    await routerService.goToRoute('register', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async goToProfile(): Promise<void> {
    await routerService.goToRoute('settings', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async goToSettings(): Promise<void> {
    await routerService.goToRoute('settings', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async logout(): Promise<void> {
    try {
      await authService.signOut();
      await this.goToLogin();
    } catch (err) {
      this.error('Failed to logout', err);
    }
  }
}

export const getAppBarViewModel = (options: AppBarViewModelOptions): AppBarViewModelInterface =>
  new AppBarViewModel(options);
