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

// ── Custom icons for specific routes ────────────────────────────────────

const CUSTOM_ICONS: Record<string, string> = {
  '/dev/config':
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  '/dev/text': 'M4 6h16M4 12h16M4 18h7',
  '/dev/voice': 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4',
  '/dev/image': 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14',
  '/dev/audio': 'M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z',
  '/dev/character': 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  '/dev/chat': 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  '/dev/lpc': 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z',
  '/dev/combat': 'M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
  '/dev/inventory': 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM12 3a3 3 0 013 3M9 3a3 3 0 013-3',
  '/dev/quest': 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  '/dev/save_load': 'M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4',
  '/dev/settings':
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  '/dev/dialogs': 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  '/dev/vendor': 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
};

// ── Custom labels for routes that need non-default formatting ───────────

const CUSTOM_LABELS: Record<string, string> = {
  '/dev/save_load': 'Save/Load',
  '/dev/agent-editor': 'Agent Editor',
  '/dev/agent-pipeline': 'Agent Pipeline',
  '/dev/asset-browser': 'Asset Browser',
  '/dev/character-sheet': 'Character Sheet',
  '/dev/combat-enhancements': 'Combat Enhancements',
  '/dev/gm-system': 'GM System',
  '/dev/image-gen': 'Image Gen',
  '/dev/lpc': 'LPC',
  '/dev/lpc-ai': 'LPC AI',
  '/dev/lpc-inventory': 'LPC Inventory',
  '/dev/lpc-preview': 'LPC Preview',
  '/dev/lpc-walk': 'LPC Walk',
  '/dev/tauri-test': 'Tauri Test',
  '/dev/world-gen': 'World Gen',
  // Sandbox sub-routes
  '/dev/sandbox/party-follow': 'Party follow',
  '/dev/sandbox/zone-transition': 'Zone transition',
  '/dev/sandbox/chat-c424': 'Chat C424',
};

// ── Helpers ─────────────────────────────────────────────────────────────

/** Derive a human-readable label from a URL path. */
const _pathToLabel = (path: string): string => {
  if (CUSTOM_LABELS[path]) return CUSTOM_LABELS[path];
  const segment = path.replace('/dev/', '');
  return segment
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// ── Derive nav items from filesystem routes ─────────────────────────────

/**
 * Convert a Vite-globbed file path to a URL path.
 * e.g. `/src/routes/(dev)/dev/config/+page.svelte` → `/dev/config`
 * e.g. `/src/routes/(dev)/dev/(sandbox)/sandbox/camera/+page.svelte` → `/dev/sandbox/camera`
 */
const _filePathToRoute = (filePath: string): string => {
  // Strip everything before the first /dev/ and the trailing /+page.svelte
  const match = filePath.match(/\/dev\/(.+)\/\+page\.svelte$/);
  if (!match) return '';
  // Remove route-group segments like (sandbox)/ from the path
  return '/dev/' + match[1].replace(/\([^)]+\)\//g, '');
};

const _deriveNavItems = (): readonly DevNavItem[] => {
  // Discover all dev route page files via Vite glob (works in dev & production)
  // Note: parens in route-group dirs must be escaped for fast-glob (extglob syntax)
  const routeModules = import.meta.glob('/src/routes/\\(dev\\)/dev/**/+page.svelte');

  const allRoutes = Object.keys(routeModules)
    .map(_filePathToRoute)
    .filter((r): r is string => r.length > 0 && r !== '/dev');

  // Separate sandbox routes from top-level routes
  const sandboxRoutes = allRoutes.filter((r) => r.startsWith('/dev/sandbox/'));
  const devRoutes = allRoutes.filter((r) => !r.startsWith('/dev/sandbox/'));

  // Build top-level items
  const items: DevNavItem[] = devRoutes
    .map((path) => ({
      route: path,
      label: _pathToLabel(path),
      icon: CUSTOM_ICONS[path] ?? DEFAULT_ICON,
    }))
    .sort((a, b) => a.route.localeCompare(b.route));

  // Build sandbox children (include the sandbox index page as first child)
  const sandboxChildren: DevNavItem[] = [
    { route: '/dev/sandbox', label: 'Sandbox', icon: DEFAULT_ICON },
    ...sandboxRoutes
      .map((path) => ({
        route: path,
        label: _pathToLabel(path),
        icon: DEFAULT_ICON,
      }))
      .sort((a, b) => a.route.localeCompare(b.route)),
  ];

  items.push({
    route: '/dev/sandbox',
    label: 'Sandbox',
    icon: DEFAULT_SANDOX_ICON,
    children: sandboxChildren,
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

/** Use {@link DevViewModelInterface.navItems} instead. */
export const NAV_ITEMS = _deriveNavItems();
