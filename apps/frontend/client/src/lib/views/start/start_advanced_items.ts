// apps/frontend/client/src/lib/views/start/start_advanced_items.ts
//
// C-512: the start menu's Advanced section. Extracted from StartViewModel so
// the entry copy lives next to the actions it triggers and the ViewModel stays
// inside its source-size budget.
//
// Contract: C-405 AC-4 (world generation), C-512 (Creator Studio)

/** An entry in the Advanced section of the start menu. */
export type AdvancedEntry = {
  /** Button label. */
  readonly label: string;
  /** Description shown below the button. */
  readonly description: string;
  /** Optional external URL for the entry button. */
  readonly buttonHref?: string;
  /** Optional external link shown at the end of the description. */
  readonly href?: string;
  /** Label for the external description link. */
  readonly hrefLabel?: string;
  /** Action to invoke when the button is clicked. */
  readonly action?: () => void;
};

/** The actions the Advanced entries invoke — supplied by StartViewModel. */
export type StartAdvancedActions = {
  /** C-405 AC-4: world-generation preview. */
  openWorldGeneration(): void;
  /** C-512: the Creator Studio. */
  openCreatorStudio(): void;
  /** The dev tools hub. */
  openDevTools(): void;
};

/**
 * Builds the Advanced section entries.
 *
 * The action wrappers are arrow functions so `this` stays bound to the
 * ViewModel that supplied them.
 */
export const buildAdvancedItems = (actions: StartAdvancedActions): readonly AdvancedEntry[] => [
  {
    label: 'Creator Studio',
    description:
      'Generate your own portraits, props and scenes with the local engine, then keep them in your library.',
    action: () => {
      actions.openCreatorStudio();
    },
  },
  {
    label: 'World Generation (Preview)',
    description:
      'Generates a world preview that is not yet playable — used to prototype story content. See',
    href: 'https://github.com/BearlySleeping/aikami/issues/81',
    hrefLabel: 'issue #81',
    action: () => {
      actions.openWorldGeneration();
    },
  },
  {
    label: 'Dev Tools',
    description: 'Access developer tools, sandboxes, and experimental features.',
    action: () => {
      actions.openDevTools();
    },
  },
  {
    label: 'Hub',
    description: 'Browse community content and open the Aikami Hub.',
    buttonHref: import.meta.env.PUBLIC_HUB_PAGE_URL,
  },
];
