import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import { goto } from '$app/navigation';
import { navigating, page } from '$app/state';
import type { RouteName } from '$router';
import { appService, authService, routerService } from '$services/index.ts';
import type { PWAHookData } from '$types/index.ts';

export type AppViewModelOptions = BaseViewModelOptions & {
  data: PWAHookData;
};

export type AppViewModelInterface = BaseViewModelInterface & {
  /**
   * Whether the navigation drawer is enabled.
   */
  readonly navigationDrawerEnabled: boolean;

  /**
   * Whether to show the app bar.
   */
  readonly showAppBar: boolean;

  /**
   * Whether to show the footer.
   */
  readonly showFooter: boolean;

  /**
   * Whether the navigation drawer is minified.
   */
  readonly isNavigationDrawerMinified: boolean;

  /**
   * The current route.
   */
  readonly currentRoute: RouteName | undefined;

  /**
   * Whether the user is logged in.
   */
  readonly isLoggedIn: boolean;

  /**
   * The current user.
   */
  readonly currentUser: CurrentUser | undefined;

  /**
   * Handles the app close event.
   * @param event The before unload event.
   */
  handleAppClose(event: BeforeUnloadEvent): void;

  /**
   * Initializes the view model.
   */
  initialize(): Promise<void>;

  /**
   * Toggles the navigation drawer.
   */
  toggleNavigationDrawer(): void;
};

class AppViewModel extends BaseViewModel<AppViewModelOptions> implements AppViewModelInterface {
  isNavigationDrawerMinified = $state(false);

  constructor(options: AppViewModelOptions) {
    super(options);
    const { userSession, device } = options.data;

    if (userSession) {
      authService.setCurrentUser(userSession);
    }

    if (device) {
      appService.setCurrentDevice(device);
    }
  }

  isLoggedIn = $derived(authService.isLoggedIn);
  currentUser = $derived(authService.currentUser);
  currentRoute = $derived(routerService.currentRoute);
  navigationDrawerEnabled = $derived(this.isLoggedIn);
  showAppBar = true;
  showFooter = false;

  override async initialize(): Promise<void> {
    await super.initialize();

    // Initialize services
    await authService.initialize();

    routerService.initialize({
      goto,
      page,
      navigating,
    });
  }

  handleAppClose(_event: BeforeUnloadEvent): void {}

  toggleNavigationDrawer(): void {
    this.isNavigationDrawerMinified = !this.isNavigationDrawerMinified;
  }
}

export const getAppViewModel = (options: AppViewModelOptions): AppViewModelInterface =>
  new AppViewModel(options);
