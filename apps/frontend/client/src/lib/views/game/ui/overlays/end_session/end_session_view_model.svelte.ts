// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.svelte.ts
//
// ViewModel for the End Session overlay — confirmation dialog, C-235
// summarization trigger, summary preview, recap editing (C-344), and
// New Session flow.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/end_session_fixtures.ts).
// Production wiring lives in ./end_session_composition.ts.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { GameSession, SessionSummary } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** Overlay operations the end-session flow drives. */
export type EndSessionOverlayCapabilities = {
  endSession(): Promise<void>;
  closeEndSession(): void;
  startNewSession(): Promise<void>;
};

/** Session state and recap operations the end-session flow reads and drives. */
export type EndSessionSessionCapabilities = {
  readonly latestSummary: SessionSummary | null;
  readonly activeSession: GameSession | null;
  updateSessionRecap(options: { sessionId: string; editedSynopsis: string }): Promise<void>;
};

// ── Types ───────────────────────────────────────────────────────────────

/** Configuration used to create the end-session overlay ViewModel. */
export type EndSessionViewModelOptions = BaseViewModelOptions & {
  /** Overlay capability. */
  overlay: EndSessionOverlayCapabilities;
  /** Session capability. */
  session: EndSessionSessionCapabilities;
};

export type EndSessionViewModelInterface = BaseViewModelInterface & {
  /** Current phase: 'confirm' → 'summarizing' → 'preview' → 'editing' → 'locked'. */
  readonly phase: 'confirm' | 'summarizing' | 'preview' | 'editing' | 'locked';
  /** Whether summarization is in progress. */
  readonly isSummarizing: boolean;
  /** Whether a new session is being created. */
  readonly isStartingNew: boolean;
  /** The generated session summary synopsis, or null. */
  readonly summarySynopsis: string | null;
  /** The generated summary key events. */
  readonly summaryKeyEvents: readonly string[];
  /** The session number being ended. */
  readonly sessionNumber: number;
  /** How many messages were in this session. */
  readonly messageCount: number;
  /** Whether the recap has been reviewed (C-344). */
  readonly recapReviewed: boolean;
  /** Current editable synopsis text (C-344). */
  readonly editedSynopsis: string;
  /** Whether saving the edited recap is in progress (C-344). */
  readonly isSavingRecap: boolean;
  /** Save error message, or null (C-344). */
  readonly saveError: string | null;

  /** Confirms the end session and triggers summarization. */
  confirmEndSession(): Promise<void>;
  /** Returns to the pause menu without ending. */
  cancel(): void;
  /** Starts a new session after ending. */
  startNewSession(): Promise<void>;
  /** Enters the recap editing mode (C-344). */
  enterEditMode(): void;
  /** Sets the editable synopsis text (C-344). */
  setEditedSynopsis(value: string): void;
  /** Saves the edited recap and returns to preview (C-344). */
  saveRecap(): Promise<void>;
  /** Cancels editing and returns to preview without saving (C-344). */
  cancelEdit(): void;
  /** Closes the dialog when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class EndSessionViewModel
  extends BaseViewModel<EndSessionViewModelOptions>
  implements EndSessionViewModelInterface
{
  private readonly _overlay: EndSessionOverlayCapabilities;
  private readonly _session: EndSessionSessionCapabilities;

  phase = $state<'confirm' | 'summarizing' | 'preview' | 'editing' | 'locked'>('confirm');
  isStartingNew = $state(false);
  isSavingRecap = $state(false);
  editedSynopsis = $state('');
  saveError = $state<string | null>(null);

  constructor(options: EndSessionViewModelOptions) {
    super(options);
    this._overlay = options.overlay;
    this._session = options.session;
  }

  get isSummarizing(): boolean {
    return this.phase === 'summarizing';
  }

  get summarySynopsis(): string | null {
    return this._session.latestSummary?.synopsis ?? null;
  }

  get summaryKeyEvents(): readonly string[] {
    return this._session.latestSummary?.keyEvents ?? [];
  }

  get sessionNumber(): number {
    return this._session.activeSession?.sessionNumber ?? 0;
  }

  get messageCount(): number {
    return this._session.activeSession?.messageCount ?? 0;
  }

  get recapReviewed(): boolean {
    return this._session.activeSession?.recapReviewed ?? false;
  }

  /** @inheritdoc */
  async confirmEndSession(): Promise<void> {
    this.phase = 'summarizing';

    try {
      await this._overlay.endSession();
      this.phase = 'preview';
    } catch {
      // If summarization or save fails, still show locked state
      this.phase = 'locked';
    }
  }

  /** @inheritdoc */
  cancel(): void {
    this._overlay.closeEndSession();
  }

  /** @inheritdoc */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancel();
    }
  }

  /** @inheritdoc */
  async startNewSession(): Promise<void> {
    this.isStartingNew = true;

    try {
      await this._overlay.startNewSession();
    } finally {
      this.isStartingNew = false;
    }
  }

  // ── C-344: Recap Editing ─────────────────────────────────────────────

  /** @inheritdoc */
  enterEditMode(): void {
    // Initialize editable text with saved edit if available, otherwise current synopsis
    this.editedSynopsis = this._session.activeSession?.editedSynopsis ?? this.summarySynopsis ?? '';
    this.phase = 'editing';
  }

  /** @inheritdoc */
  setEditedSynopsis(value: string): void {
    this.editedSynopsis = value;
  }

  /** @inheritdoc */
  async saveRecap(): Promise<void> {
    const sessionId = this._session.activeSession?.id;
    if (!sessionId) {
      return;
    }

    if (this.editedSynopsis.trim().length < 10) {
      this.debug('saveRecap:validation-failed', {
        length: this.editedSynopsis.trim().length,
      });
      return;
    }

    this.saveError = null;
    this.isSavingRecap = true;

    try {
      await this._session.updateSessionRecap({
        sessionId,
        editedSynopsis: this.editedSynopsis,
      });
      this.phase = 'preview';
      this.debug('saveRecap:complete');
    } catch (error) {
      this.saveError = String(error);
      this.debug('saveRecap:failed', { error: String(error) });
    } finally {
      this.isSavingRecap = false;
    }
  }

  /** @inheritdoc */
  cancelEdit(): void {
    this.editedSynopsis = '';
    this.phase = 'preview';
  }
}

/**
 * Builds an end-session ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getEndSessionViewModel` in ./end_session_composition.ts.
 */
export const createEndSessionViewModel = (
  options: EndSessionViewModelOptions,
): EndSessionViewModelInterface => EndSessionViewModel.create(options);
