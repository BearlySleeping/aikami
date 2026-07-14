// apps/frontend/client/src/lib/views/dev/layout/layout_view_model.dev.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { authService } from '$services';

// ── Default icons ───────────────────────────────────────────────────────

const DEFAULT_ICON = 'M4 6h16M4 12h16M4 18h7' as const;

const DEFAULT_SANDOX_ICON =
  'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' as const;

// ── Top-level routes (custom labels/icons) ──────────────────────────────

const CUSTOM: Record<string, { label: string; icon: string }> = {
  '/dev/config': {
    label: 'Config',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
  '/dev/text': {
    label: 'Text',
    icon: 'M4 6h16M4 12h16M4 18h7',
  },
  '/dev/voice': {
    label: 'Voice',
    icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4',
  },
  '/dev/image': {
    label: 'Image',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14',
  },
  '/dev/audio': {
    label: 'Audio',
    icon: 'M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z',
  },
  '/dev/character': {
    label: 'Character',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  '/dev/chat': {
    label: 'Chat',
    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  },
  '/dev/lpc': {
    label: 'LPC',
    icon: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z',
  },
  '/dev/combat': {
    label: 'Combat',
    icon: 'M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
  },
  '/dev/inventory': {
    label: 'Inventory',
    icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM12 3a3 3 0 013 3M9 3a3 3 0 013-3',
  },
  '/dev/quest': {
    label: 'Quest',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  '/dev/save_load': {
    label: 'Save/Load',
    icon: 'M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4',
  },
  '/dev/settings': {
    label: 'Settings',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
  '/dev/dialogs': {
    label: 'Dialogs',
    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  },
  '/dev/vendor': {
    label: 'Vendor',
    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
  },
};

// ── Sandbox sub-routes (hardcoded — SvelteKit virtualizes routes, glob can't see them) ──

const SANDBOX_CHILDREN: DevNavItem[] = [
  { route: '/dev/sandbox', label: 'Sandbox', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/camera', label: 'Camera', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/combat', label: 'Combat', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/dialogue', label: 'Dialogue', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/environment', label: 'Environment', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/map', label: 'Map', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/mode', label: 'Mode', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/party-follow', label: 'Party follow', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/vendor', label: 'Vendor', icon: DEFAULT_ICON },
  { route: '/dev/sandbox/zone-transition', label: 'Zone transition', icon: DEFAULT_ICON },
];

// ── Derive nav items ────────────────────────────────────────────────────

const _deriveNavItems = (): readonly DevNavItem[] => {
  const items: DevNavItem[] = Object.entries(CUSTOM)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([route, { label, icon }]) => ({ route, label, icon }));

  items.push({
    route: '/dev/sandbox',
    label: 'Sandbox',
    icon: DEFAULT_SANDOX_ICON,
    children: SANDBOX_CHILDREN,
  });

  return items;
};

/** Navigation item for the dev console drawer. */
export type DevNavItem = {
  readonly route: string;
  readonly label: string;
  readonly icon: string;
  readonly children?: readonly DevNavItem[];
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

  get navItems(): readonly DevNavItem[] {
    return _deriveNavItems();
  }

  get activeRoute(): string {
    return page.url.pathname;
  }

  toggleDrawer(): void {
    this.isDrawerOpen = !this.isDrawerOpen;
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    await authService.initialize();
    await super.initialize();
  }
}

export const getDevViewModel = (options: DevViewModelOptions): DevViewModelInterface =>
  new DevViewModel(options);

/** @deprecated Use {@link DevViewModelInterface.navItems} instead. */
export const NAV_ITEMS = _deriveNavItems();
