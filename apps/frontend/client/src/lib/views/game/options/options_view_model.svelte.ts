// apps/frontend/client/src/lib/views/game/options/options_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptionsTabId = 'game' | 'keybinding' | 'config';

export type OptionsTab = {
  readonly id: OptionsTabId;
  readonly label: string;
};

const OPTIONS_TABS: OptionsTab[] = [
  { id: 'game', label: 'Game' },
  { id: 'keybinding', label: 'Keybinding' },
  { id: 'config', label: 'Config' },
] as const;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export type OptionsViewModelOptions = BaseViewModelOptions & {
  /** Called when the user clicks "Back to Menu". */
  onBack: () => void;
};

export type OptionsViewModelInterface = BaseViewModelInterface & {
  /** Available tabs. */
  readonly tabs: OptionsTab[];

  /** The currently active tab id. */
  readonly activeTab: OptionsTabId;

  /** Returns to the main menu. */
  backToMenu(): void;

  /** Switches to the given tab. */
  setActiveTab(tab: OptionsTabId): void;
};

class OptionsViewModel
  extends BaseViewModel<OptionsViewModelOptions>
  implements OptionsViewModelInterface
{
  activeTab = $state<OptionsTabId>('game');

  /** @inheritdoc */
  get tabs(): OptionsTab[] {
    return OPTIONS_TABS as unknown as OptionsTab[];
  }

  /** @inheritdoc */
  backToMenu(): void {
    this._options.onBack();
  }

  /** @inheritdoc */
  setActiveTab(tab: OptionsTabId): void {
    this.activeTab = tab;
  }
}

export const getOptionsViewModel = (options: OptionsViewModelOptions): OptionsViewModelInterface =>
  OptionsViewModel.create(options);
