// apps/frontend/client/src/lib/views/gm/session_summary_panel_view_model.svelte.ts
//
// End Session flow ViewModel. Triggers session summarization, shows a
// preview panel, and exposes resume point for game save service.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { sessionSummaryService } from '$services';
import type { SessionSummary } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSummaryPanelViewModelOptions = BaseViewModelOptions & {
  /** Total playtime in minutes for this session. */
  playtimeMinutes?: number;
};

export type SessionSummaryPanelViewModelInterface = BaseViewModelInterface & {
  /** The generated session summary, or null if not yet generated. */
  readonly summary: SessionSummary | null;

  /** Whether summary generation is in progress. */
  readonly isGenerating: boolean;

  /** Whether the summary has been generated and is ready to display. */
  readonly isReady: boolean;

  /** Error message if generation failed. */
  readonly summaryError: string | null;

  /**
   * Generates the end-of-session summary.
   * Sets isGenerating to true during the LLM call.
   */
  endSession(): Promise<void>;

  /** Clears the summary and resets state. */
  dismissSummary(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionSummaryPanelViewModel
  extends BaseViewModel<SessionSummaryPanelViewModelOptions>
  implements SessionSummaryPanelViewModelInterface
{
  private _summary = $state<SessionSummary | null>(null);
  private _isGenerating = $state(false);
  private _summaryError = $state<string | null>(null);
  private readonly _playtimeMinutes: number;

  constructor(options: SessionSummaryPanelViewModelOptions) {
    super(options);
    this._playtimeMinutes = options.playtimeMinutes ?? 0;
  }

  get summary(): SessionSummary | null {
    return this._summary;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  get isReady(): boolean {
    return this._summary !== null && !this._isGenerating;
  }

  get summaryError(): string | null {
    return this._summaryError;
  }

  /** @inheritdoc */
  async endSession(): Promise<void> {
    if (this._isGenerating) {
      return;
    }

    this._isGenerating = true;
    this._summaryError = null;

    try {
      this._summary = await sessionSummaryService.generateSummary(this._playtimeMinutes);
      this.debug('endSession', { summaryId: this._summary.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._summaryError = message;
      this.warn('endSession:failed', { message });
    } finally {
      this._isGenerating = false;
    }
  }

  /** @inheritdoc */
  dismissSummary(): void {
    this._summary = null;
    this._summaryError = null;
    sessionSummaryService.clearSummary();
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await super.initialize();
  }
}

export { SessionSummaryPanelViewModel };

/**
 * Factory function returning an interface, never the class directly.
 */
export const getSessionSummaryPanelViewModel = (
  options: SessionSummaryPanelViewModelOptions,
): SessionSummaryPanelViewModelInterface => SessionSummaryPanelViewModel.create(options);
