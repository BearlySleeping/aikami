// apps/frontend/client/src/lib/views/gm/push_story_button_view_model.svelte.ts
//
// Push Story trigger ViewModel. Calls narrativeDirectorService.pushStory()
// and tracks the loading state for the button UI.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { narrativeDirectorService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushStoryButtonViewModelOptions = BaseViewModelOptions;

export type PushStoryButtonViewModelInterface = BaseViewModelInterface & {
  /** Whether a story push operation is in progress. */
  readonly isPushing: boolean;

  /** The most recent scene direction description, or null. */
  readonly lastDirection: string | null;

  /** Triggers a new scene direction generation. */
  pushStory(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PushStoryButtonViewModel
  extends BaseViewModel<PushStoryButtonViewModelOptions>
  implements PushStoryButtonViewModelInterface
{
  private _isPushing = $state(false);
  private _lastDirection = $state<string | null>(null);

  get isPushing(): boolean {
    return this._isPushing;
  }

  get lastDirection(): string | null {
    return this._lastDirection;
  }

  /** @inheritdoc */
  async pushStory(): Promise<void> {
    if (this._isPushing) {
      return;
    }

    this._isPushing = true;

    try {
      await narrativeDirectorService.pushStory();
    } finally {
      this._isPushing = false;
    }
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await super.initialize();
  }
}

export { PushStoryButtonViewModel };

/**
 * Factory function returning an interface, never the class directly.
 */
export const getPushStoryButtonViewModel = (
  options: PushStoryButtonViewModelOptions,
): PushStoryButtonViewModelInterface => PushStoryButtonViewModel.create(options);
