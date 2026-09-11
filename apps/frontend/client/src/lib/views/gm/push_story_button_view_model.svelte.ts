// apps/frontend/client/src/lib/views/gm/push_story_button_view_model.svelte.ts
//
// Push Story trigger ViewModel. Calls the narrative director's pushStory() and
// tracks the loading state for the button UI.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/push_story_fixtures.ts).
// Production wiring lives in ./push_story_button_composition.ts.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The narrative-director operation the button triggers. */
export type PushStoryCapabilities = {
  pushStory(): Promise<void>;
};

// ── Types ───────────────────────────────────────────────────────────────

export type PushStoryButtonViewModelOptions = BaseViewModelOptions & {
  /** Narrative director capability. */
  narrative: PushStoryCapabilities;
};

export type PushStoryButtonViewModelInterface = BaseViewModelInterface & {
  /** Whether a story push operation is in progress. */
  readonly isPushing: boolean;

  /** The most recent scene direction description, or null. */
  readonly lastDirection: string | null;

  /** Triggers a new scene direction generation. */
  pushStory(): Promise<void>;
};

// ── Implementation ──────────────────────────────────────────────────────

class PushStoryButtonViewModel
  extends BaseViewModel<PushStoryButtonViewModelOptions>
  implements PushStoryButtonViewModelInterface
{
  private readonly _narrative: PushStoryCapabilities;

  private _isPushing = $state(false);
  private _lastDirection = $state<string | null>(null);

  constructor(options: PushStoryButtonViewModelOptions) {
    super(options);
    this._narrative = options.narrative;
  }

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
      await this._narrative.pushStory();
    } finally {
      this._isPushing = false;
    }
  }
}

/**
 * Builds a push-story button ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getPushStoryButtonViewModel` in
 * ./push_story_button_composition.ts.
 */
export const createPushStoryButtonViewModel = (
  options: PushStoryButtonViewModelOptions,
): PushStoryButtonViewModelInterface => PushStoryButtonViewModel.create(options);
