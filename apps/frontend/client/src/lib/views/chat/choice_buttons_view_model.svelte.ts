// apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.svelte.ts
//
// ViewModel for the CYOA choice buttons rendered below the latest AI
// message. Thin bridge: exposes display-ready choice data and delegates
// selection to a callback provided by the parent (chat ViewModel).
//
// Contract: C-245 CYOA Choices Branching Narrative

import { CYOA_LABEL_MAX_LENGTH, CYOA_SINGLE_CHOICE_LABEL } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CyoaChoice } from '@aikami/types';

// ── Types ────────────────────────────────────────────────────────────────

/** Display-ready choice item (label truncated, badge pre-formatted). */
export type ChoiceButtonItem = {
  /** Choice ID. */
  id: string;
  /** Truncated label safe for button display. */
  displayLabel: string;
  /** Full label for tooltip when truncated (empty when not truncated). */
  tooltip: string;
  /** Pre-formatted skill check badge text (empty when none). */
  badgeText: string;
};

export type ChoiceButtonsViewModelOptions = BaseViewModelOptions & {
  /** The choices to render. */
  choices: CyoaChoice[];
  /** Called when the user selects a choice. */
  onSelect(choice: CyoaChoice): void;
};

export type ChoiceButtonsViewModelInterface = BaseViewModelInterface & {
  /** Display-ready choice items. */
  readonly items: ReadonlyArray<ChoiceButtonItem>;
  /** Whether the buttons should render at all (>= 1 choice, not dismissed). */
  readonly visible: boolean;
  /** Whether the buttons are disabled (a choice was already selected). */
  readonly disabled: boolean;
  /** Selects a choice by ID — disables all buttons and fires onSelect. */
  selectChoice(choiceId: string): void;
  /** Dismisses the choice set without selecting (stale choices). */
  dismiss(): void;
  /** Replaces the current choice set (e.g. on branch swipe). */
  setChoices(choices: CyoaChoice[]): void;
};

// ── Implementation ───────────────────────────────────────────────────────

export class ChoiceButtonsViewModel
  extends BaseViewModel<ChoiceButtonsViewModelOptions>
  implements ChoiceButtonsViewModelInterface
{
  /** Current raw choices. */
  choices = $state<CyoaChoice[]>([]);
  /** Whether a choice has been selected (disables all buttons). */
  disabled = $state(false);
  /** Whether the choice set was dismissed. */
  dismissed = $state(false);

  private readonly _onSelect: (choice: CyoaChoice) => void;

  constructor(options: ChoiceButtonsViewModelOptions) {
    super(options);
    this.choices = options.choices;
    this._onSelect = options.onSelect;
  }

  get visible(): boolean {
    return !this.dismissed && this.choices.length > 0;
  }

  get items(): ReadonlyArray<ChoiceButtonItem> {
    // Single choice = prompt-advance mechanism, rendered as "Continue"
    const isSingle = this.choices.length === 1;

    return this.choices.map((choice) => {
      const fullLabel = isSingle ? CYOA_SINGLE_CHOICE_LABEL : choice.label;
      const truncated = fullLabel.length > CYOA_LABEL_MAX_LENGTH;
      const displayLabel = truncated ? `${fullLabel.slice(0, CYOA_LABEL_MAX_LENGTH)}…` : fullLabel;

      const tooltip = truncated ? fullLabel : (choice.description ?? '');

      const badgeText = choice.skillCheck
        ? `${choice.skillCheck.ability} DC ${choice.skillCheck.dc}`
        : '';

      return { id: choice.id, displayLabel, tooltip, badgeText };
    });
  }

  /** @inheritdoc */
  selectChoice(choiceId: string): void {
    if (this.disabled) {
      return;
    }

    const choice = this.choices.find((c) => c.id === choiceId);
    if (!choice) {
      this.warn('selectChoice:unknown-id', { choiceId });
      return;
    }

    this.disabled = true;
    this._onSelect(choice);
  }

  /** @inheritdoc */
  dismiss(): void {
    this.dismissed = true;
  }

  /** @inheritdoc */
  setChoices(choices: CyoaChoice[]): void {
    this.choices = choices;
    this.disabled = false;
    this.dismissed = false;
  }
}

export const getChoiceButtonsViewModel = (
  options: ChoiceButtonsViewModelOptions,
): ChoiceButtonsViewModelInterface => ChoiceButtonsViewModel.create(options);
