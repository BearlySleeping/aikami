// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the World Generation Wizard.
//
// The sandbox no longer overrides `_callLlm` (that method no longer exists);
// generation is the draft service's job. Instead it exposes the controls the
// wizard's real lifecycle needs to be exercised without a provider: a
// deterministic stage responder, a per-stage delay so cancellation has a window
// to be observed, and a permanent-failure switch for retry exhaustion.
//
// Contract: G01 — safe private narrative-world drafts

import { BaseDevViewModel } from '@aikami/frontend/services/base';
import type { WorldGenInput } from '@aikami/types';
import {
  WorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
  type WorldGenWizardViewModelOptions,
} from '$views/worldgen/world_gen_wizard_view_model.svelte.ts';

/** Interface for the sandbox ViewModel. */
export type WorldGenSandboxViewModelInterface = WorldGenWizardViewModelInterface & {
  readonly debugPanelVisible: boolean;
  readonly debugPromptText: string;
  /** The prompt most recently issued to the mock provider. */
  readonly lastStagePrompt: string;
  toggleDebugPanel(): void;
  /** Makes every mock stage fail, to exercise retry exhaustion. */
  simulateFailure(): void;
  resetFailureSimulation(): void;
  /** Per-stage delay in ms, so a run can be cancelled mid-flight. */
  setStageDelay(stage: string, delayMs: number): void;
  /**
   * Clears every delay, INCLUDING one the URL query asked for.
   *
   * The mock provider's delay can come from `?wgDelay=`, which lives outside
   * this ViewModel; without a flag the sandbox's own "Clear Delay" button was
   * a no-op on exactly the route that documents the query.
   */
  clearStageDelay(): void;
  /** Whether {@link clearStageDelay} has been pressed since the last set. */
  readonly stageDelaysCleared: boolean;
  /** Whether the mock provider is in permanent-failure mode. */
  readonly sandboxFailure: boolean;
  /** Per-stage delay the mock provider should apply. */
  sandboxDelayFor(stage: string): number;
  /** Records the prompt the mock provider was asked to fulfil. */
  sandboxRecordPrompt(prompt: string): void;
};

/** Options for constructing the sandbox ViewModel. */
export type WorldGenSandboxViewModelOptions = WorldGenWizardViewModelOptions & {};

export class WorldGenSandboxViewModel
  extends WorldGenWizardViewModel
  implements WorldGenSandboxViewModelInterface
{
  private _debugPanelVisible = $state(false);
  private _debugPromptText = $state('');
  private _lastStagePrompt = $state('');
  private _simulateFailure = false;
  private _stageDelays = new Map<string, number>();
  private _stageDelaysCleared = false;
  private readonly _screenshotMode: boolean;

  constructor(options: WorldGenSandboxViewModelOptions) {
    super(options);
    this._screenshotMode = BaseDevViewModel.isScreenshot();
    if (!this._screenshotMode) {
      this.surpriseMe();
    }
  }

  get debugPanelVisible(): boolean {
    return this._debugPanelVisible;
  }

  get debugPromptText(): string {
    return this._debugPromptText;
  }

  get lastStagePrompt(): string {
    return this._lastStagePrompt;
  }

  toggleDebugPanel(): void {
    this._debugPanelVisible = !this._debugPanelVisible;
  }

  simulateFailure(): void {
    this._simulateFailure = true;
  }

  resetFailureSimulation(): void {
    this._simulateFailure = false;
  }

  setStageDelay(stage: string, delayMs: number): void {
    this._stageDelays.set(stage, delayMs);
    this._stageDelaysCleared = false;
  }

  clearStageDelay(): void {
    this._stageDelays.clear();
    this._stageDelaysCleared = true;
  }

  get stageDelaysCleared(): boolean {
    return this._stageDelaysCleared;
  }

  /** @internal — read by the sandbox mock text capability. */
  get sandboxFailure(): boolean {
    return this._simulateFailure;
  }

  /** @internal — read by the sandbox mock text capability. */
  sandboxDelayFor(stage: string): number {
    if (this._screenshotMode || this._stageDelaysCleared) {
      return 0;
    }
    return this._stageDelays.get(stage) ?? 120;
  }

  /** @internal — records the prompt the mock provider was asked to fulfil. */
  sandboxRecordPrompt(prompt: string): void {
    this._lastStagePrompt = prompt;
    this._debugPromptText = prompt;
  }

  /** @internal — seeds the sandbox inputs used by the mock provider. */
  get sandboxInputs(): WorldGenInput {
    return {
      genre: this.genre,
      tone: this.tone,
      setting: this.setting,
      difficulty: this.difficulty,
      goals: this.goals,
    };
  }
}

/** Builds a sandbox world-generation ViewModel from explicit capabilities. */
export const createWorldGenSandboxViewModel = (
  options: WorldGenSandboxViewModelOptions,
): WorldGenSandboxViewModelInterface => WorldGenSandboxViewModel.create(options);
