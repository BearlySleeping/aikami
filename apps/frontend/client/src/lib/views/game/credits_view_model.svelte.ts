// apps/frontend/client/src/lib/views/game/credits_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Credit entry types
// ---------------------------------------------------------------------------

export type CreditGroup = {
  /** Group heading (e.g. "Game Engine & ECS"). */
  readonly heading: string;

  /** Projects in this group. */
  readonly items: CreditItem[];
};

export type CreditItem = {
  /** Project name. */
  readonly name: string;

  /** Project URL. */
  readonly url: string;

  /** Short description of how the project is used. */
  readonly description: string;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export type CreditsViewModelOptions = BaseViewModelOptions & {
  /** Called when the user clicks "Back to Menu". */
  onBack: () => void;
};

export type CreditsViewModelInterface = BaseViewModelInterface & {
  /** All credit groups (grouped by domain). */
  readonly groups: CreditGroup[];

  /** Returns to the main menu. */
  backToMenu(): void;
};

const CREDIT_GROUPS: CreditGroup[] = [
  {
    heading: 'Game Engine & ECS',
    items: [
      {
        name: 'PixiJS',
        url: 'https://pixijs.com/',
        description: '2D WebGL rendering engine powering the game world and visual effects.',
      },
      {
        name: 'bitECS',
        url: 'https://bitecs.dev/',
        description:
          'Entity-Component-System architecture driving all game logic and entity management.',
      },
    ],
  },
  {
    heading: 'Frontend Framework',
    items: [
      {
        name: 'Svelte',
        url: 'https://svelte.dev/',
        description:
          'UI framework for the menu system, HUD overlays, and reactive state management.',
      },
      {
        name: 'Tailwind CSS',
        url: 'https://tailwindcss.com/',
        description: 'Utility-first CSS framework for responsive styling across the entire app.',
      },
      {
        name: 'daisyUI',
        url: 'https://daisyui.com/',
        description: 'UI component library built on Tailwind CSS providing themed components.',
      },
    ],
  },
  {
    heading: 'Desktop Application',
    items: [
      {
        name: 'Tauri',
        url: 'https://v2.tauri.app/',
        description:
          'Desktop application framework wrapping the web frontend in a native Rust shell.',
      },
    ],
  },
  {
    heading: 'Assets',
    items: [
      {
        name: 'Universal LPC Spritesheet Character Generator',
        url: 'https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator',
        description:
          'Liberated Pixel Cup character sprites and asset generation for in-game characters.',
      },
    ],
  },
] as const;

class CreditsViewModel
  extends BaseViewModel<CreditsViewModelOptions>
  implements CreditsViewModelInterface
{
  /** @inheritdoc */
  get groups(): CreditGroup[] {
    return CREDIT_GROUPS as unknown as CreditGroup[];
  }

  /** @inheritdoc */
  backToMenu(): void {
    this._options.onBack();
  }
}

export const getCreditsViewModel = (options: CreditsViewModelOptions): CreditsViewModelInterface =>
  CreditsViewModel.create(options);
