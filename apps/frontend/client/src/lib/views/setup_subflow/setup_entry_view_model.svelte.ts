// apps/frontend/client/src/lib/views/setup_subflow/setup_entry_view_model.svelte.ts
//
// ViewModel for the capability route entry point. Presents the three
// setup paths (Recommended, Connect existing, Text-only) as a unified
// flow using the shared SetupSubflowViewModel.
// Contract: C-483 AC-1

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  getSetupSubflowViewModel,
  type SetupOrigin,
  type SetupSubflowViewModelInterface,
} from './setup_subflow_view_model.svelte';

export type SetupEntryViewModelInterface = BaseViewModelInterface & {
  /** The shared setup subflow ViewModel. */
  readonly subflow: SetupSubflowViewModelInterface;
  /** Whether the flow is complete (text is ready). */
  readonly isComplete: boolean;
};

export type SetupEntryViewModelOptions = BaseViewModelOptions & {
  /** Where the flow was entered from — see {@link SetupOrigin}. Defaults to 'direct'. */
  origin?: SetupOrigin;
};

class SetupEntryViewModel
  extends BaseViewModel<SetupEntryViewModelOptions>
  implements SetupEntryViewModelInterface
{
  readonly subflow: SetupSubflowViewModelInterface;

  constructor(options: SetupEntryViewModelOptions) {
    super(options);

    this.subflow = getSetupSubflowViewModel({
      className: 'SetupEntrySubflow',
      origin: options.origin,
    });
  }

  get isComplete(): boolean {
    return this.subflow.step === 'ready';
  }

  override async initialize(): Promise<void> {
    return super.initialize();
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getSetupEntryViewModel = (
  options: SetupEntryViewModelOptions,
): SetupEntryViewModelInterface => SetupEntryViewModel.create(options);
