// apps/frontend/hub/src/lib/views/app/bar/app_bar_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import type { RouteName } from '$router';
import { appService, authService, routerService } from '$services';

export type ProfileMenuOption = {
  icon: string;
  text: string;
  click: () => void;
};

export type AppBarViewModelOptions = BaseViewModelOptions;

export type AppBarViewModelInterface = BaseViewModelInterface & {
  readonly isLoggedIn: boolean;
  readonly currentUser: CurrentUser | undefined;
  readonly currentRoute: string | undefined;
  readonly profileMenuOptions: ProfileMenuOption[];
  readonly appBarTitle: string | undefined;
  readonly showDrawerButton: boolean;
  readonly menuOpen: boolean;

  toggleMenu(): void;
  closeMenu(): void;
  goToHome(): Promise<void>;
  goToLogin(): Promise<void>;
  goToDashboard(): Promise<void>;
  logout(): Promise<void>;
  toggleNavigationDrawer(): void;
};

class AppBarViewModel
  extends BaseViewModel<AppBarViewModelOptions>
  implements AppBarViewModelInterface
{
  menuOpen = $state(false);

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

    const publicRoutes: RouteName[] = ['login'];
    return !publicRoutes.includes(this.currentRoute);
  }

  get appBarTitle() {
    switch (this.currentRoute) {
      case 'dashboard':
        return 'Dashboard';
      case 'login':
        return 'Login';
      default:
        return undefined;
    }
  }

  get profileMenuOptions(): ProfileMenuOption[] {
    return [
      {
        icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2V7zm16 4l-4-4h8l-4 4z',
        text: 'Dashboard',
        click: () => this.goToDashboard(),
      },
      {
        icon: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
        text: 'Logout',
        click: () => this.logout(),
      },
    ];
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  toggleNavigationDrawer(): void {
    appService.toggleNavigationDrawer();
  }

  async goToHome(): Promise<void> {
    try {
      await routerService.goToRoute('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToHome', error);
    }
  }

  async goToLogin(): Promise<void> {
    try {
      await routerService.goToRoute('login', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToLogin', error);
    }
  }

  async goToDashboard(): Promise<void> {
    try {
      await routerService.goToRoute('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToDashboard', error);
    }
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
  AppBarViewModel.create(options);
