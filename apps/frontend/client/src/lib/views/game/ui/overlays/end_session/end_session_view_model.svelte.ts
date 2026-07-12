// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.svelte.ts
//
// ViewModel for the End Session overlay — confirmation dialog, C-235
// summarization trigger, summary preview, and New Session flow.
//
// Contract: C-240 Session Management

import { BaseViewModel, type BaseViewModelInterface } from '@aikami/frontend/services';
import { gameOverlayService } from '$services';
import { sessionService } from '$services/game/session_service.svelte';

export type EndSessionViewModelInterface = BaseViewModelInterface & {
  /** Current phase: 'confirm' → 'summarizing' → 'preview' → 'locked'. */
  readonly phase: 'confirm' | 'summarizing' | 'preview' | 'locked';
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

  /** Confirms the end session and triggers summarization. */
  confirmEndSession(): Promise<void>;
  /** Returns to the pause menu without ending. */
  cancel(): void;
  /** Starts a new session after ending. */
  startNewSession(): Promise<void>;
};

class EndSessionViewModel
  extends BaseViewModel<{ className: string }>
  implements EndSessionViewModelInterface
{
  phase = $state<'confirm' | 'summarizing' | 'preview' | 'locked'>('confirm');
  isStartingNew = $state(false);

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
}

export const getEndSessionViewModel = (): EndSessionViewModelInterface =>
  EndSessionViewModel.create({ className: 'EndSessionViewModel' });
