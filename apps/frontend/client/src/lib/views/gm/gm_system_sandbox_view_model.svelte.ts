// apps/frontend/client/src/lib/views/gm/gm_system_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the GM Narrative Director system.
// Extends production ViewModels with mock state for isolated testing.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gmPromptService, narrativeDirectorService } from '$services';
import {
  type AddressModeTogggleViewModelInterface,
  getAddressModeTogggleViewModel,
} from './address_mode_toggle_view_model.svelte.ts';
import {
  getPushStoryButtonViewModel,
  type PushStoryButtonViewModelInterface,
} from './push_story_button_view_model.svelte.ts';
import {
  getSessionSummaryPanelViewModel,
  type SessionSummaryPanelViewModelInterface,
} from './session_summary_panel_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GmSystemSandboxViewModelOptions = BaseViewModelOptions;

export type GmSystemSandboxViewModelInterface = BaseViewModelInterface & {
  /** Address mode toggle sub-ViewModel. */
  readonly addressModeViewModel: AddressModeTogggleViewModelInterface;

  /** Push Story button sub-ViewModel. */
  readonly pushStoryViewModel: PushStoryButtonViewModelInterface;

  /** Session summary panel sub-ViewModel. */
  readonly sessionSummaryViewModel: SessionSummaryPanelViewModelInterface;

  /** The assembled GM prompt text (debug display). */
  readonly debugPrompt: string;

  /** Whether the narrative director is running. */
  readonly isNarrativeDirectorRunning: boolean;

  /** Current scene direction count. */
  readonly sceneDirectionCount: number;

  /** Recent scene directions for display. */
  readonly recentDirections: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly playerGuidance: string | undefined;
    readonly createdAt: Date;
  }>;

  /** Starts the narrative director background interval. */
  startNarrativeDirector(): void;

  /** Stops the narrative director. */
  stopNarrativeDirector(): void;

  /** Generates a session summary with mock playtime. */
  generateSessionSummary(): Promise<void>;

  /** Clears the session summary. */
  clearSessionSummary(): void;

  /** Simulation log entries. */
  readonly logs: ReadonlyArray<string>;

  /** Clears the simulation log. */
  clearLogs(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GmSystemSandboxViewModel
  extends BaseViewModel<GmSystemSandboxViewModelOptions>
  implements GmSystemSandboxViewModelInterface
{
  readonly addressModeViewModel: AddressModeTogggleViewModelInterface;
  readonly pushStoryViewModel: PushStoryButtonViewModelInterface;
  readonly sessionSummaryViewModel: SessionSummaryPanelViewModelInterface;

  private _logs = $state<string[]>([]);
  private _selectedMode = $state<'scene' | 'party' | 'gm'>('scene');

  constructor(options: GmSystemSandboxViewModelOptions) {
    super(options);

    // Instantiate sub-ViewModels with default factory (optional prop pattern)
    this.addressModeViewModel = getAddressModeTogggleViewModel({
      className: 'AddressModeToggleViewModel',
      initialMode: 'scene',
    });
    this.pushStoryViewModel = getPushStoryButtonViewModel({
      className: 'PushStoryButtonViewModel',
    });
    this.sessionSummaryViewModel = getSessionSummaryPanelViewModel({
      className: 'SessionSummaryPanelViewModel',
      playtimeMinutes: 45,
    });
  }

  get debugPrompt(): string {
    return gmPromptService.assemblePrompt({ mode: this._selectedMode });
  }

  get isNarrativeDirectorRunning(): boolean {
    return narrativeDirectorService.isRunning;
  }

  get sceneDirectionCount(): number {
    return narrativeDirectorService.sceneDirectionCount;
  }

  get recentDirections(): GmSystemSandboxViewModelInterface['recentDirections'] {
    return narrativeDirectorService.sceneDirections
      .slice()
      .reverse()
      .slice(0, 5)
      .map((d) => ({
        id: d.id,
        description: d.description,
        playerGuidance: d.playerGuidance,
        createdAt: new Date(d.createdAt),
      }));
  }

  get logs(): ReadonlyArray<string> {
    return this._logs;
  }

  // ── Public methods ──────────────────────────────────────────────────

  /** @inheritdoc */
  startNarrativeDirector(): void {
    narrativeDirectorService.start(30_000); // 30s for dev sandbox
    this._log('Narrative Director started (30s interval)');
  }

  /** @inheritdoc */
  stopNarrativeDirector(): void {
    narrativeDirectorService.stop();
    this._log('Narrative Director stopped');
  }

  /** @inheritdoc */
  async generateSessionSummary(): Promise<void> {
    await this.sessionSummaryViewModel.endSession();
    this._log('Session summary generated');
  }

  /** @inheritdoc */
  clearSessionSummary(): void {
    this.sessionSummaryViewModel.dismissSummary();
    this._log('Session summary cleared');
  }

  /** @inheritdoc */
  clearLogs(): void {
    this._logs = [];
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await super.initialize();

    // Initialize sub-ViewModels
    await this.addressModeViewModel.initialize();
    await this.pushStoryViewModel.initialize();
    await this.sessionSummaryViewModel.initialize();

    this._log('GM System Sandbox initialized');
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private _log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this._logs = [...this._logs, `[${timestamp}] ${message}`];
  }
}

export { GmSystemSandboxViewModel };

/**
 * Factory function returning an interface, never the class directly.
 */
export const getGmSystemSandboxViewModel = (
  options: GmSystemSandboxViewModelOptions,
): GmSystemSandboxViewModelInterface => GmSystemSandboxViewModel.create(options);
