// apps/frontend/client/src/lib/views/gm/session_summary_panel_view_model.svelte.ts
//
// End Session flow ViewModel. Triggers session summarization, shows a preview
// panel, and exposes the resume point for the game save service.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/session_summary_fixtures.ts).
// Production wiring lives in ./session_summary_panel_composition.ts.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { SessionSummary } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The summarization operations the panel performs. */
export type SessionSummaryCapabilities = {
  generateSummary(playtimeMinutes: number): Promise<SessionSummary>;
  clearSummary(): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type SessionSummaryPanelViewModelOptions = BaseViewModelOptions & {
  /** Total playtime in minutes for this session. */
  playtimeMinutes?: number;
  /** Summarization capability. */
  summary: SessionSummaryCapabilities;
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

// ── Implementation ──────────────────────────────────────────────────────

class SessionSummaryPanelViewModel
  extends BaseViewModel<SessionSummaryPanelViewModelOptions>
  implements SessionSummaryPanelViewModelInterface
{
  private readonly _summary: SessionSummaryCapabilities;
  private readonly _playtimeMinutes: number;

  private _summaryValue = $state<SessionSummary | null>(null);
  private _isGenerating = $state(false);
  private _summaryError = $state<string | null>(null);

  constructor(options: SessionSummaryPanelViewModelOptions) {
    super(options);
    this._summary = options.summary;
    this._playtimeMinutes = options.playtimeMinutes ?? 0;
  }

  get summary(): SessionSummary | null {
    return this._summaryValue;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  get isReady(): boolean {
    return this._summaryValue !== null && !this._isGenerating;
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
      this._summaryValue = await this._summary.generateSummary(this._playtimeMinutes);
      this.debug('endSession', { summaryId: this._summaryValue.id });
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
    this._summaryValue = null;
    this._summaryError = null;
    this._summary.clearSummary();
  }
}

/**
 * Builds a session-summary panel ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSessionSummaryPanelViewModel` in
 * ./session_summary_panel_composition.ts.
 */
export const createSessionSummaryPanelViewModel = (
  options: SessionSummaryPanelViewModelOptions,
): SessionSummaryPanelViewModelInterface => SessionSummaryPanelViewModel.create(options);
