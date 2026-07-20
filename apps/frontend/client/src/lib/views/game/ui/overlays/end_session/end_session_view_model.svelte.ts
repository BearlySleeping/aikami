// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.svelte.ts
//
// ViewModel for the End Session overlay — confirmation dialog, C-235
// summarization trigger, summary preview, recap editing (C-344), and
// New Session flow.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { BaseViewModel, type BaseViewModelInterface } from '@aikami/frontend/services';
import { gameOverlayService } from '$services';
import { sessionService } from '$services/game/session_service.svelte';

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
};

class EndSessionViewModel
  extends BaseViewModel<{ className: string }>
  implements EndSessionViewModelInterface
{
  phase = $state<'confirm' | 'summarizing' | 'preview' | 'editing' | 'locked'>('confirm');
  isStartingNew = $state(false);
  isSavingRecap = $state(false);
  editedSynopsis = $state('');
  saveError = $state<string | null>(null);

  get isSummarizing(): boolean {
    return this.phase === 'summarizing';
  }

  get summarySynopsis(): string | null {
    return sessionService.latestSummary?.synopsis ?? null;
  }

  get summaryKeyEvents(): readonly string[] {
    return sessionService.latestSummary?.keyEvents ?? [];
  }

  get sessionNumber(): number {
    return sessionService.activeSession?.sessionNumber ?? 0;
  }

  get messageCount(): number {
    return sessionService.activeSession?.messageCount ?? 0;
  }

  get recapReviewed(): boolean {
    return sessionService.activeSession?.recapReviewed ?? false;
  }

  /** @inheritdoc */
  async confirmEndSession(): Promise<void> {
    this.phase = 'summarizing';

    try {
      await gameOverlayService.endSession();
      this.phase = 'preview';
    } catch {
      // If summarization or save fails, still show locked state
      this.phase = 'locked';
    }
  }

  /** @inheritdoc */
  cancel(): void {
    gameOverlayService.closeEndSession();
  }

  /** @inheritdoc */
  async startNewSession(): Promise<void> {
    this.isStartingNew = true;

    try {
      await gameOverlayService.startNewSession();
    } finally {
      this.isStartingNew = false;
    }
  }

  // ── C-344: Recap Editing ─────────────────────────────────────────────

  /** @inheritdoc */
  enterEditMode(): void {
    // Initialize editable text with saved edit if available, otherwise current synopsis
    this.editedSynopsis =
      sessionService.activeSession?.editedSynopsis ?? this.summarySynopsis ?? '';
    this.phase = 'editing';
  }

  /** @inheritdoc */
  setEditedSynopsis(value: string): void {
    this.editedSynopsis = value;
  }

  /** @inheritdoc */
  async saveRecap(): Promise<void> {
    const sessionId = sessionService.activeSession?.id;
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
      await sessionService.updateSessionRecap({
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

export const getEndSessionViewModel = (): EndSessionViewModelInterface =>
  EndSessionViewModel.create({ className: 'EndSessionViewModel' });
