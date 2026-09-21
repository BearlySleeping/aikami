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
} from '@aikami/frontend/services/base';
import type { GmPromptServiceInterface, NarrativeDirectorServiceInterface } from '$services';
import type { getAddressModeTogggleViewModel } from './address_mode_toggle_composition.ts';
import type { AddressModeTogggleViewModelInterface } from './address_mode_toggle_view_model.svelte.ts';
import type { getPushStoryButtonViewModel } from './push_story_button_composition.ts';
import type { PushStoryButtonViewModelInterface } from './push_story_button_view_model.svelte.ts';
import type { getSessionSummaryPanelViewModel } from './session_summary_panel_composition.ts';
import type { SessionSummaryPanelViewModelInterface } from './session_summary_panel_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The GM prompt assembler the sandbox reads. */
export type GmSystemSandboxPromptCapabilities = Pick<GmPromptServiceInterface, 'assemblePrompt'>;

/** The narrative director state/operations the sandbox drives. */
export type GmSystemSandboxDirectorCapabilities = Pick<
  NarrativeDirectorServiceInterface,
  'isRunning' | 'sceneDirectionCount' | 'sceneDirections' | 'start' | 'stop'
>;

export type GmSystemSandboxViewModelOptions = BaseViewModelOptions & {
  /** GM prompt assembler. */
  prompt: GmSystemSandboxPromptCapabilities;
  /** Narrative director. */
  narrative: GmSystemSandboxDirectorCapabilities;
  /** Address-mode toggle child factory. */
  createAddressModeViewModel: typeof getAddressModeTogggleViewModel;
  /** Push Story button child factory. */
  createPushStoryViewModel: typeof getPushStoryButtonViewModel;
  /** Session summary panel child factory. */
  createSessionSummaryViewModel: typeof getSessionSummaryPanelViewModel;
};

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
  private readonly _prompt: GmSystemSandboxPromptCapabilities;
  private readonly _narrative: GmSystemSandboxDirectorCapabilities;
  private readonly _createAddressModeViewModel: typeof getAddressModeTogggleViewModel;
  private readonly _createPushStoryViewModel: typeof getPushStoryButtonViewModel;
  private readonly _createSessionSummaryViewModel: typeof getSessionSummaryPanelViewModel;

  readonly addressModeViewModel: AddressModeTogggleViewModelInterface;
  readonly pushStoryViewModel: PushStoryButtonViewModelInterface;
  readonly sessionSummaryViewModel: SessionSummaryPanelViewModelInterface;

  private _logs = $state<string[]>([]);
  private _selectedMode = $state<'scene' | 'party' | 'gm'>('scene');

  constructor(options: GmSystemSandboxViewModelOptions) {
    super(options);
    this._prompt = options.prompt;
    this._narrative = options.narrative;
    this._createAddressModeViewModel = options.createAddressModeViewModel;
    this._createPushStoryViewModel = options.createPushStoryViewModel;
    this._createSessionSummaryViewModel = options.createSessionSummaryViewModel;

    // Instantiate sub-ViewModels with default factory (optional prop pattern)
    this.addressModeViewModel = this._createAddressModeViewModel({
      className: 'AddressModeToggleViewModel',
      initialMode: 'scene',
    });
    this.pushStoryViewModel = this._createPushStoryViewModel({
      className: 'PushStoryButtonViewModel',
    });
    this.sessionSummaryViewModel = this._createSessionSummaryViewModel({
      className: 'SessionSummaryPanelViewModel',
      playtimeMinutes: 45,
    });
  }

  get debugPrompt(): string {
    return this._prompt.assemblePrompt({ mode: this._selectedMode });
  }

  get isNarrativeDirectorRunning(): boolean {
    return this._narrative.isRunning;
  }

  get sceneDirectionCount(): number {
    return this._narrative.sceneDirectionCount;
  }

  get recentDirections(): GmSystemSandboxViewModelInterface['recentDirections'] {
    return this._narrative.sceneDirections
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
    this._narrative.start(30_000); // 30s for dev sandbox
    this._log('Narrative Director started (30s interval)');
  }

  /** @inheritdoc */
  stopNarrativeDirector(): void {
    this._narrative.stop();
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
 * Builds a GM-system sandbox ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGmSystemSandboxViewModel` in
 * ./gm_system_sandbox_composition.ts.
 */
export const createGmSystemSandboxViewModel = (
  options: GmSystemSandboxViewModelOptions,
): GmSystemSandboxViewModelInterface => GmSystemSandboxViewModel.create(options);
