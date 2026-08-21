// apps/frontend/client/src/lib/views/chat/slash_command_autocomplete.svelte.ts
//
// Sub-service owning the slash-command autocomplete concern for the chat
// composer. Extracted from chat_view_model.svelte.ts (C-425).
//
// Owns the completion list, the selected index, and the popup visibility
// flag, plus the keyboard navigation / apply logic. It does NOT reach back
// into its parent ViewModel — applying a completion delegates to an injected
// `onApply` callback so the parent decides how to mutate its own input state.
//
// Contract: C-425 ViewModel Decomposition
import { getSlashCompletions, type SlashCommandEntry } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ── Types ────────────────────────────────────────────────────────────────

export type SlashCommandAutocompleteOptions = BaseViewModelOptions & {
  /** Called when a completion is applied — the parent mutates its input. */
  onApply(commandName: string): void;
};

export type SlashCommandAutocompleteInterface = BaseViewModelInterface & {
  /** Slash command completions for the current input. */
  readonly completions: readonly SlashCommandEntry[];
  /** Selected index in the completions list (-1 = nothing selected). */
  readonly selectedIndex: number;
  /** Whether the autocomplete popup should be shown. */
  readonly visible: boolean;
  /** Recomputes completions from the current input text. */
  update(input: string): void;
  /** Moves the selection up (-1) or down (+1), wrapping at the ends. */
  navigate(delta: number): void;
  /** Applies the selected completion (if any) and dismisses the popup. */
  apply(): void;
  /** Selects a completion by index and immediately applies it. */
  selectAndApply(index: number): void;
  /** Dismisses the popup and clears the completion state. */
  dismiss(): void;
};

// ── Implementation ───────────────────────────────────────────────────────

export class SlashCommandAutocomplete
  extends BaseViewModel<SlashCommandAutocompleteOptions>
  implements SlashCommandAutocompleteInterface
{
  completions = $state<readonly SlashCommandEntry[]>([]);
  selectedIndex = $state(-1);
  visible = $state(false);

  private readonly _onApply: (commandName: string) => void;

  constructor(options: SlashCommandAutocompleteOptions) {
    super(options);
    this._onApply = options.onApply;
  }

  /** @inheritdoc */
  update(input: string): void {
    const trimmed = input.trim();
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const matches = getSlashCompletions(trimmed);
      this.completions = matches;
      this.visible = matches.length > 0;
      this.selectedIndex = matches.length > 0 ? 0 : -1;
    } else {
      this.completions = [];
      this.visible = false;
      this.selectedIndex = -1;
    }
  }

  /** @inheritdoc */
  navigate(delta: number): void {
    if (this.completions.length === 0) {
      return;
    }
    const next = this.selectedIndex + delta;
    if (next < 0) {
      this.selectedIndex = this.completions.length - 1;
    } else if (next >= this.completions.length) {
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = next;
    }
  }

  /** @inheritdoc */
  apply(): void {
    if (!this.visible || this.selectedIndex < 0) {
      return;
    }
    const cmd = this.completions[this.selectedIndex];
    if (!cmd) {
      return;
    }
    this._onApply(cmd.name);
    this.visible = false;
    this.completions = [];
    this.selectedIndex = -1;
  }

  /** @inheritdoc */
  selectAndApply(index: number): void {
    this.selectedIndex = index;
    this.apply();
  }

  /** @inheritdoc */
  dismiss(): void {
    this.visible = false;
    this.completions = [];
    this.selectedIndex = -1;
  }
}

export const getSlashCommandAutocomplete = (
  options: SlashCommandAutocompleteOptions,
): SlashCommandAutocompleteInterface => SlashCommandAutocomplete.create(options);
