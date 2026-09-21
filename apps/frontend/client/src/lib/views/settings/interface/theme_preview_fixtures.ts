// apps/frontend/client/src/lib/views/settings/interface/theme_preview_fixtures.ts
//
// C-529 AC-2 — production-safe inert preview fixtures for the theme editor.
//
// 🔴 These are NOT the dev sandbox fixtures under `views/dev/obsidian/`. That
// sandbox is context only: its fixtures are imported nowhere outside it and must
// not become a production dependency. These are small, static, escaped strings
// that exercise the trusted component classes with no gameplay state, no service
// call and no external request — previewing a theme cannot run a command or
// reach the network, because there is nothing here that could.
//
// The four contexts are the ones the contract names: Explore, Dialogue,
// Inventory and Combat.

/** Identifier of a preview context. */
export type ThemePreviewContextId = 'explore' | 'dialogue' | 'inventory' | 'combat';

/** One inert preview context. All fields are static display data. */
export type ThemePreviewContext = {
  readonly id: ThemePreviewContextId;
  readonly label: string;
  /** Heading rendered in the surface panel. */
  readonly title: string;
  /** Body copy — the longest realistic line, to expose text contrast. */
  readonly body: string;
  /** Action labels rendered as real control-shaped elements. */
  readonly actions: readonly string[];
  /** A status strip, so the status role colors are exercised. */
  readonly status: {
    readonly label: string;
    readonly tone: 'info' | 'success' | 'warning' | 'error';
  };
  /** A progress row, so the accent role is exercised on a large surface. */
  readonly progress: { readonly label: string; readonly percent: number };
  /** A list row, so borders/corners and muted text are exercised. */
  readonly listRow: { readonly name: string; readonly meta: string };
};

/** The four contexts the editor previews, in display order. */
export const THEME_PREVIEW_CONTEXTS: readonly ThemePreviewContext[] = [
  {
    id: 'explore',
    label: 'Explore',
    title: 'Emberwatch Crossing',
    body: 'A cold wind carries ash across the square. The innkeeper watches you from the doorway.',
    actions: ['Talk', 'Travel', 'Rest'],
    status: { label: 'Objective updated', tone: 'info' },
    progress: { label: 'Distance to Emberwatch', percent: 42 },
    listRow: { name: 'Rusted lantern', meta: 'Worn · 2 lb' },
  },
  {
    id: 'dialogue',
    label: 'Dialogue',
    title: 'Innkeeper Maren',
    body: '“You look like you have walked a long road. Sit. Tell me what brought you to the crossing.”',
    actions: ['Ask about the road', 'Ask about the ash', 'Leave'],
    status: { label: 'Reputation: friendly', tone: 'success' },
    progress: { label: 'Conversation depth', percent: 68 },
    listRow: { name: 'Maren the Innkeeper', meta: 'Neutral · Watcher' },
  },
  {
    id: 'inventory',
    label: 'Inventory',
    title: 'Pack',
    body: 'Twelve of sixteen slots used. Two items are marked for the next expedition.',
    actions: ['Equip', 'Drop', 'Sort'],
    status: { label: 'Overloaded soon', tone: 'warning' },
    progress: { label: 'Carry weight', percent: 81 },
    listRow: { name: 'Cracked wardstone', meta: 'Fragile · 1 lb' },
  },
  {
    id: 'combat',
    label: 'Combat',
    title: 'Ash Wraith',
    body: 'The wraith recoils from the lantern light, its edges thinning into the dark.',
    actions: ['Strike', 'Guard', 'Flee'],
    status: { label: 'Burning (2 turns)', tone: 'error' },
    progress: { label: 'Enemy health', percent: 27 },
    listRow: { name: 'Ash Wraith', meta: 'Vulnerable · Lantern' },
  },
];

/** Tailwind badge class for a status tone. */
export const previewBadgeClass = (tone: ThemePreviewContext['status']['tone']): string => {
  switch (tone) {
    case 'info':
      return 'badge-info';
    case 'success':
      return 'badge-success';
    case 'warning':
      return 'badge-warning';
    case 'error':
      return 'badge-error';
  }
};
