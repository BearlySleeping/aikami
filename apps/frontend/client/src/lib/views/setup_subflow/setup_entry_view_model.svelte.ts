// apps/frontend/client/src/lib/views/setup_subflow/setup_entry_view_model.svelte.ts
//
// ViewModel for the setup route entry point. Presents the three
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
  /** The route's query string, mapped to an origin by {@link resolveSetupOrigin}. */
  searchParams?: ReadableSearchParams;
};

/**
 * The read-only slice of URLSearchParams this mapping needs. SvelteKit hands
 * routes a ReadonlyURLSearchParams, which is not assignable to URLSearchParams.
 */
export type ReadableSearchParams = { get(name: string): string | null };

/**
 * Maps the /setup route's query string onto a {@link SetupOrigin}.
 *
 * `?from=settings` means completion returns to Settings;
 * `?reason=text-provider-required` marks entry from the New Adventure gate,
 * where completion resumes campaign creation. Neither (a bookmark, or dev
 * navigation) is 'direct'.
 *
 * Lives here rather than in +page.svelte because views carry no conditionals
 * or data transformation.
 */
export const resolveSetupOrigin = (searchParams: ReadableSearchParams | undefined): SetupOrigin => {
  if (searchParams?.get('from') === 'settings') {
    return 'settings';
  }
  if (searchParams?.get('reason') === 'text-provider-required') {
    return 'new-adventure';
  }
  return 'direct';
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
      origin: options.origin ?? resolveSetupOrigin(options.searchParams),
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
