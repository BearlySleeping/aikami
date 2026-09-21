// apps/frontend/client/src/lib/views/chat/cyoa_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for /dev/cyoa. Demonstrates the CYOA choice
// buttons with mock choices — skill checks, truncation, single-choice
// "Continue", selection, dismissal, and choice history tracking.
//
// Contract: C-245 CYOA Choices Branching Narrative

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { CyoaChoice, CyoaChoiceHistoryEntry } from '@aikami/types';
import type {
  ChoiceButtonsCapabilities,
  ChoiceHistoryCapabilities,
} from './chat_view_model.svelte.ts';
import type { ChoiceButtonsViewModelInterface } from './choice_buttons_view_model.svelte.ts';

// ── Mock data ────────────────────────────────────────────────────────────

const SANDBOX_CHAT_ID = 'dev-cyoa-sandbox';

const MOCK_NARRATIVE =
  'The forest path ends at a moss-covered crossroads. To the east, crumbling ' +
  'ruins jut from the hillside like broken teeth. A river murmurs somewhere ' +
  'to the north, and the last light of dusk is fading fast.';

const MOCK_CHOICES: CyoaChoice[] = [
  {
    id: 'sandbox-1',
    label: 'Investigate the ruins',
    description: 'The ruins look ancient — something glints between the stones.',
  },
  {
    id: 'sandbox-2',
    label: 'Follow the river trail',
    description: 'The river should lead to a settlement before nightfall.',
  },
  {
    id: 'sandbox-3',
    label: 'Persuade the guard to talk',
    skillCheck: { ability: 'Persuasion', dc: 15 },
  },
  {
    id: 'sandbox-4',
    label:
      'Attempt to set up a fully fortified camp with defensive perimeter watches and elaborate trap lines around the entire clearing before darkness falls',
    skillCheck: { ability: 'Survival', dc: 12 },
  },
];

const SINGLE_CHOICE: CyoaChoice[] = [{ id: 'sandbox-single', label: 'Press onward' }];

// ── Types ────────────────────────────────────────────────────────────────

/** Choice-history operations the sandbox demonstrates (record/read/clear). */
export type CyoaChoiceHistoryCapabilities = ChoiceHistoryCapabilities & {
  getHistory(chatId: string): ReadonlyArray<CyoaChoiceHistoryEntry>;
  clearHistory(chatId: string): void;
};

export type CyoaSandboxViewModelOptions = BaseViewModelOptions & {
  /** CYOA choice history recording and reads. */
  choiceHistory: CyoaChoiceHistoryCapabilities;
  /** CYOA choice-buttons child factory. */
  choiceButtons: ChoiceButtonsCapabilities;
};

export type CyoaSandboxViewModelInterface = BaseViewModelInterface & {
  /** The mock GM narrative shown above the choices. */
  readonly narrative: string;
  /** The choice buttons ViewModel under test. */
  readonly choiceButtonsViewModel: ChoiceButtonsViewModelInterface;
  /** The last selected choice label (empty until a selection is made). */
  readonly lastSelectedLabel: string;
  /** Recorded choice history for the sandbox chat. */
  readonly history: ReadonlyArray<CyoaChoiceHistoryEntry>;
  /** Loads the standard 4-choice mock set. */
  loadMockChoices(): void;
  /** Loads a single-choice set (renders as "Continue"). */
  loadSingleChoice(): void;
  /** Loads an empty choice set (no UI rendered). */
  loadEmptyChoices(): void;
  /** Dismisses the current choice set. */
  dismissChoices(): void;
  /** Clears the sandbox choice history. */
  clearHistory(): void;
};

// ── Implementation ───────────────────────────────────────────────────────

export class CyoaSandboxViewModel
  extends BaseViewModel<CyoaSandboxViewModelOptions>
  implements CyoaSandboxViewModelInterface
{
  readonly narrative = MOCK_NARRATIVE;
  lastSelectedLabel = $state('');

  readonly choiceButtonsViewModel: ChoiceButtonsViewModelInterface;

  private readonly _choiceHistory: CyoaChoiceHistoryCapabilities;

  constructor(options: CyoaSandboxViewModelOptions) {
    super(options);
    this._choiceHistory = options.choiceHistory;
    this.choiceButtonsViewModel = options.choiceButtons.create({
      className: 'ChoiceButtonsViewModel:sandbox',
      choices: MOCK_CHOICES,
      onSelect: (choice) => this._handleSelect(choice),
    });
  }

  get history(): ReadonlyArray<CyoaChoiceHistoryEntry> {
    return this._choiceHistory.getHistory(SANDBOX_CHAT_ID);
  }

  /** @inheritdoc */
  loadMockChoices(): void {
    this.choiceButtonsViewModel.setChoices(MOCK_CHOICES);
  }

  /** @inheritdoc */
  loadSingleChoice(): void {
    this.choiceButtonsViewModel.setChoices(SINGLE_CHOICE);
  }

  /** @inheritdoc */
  loadEmptyChoices(): void {
    this.choiceButtonsViewModel.setChoices([]);
  }

  /** @inheritdoc */
  dismissChoices(): void {
    this.choiceButtonsViewModel.dismiss();
  }

  /** @inheritdoc */
  clearHistory(): void {
    this._choiceHistory.clearHistory(SANDBOX_CHAT_ID);
    this.lastSelectedLabel = '';
  }

  /** Records the selection in history and surfaces it in the sandbox UI. */
  private _handleSelect(choice: CyoaChoice): void {
    this.lastSelectedLabel = choice.label;
    this._choiceHistory.recordChoice({
      chatId: SANDBOX_CHAT_ID,
      entry: {
        choiceId: choice.id,
        label: choice.label,
        selectedAt: Date.now(),
      },
    });
  }
}

/**
 * Builds the CYOA sandbox from explicit capabilities. Production wiring lives
 * in ./cyoa_sandbox_composition.ts.
 */
export const createCyoaSandboxViewModel = (
  options: CyoaSandboxViewModelOptions,
): CyoaSandboxViewModelInterface => CyoaSandboxViewModel.create(options);
