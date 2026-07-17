// apps/frontend/client/src/lib/services/game/onboarding_hint_service.svelte.ts
//
// Onboarding hint state machine — shows contextual tutorial hints,
// marks them learned when the action is performed, persists learned
// state per content pack in localStorage, supports replay/reset.
//
// Contract: C-327 AC-3, AC-4

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { OnboardingHintStep, OnboardingSection } from '@aikami/types';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Client-local persisted progress (localStorage). */
export type OnboardingProgress = {
  packId: string;
  /** hint id → learned */
  learned: Record<string, boolean>;
  completedAt?: number;
};

export type OnboardingHintServiceInterface = BaseFrontendClassInterface & {
  /** The currently active hint step, or undefined if none. */
  readonly currentHint: OnboardingHintStep | undefined;
  /** Whether the hint toast is visible. */
  readonly hintVisible: boolean;
  /** Whether the onboarding is complete (all hints learned). */
  readonly isComplete: boolean;

  /** Loads the onboarding section for a content pack. */
  loadOnboarding(options: { packId: string; onboarding: OnboardingSection }): void;
  /** Called when the player performs an action (check for learned). */
  onActionPerformed(actionId: string): void;
  /** Called when interaction target changes (trigger near_interactable hints). */
  onInteractionTargetChanged(): void;
  /** Hides the current hint toast (called by ViewModel on dismiss). */
  dismissCurrentHint(): void;
  /** Resets learned state for the current pack (replay). */
  resetOnboarding(): void;
  /** Reloads from localStorage for the current pack. */
  refreshProgress(): void;
};

export type OnboardingHintServiceOptions = BaseFrontendClassOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class OnboardingHintService
  extends BaseFrontendClass<OnboardingHintServiceOptions>
  implements OnboardingHintServiceInterface
{
  currentHint = $state<OnboardingHintStep | undefined>(undefined);
  hintVisible = $state<boolean>(false);
  isComplete = $state<boolean>(false);

  private _packId = '';
  private _steps: OnboardingHintStep[] = [];
  private _learned: Record<string, boolean> = {};
  private _pendingHints: OnboardingHintStep[] = [];
  private _nearInteractableTriggered = false;

  // ── Public API ──

  /**
   * Loads the onboarding section for a content pack.
   *
   * Resets internal state and reads persisted progress from localStorage.
   *
   * @param options.packId - The content pack identifier.
   * @param options.onboarding - The onboarding section from the manifest.
   */
  loadOnboarding(options: { packId: string; onboarding: OnboardingSection }): void {
    const { packId, onboarding } = options;

    this._packId = packId;
    this._steps = [...onboarding.steps];
    this._learned = {};
    this._pendingHints = [];
    this.currentHint = undefined;
    this.hintVisible = false;
    this.isComplete = false;
    this._nearInteractableTriggered = false;

    this._loadProgress();
    this._enqueuePendingHints();
  }

  /**
   * Called when the player performs a given action.
   *
   * Marks the matching hint as learned if it's currently active and
   * advances to the next eligible hint.
   */
  onActionPerformed(actionId: string): void {
    if (this.isComplete || this._steps.length === 0) {
      return;
    }

    // Mark any hint teaching this action as learned
    for (const step of this._steps) {
      if (step.action === actionId && !this._learned[step.id]) {
        this._learned[step.id] = true;
        this.debug('hint-learned', { hintId: step.id, action: actionId });
      }
    }

    this._saveProgress();

    // If the current hint was just learned, dismiss it and advance
    if (this.currentHint && this.currentHint.action === actionId) {
      this.hintVisible = false;
      this.currentHint = undefined;
      this._enqueuePendingHints();
    }
  }

  /**
   * Called when the interaction target changes (INTERACTION_TARGET_CHANGED).
   *
   * Unblocks the first `near_interactable` hint that hasn't been shown.
   */
  onInteractionTargetChanged(): void {
    if (this._nearInteractableTriggered) {
      return;
    }
    this._nearInteractableTriggered = true;
    this._enqueuePendingHints();
  }

  /** Hides the current hint toast. Called manually by the ViewModel. */
  dismissCurrentHint(): void {
    this.hintVisible = false;
    this.currentHint = undefined;
  }

  /** Resets learned state for the current pack (replay tutorial). */
  resetOnboarding(): void {
    this._learned = {};
    this._pendingHints = [];
    this._enqueuePendingHints();
    this.isComplete = false;
    this._nearInteractableTriggered = false;
    this._saveProgress();
    this.debug('onboarding-reset', { packId: this._packId });
  }

  /** Reloads from localStorage for the current pack. */
  refreshProgress(): void {
    this._loadProgress();
    this._enqueuePendingHints();
  }

  // ── Private helpers ──

  /**
   * Enqueues pending hints that are ready to show.
   *
   * Only shows one hint at a time (non-modal). After a hint is shown,
   * subsequent `after_previous` hints wait for the current one to be
   * learned or dismissed.
   */
  private _enqueuePendingHints(): void {
    if (this.isComplete || this.hintVisible) {
      return;
    }

    let found = false;

    for (const step of this._steps) {
      if (this._learned[step.id]) {
        continue;
      }

      // Check trigger condition
      if (step.trigger === 'map_loaded') {
        // Always eligible on map start
        this.currentHint = step;
        this.hintVisible = true;
        found = true;
        break;
      }

      if (step.trigger === 'near_interactable') {
        if (this._nearInteractableTriggered) {
          this.currentHint = step;
          this.hintVisible = true;
          found = true;
          break;
        }
        // Otherwise wait — don't evaluate further triggers until this is met
        break;
      }

      if (step.trigger === 'after_previous') {
        // Only show if the previous step is learned
        const prevIndex = this._steps.indexOf(step) - 1;
        if (prevIndex >= 0 && this._learned[this._steps[prevIndex].id]) {
          this.currentHint = step;
          this.hintVisible = true;
          found = true;
          break;
        }
        // Wait for previous hint
        break;
      }
    }

    if (!found) {
      // Check if all hints are learned
      const allLearned = this._steps.every((s) => this._learned[s.id]);
      if (allLearned && this._steps.length > 0) {
        this.isComplete = true;
        this.currentHint = undefined;
        this.hintVisible = false;
        this._saveProgress();
      }
    }
  }

  /** Loads progress from localStorage. */
  private _loadProgress(): void {
    try {
      const key = `aikami:onboarding:${this._packId}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const progress: OnboardingProgress = JSON.parse(raw);
        if (progress.packId === this._packId) {
          this._learned = { ...progress.learned };
          if (progress.completedAt) {
            this.isComplete = true;
          }
          return;
        }
      }
    } catch (err) {
      logger.debug('OnboardingHintService: failed to load progress, using defaults', {
        error: String(err),
      });
    }
    this._learned = {};
    this.isComplete = false;
  }

  /** Persists progress to localStorage. */
  private _saveProgress(): void {
    try {
      const key = `aikami:onboarding:${this._packId}`;
      const progress: OnboardingProgress = {
        packId: this._packId,
        learned: { ...this._learned },
        completedAt: this.isComplete ? Date.now() : undefined,
      };
      localStorage.setItem(key, JSON.stringify(progress));
    } catch (err) {
      logger.debug('OnboardingHintService: failed to save progress', { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const onboardingHintService: OnboardingHintServiceInterface = OnboardingHintService.create({
  className: 'OnboardingHintService',
}) as OnboardingHintServiceInterface;
