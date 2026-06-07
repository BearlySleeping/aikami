// apps/frontend/pwa/src/lib/views/dev/dev_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';

/** Navigation item for the dev console drawer. */
export type DevNavItem = {
  readonly route: string;
  readonly label: string;
  readonly icon: string;
};

export type DevViewModelInterface = BaseViewModelInterface & {
  readonly navItems: readonly DevNavItem[];
  readonly isDrawerOpen: boolean;
  readonly activeRoute: string;
  toggleDrawer(): void;
};

export type DevViewModelOptions = BaseViewModelOptions & {};

class DevViewModel extends BaseViewModel<DevViewModelOptions> implements DevViewModelInterface {
  isDrawerOpen = $state(false);

  private static readonly _NAV_ITEMS: readonly DevNavItem[] = [
    {
      route: '/dev/text',
      label: 'Text',
      icon: 'M4 6h16M4 12h16M4 18h7',
    },
    {
      route: '/dev/voice',
      label: 'Voice',
      icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4',
    },
    {
      route: '/dev/image',
      label: 'Image',
      icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14',
    },
    {
      route: '/dev/character',
      label: 'Character',
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    },
    {
      route: '/dev/sandbox',
      label: 'Sandbox',
      icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
    },
    {
      route: '/dev/lpc',
      label: 'LPC',
      icon: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z',
    },
  ] as const;

  get navItems(): readonly DevNavItem[] {
    return DevViewModel._NAV_ITEMS;
  }

  get activeRoute(): string {
    return page.url.pathname;
  }

  toggleDrawer(): void {
    this.isDrawerOpen = !this.isDrawerOpen;
  }
}

export const getDevViewModel = (options: DevViewModelOptions): DevViewModelInterface =>
  new DevViewModel(options);
