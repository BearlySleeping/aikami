// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts
//
// G01 — World Generation Wizard ViewModel.
//
// This ViewModel owns the WIZARD (step flow and user input) and nothing else.
// Generation, cancellation, checkpointing and persistence belong to
// {@link WorldGenDraftService}; the wizard observes it and renders it.
//
// What changed from C-233/C-405, and why each matters:
//
//   * The ViewModel no longer receives `campaign`, `worldState` or
//     `worldGenSeeding`. Those capabilities were the only route by which a
//     "preview" screen could call `subscribeToWorld`, `addLocation` and the
//     four `seed*` methods against the player's LIVE campaign. Removing them
//     from the type makes that a compile error rather than a code-review
//     finding — there is now no capability in this feature that can mutate an
//     active world.
//   * Generation is single-flight. A second `generateWorld()` while a run is
//     live is ignored instead of opening a second provider pipeline.
//   * Restart, edit, navigation and disposal all cancel synchronously, and a
//     late completion from a superseded run can no longer overwrite newer
//     state.
//   * The final step is "Draft Saved", not character creation: a G01 draft is
//     a private narrative preview, and advancing to character creation would
//     assert that it is playable.
//
// Contract: G01 — safe private narrative-world drafts

import { STEP_LABELS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { WorldGenDraft, WorldGenDraftDiagnostic, WorldGenDraftStage } from '@aikami/schemas';
import type { WizardStep, WorldGenInput } from '@aikami/types';
import { getRandomPreset } from '@aikami/types';
import type { RouterServiceInterface } from '$services';
import type { WorldGenDraftPersistence } from '../../services/worldgen/types/world_gen_draft_service.types.ts';
import type { WorldGenDraftServiceInterface } from '../../services/worldgen/world_gen_draft_service.svelte.ts';
import { WORLD_GEN_STAGE_LABELS } from '../../services/worldgen/world_gen_stage_graph.ts';

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

/** Navigation the wizard performs between steps. */
export type WorldGenRouterCapabilities = Pick<RouterServiceInterface, 'goToRoute'>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorldGenWizardViewModelOptions = BaseViewModelOptions & {
  /** Navigation capability. */
  router: WorldGenRouterCapabilities;
  /** The draft orchestrator. Owns generation, cancellation and persistence. */
  drafts: WorldGenDraftServiceInterface;
  /** Pre-populated inputs for editing (e.g. from a previous session). */
  initialInputs?: WorldGenInput;
};

/** Public interface for the wizard ViewModel. */
export type WorldGenWizardViewModelInterface = BaseViewModelInterface & {
  readonly currentStep: WizardStep;
  readonly steps: readonly WizardStep[];
  readonly genre: string;
  readonly tone: string;
  readonly setting: string;
  readonly difficulty: string;
  readonly goals: string;
  readonly draft: WorldGenDraft | undefined;
  readonly isGenerating: boolean;
  readonly generationError: string | undefined;
  readonly retryStatus: string | undefined;
  readonly canAdvance: boolean;
  readonly isFirstStep: boolean;
  readonly isLastInputStep: boolean;
  readonly canCancel: boolean;
  /** Whether a completed draft can be accepted as a private preview. */
  readonly canAccept: boolean;
  /** 'durable' only when the draft really reached the device store. */
  readonly persistence: WorldGenDraftPersistence;
  readonly diagnostics: readonly WorldGenDraftDiagnostic[];
  /** stage → human label, for the checkpoint/progress readout. */
  readonly completedStageLabels: readonly string[];
  /** stage → failure message, for the partial-failure readout. */
  readonly stageFailures: readonly { stage: string; message: string }[];
  readonly currentStepLabel: string;
  readonly isSurpriseMode: boolean;
  readonly progressPercent: number;

  setGenre(value: string): void;
  setTone(value: string): void;
  setDifficulty(value: string): void;
  setSetting(value: string): void;
  setGoals(value: string): void;

  advanceStep(): void;
  goBack(): void;

  generateWorld(): Promise<void>;
  retryGeneration(): Promise<void>;
  cancelGeneration(): void;
  changeConnection(): Promise<void>;
  acceptWorld(): Promise<void>;

  /**
   * Restores the newest durable draft and lands the wizard on the step that
   * draft belongs to.
   *
   * This is the page-reload path. Without it a real reload produced an empty
   * wizard even though the draft was on disk, because nothing re-read it.
   */
  initialize(): Promise<void>;

  surpriseMe(): void;

  restart(): void;
  editInputs(): void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered step sequence. */
const STEPS: readonly WizardStep[] = [
  'genre_tone',
  'setting_difficulty',
  'goals',
  'generating',
  'preview',
  'draft_saved',
] as const;

/** Index of the generating step. */
const GENERATING_STEP_INDEX = 3;

const FALLBACK_LABEL = 'Unknown';

export const GENRE_OPTIONS = [
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Cyberpunk',
  'Horror',
  'Post-Apocalyptic',
] as const;

export const TONE_OPTIONS = [
  'Heroic',
  'Dark',
  'Lighthearted',
  'Noir',
  'Mysterious',
  'Edgy',
  'Rebellious',
  'Lovecraftian',
  'Survival',
  'Hopeful',
  'Grim',
] as const;

export const DIFFICULTY_OPTIONS = ['Easy', 'Medium', 'Hard'] as const;

/** Maps a stage id to its label, tolerating an unknown id. */
export const worldGenStageLabel = (stage: string): string =>
  WORLD_GEN_STAGE_LABELS[stage as WorldGenDraftStage] ?? stage;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export class WorldGenWizardViewModel
  extends BaseViewModel<WorldGenWizardViewModelOptions>
  implements WorldGenWizardViewModelInterface
{
  private readonly _router: WorldGenRouterCapabilities;
  private readonly _drafts: WorldGenDraftServiceInterface;

  private _currentStepIndex = $state(0);
  private _genre = $state('');
  private _tone = $state('');
  private _setting = $state('');
  private _difficulty = $state('Medium');
  private _goals = $state('');
  private _isSurpriseMode = $state(false);

  constructor(options: WorldGenWizardViewModelOptions) {
    super(options);
    this._router = options.router;
    this._drafts = options.drafts;

    const { initialInputs } = options;
    if (initialInputs) {
      this._genre = initialInputs.genre;
      this._tone = initialInputs.tone;
      this._setting = initialInputs.setting;
      this._difficulty = initialInputs.difficulty;
      this._goals = initialInputs.goals;
    }
  }

  // ── Getters ──

  get currentStep(): WizardStep {
    return STEPS[this._currentStepIndex] ?? STEPS[0];
  }

  get steps(): readonly WizardStep[] {
    return STEPS;
  }

  get genre(): string {
    return this._genre;
  }

  get tone(): string {
    return this._tone;
  }

  get setting(): string {
    return this._setting;
  }

  get difficulty(): string {
    return this._difficulty;
  }

  get goals(): string {
    return this._goals;
  }

  get draft(): WorldGenDraft | undefined {
    return this._drafts.draft;
  }

  get isGenerating(): boolean {
    return this._drafts.run?.status === 'running';
  }

  get generationError(): string | undefined {
    const run = this._drafts.run;
    if (run?.status === 'cancelled') {
      return run.error ?? 'Cancelled';
    }
    if (run?.status === 'failed') {
      return run.error;
    }
    return undefined;
  }

  get retryStatus(): string | undefined {
    const run = this._drafts.run;
    if (run === undefined || run.status !== 'running' || run.failures.length === 0) {
      return undefined;
    }
    const last = run.failures[run.failures.length - 1];
    return last === undefined
      ? undefined
      : `Retrying after ${worldGenStageLabel(last.stage)} failed: ${last.message}`;
  }

  get canAdvance(): boolean {
    switch (this.currentStep) {
      case 'genre_tone':
        return this._genre.length > 0 && this._tone.length > 0;
      case 'setting_difficulty':
        return this._setting.length > 0 && this._difficulty.length > 0;
      case 'goals':
        return this._goals.length > 0;
      default:
        return true;
    }
  }

  get isFirstStep(): boolean {
    return this._currentStepIndex === 0;
  }

  get isLastInputStep(): boolean {
    return this._currentStepIndex === GENERATING_STEP_INDEX - 1;
  }

  get canCancel(): boolean {
    return this.isGenerating;
  }

  get canAccept(): boolean {
    return this._drafts.draft?.status === 'complete';
  }

  get persistence(): WorldGenDraftPersistence {
    return this._drafts.persistence;
  }

  get diagnostics(): readonly WorldGenDraftDiagnostic[] {
    return this._drafts.diagnostics;
  }

  get completedStageLabels(): readonly string[] {
    return (this._drafts.run?.completedStages ?? []).map(worldGenStageLabel);
  }

  get stageFailures(): readonly { stage: string; message: string }[] {
    return (this._drafts.run?.failures ?? []).map((failure) => ({
      stage: worldGenStageLabel(failure.stage),
      message: failure.message,
    }));
  }

  get currentStepLabel(): string {
    return STEP_LABELS[this.currentStep] ?? FALLBACK_LABEL;
  }

  get isSurpriseMode(): boolean {
    return this._isSurpriseMode;
  }

  get progressPercent(): number {
    return Math.round((this._currentStepIndex / (STEPS.length - 1)) * 100);
  }

  // ── Step setters ──

  setGenre(value: string): void {
    this._genre = value;
    this._isSurpriseMode = false;
  }

  setTone(value: string): void {
    this._tone = value;
    this._isSurpriseMode = false;
  }

  setDifficulty(value: string): void {
    if (DIFFICULTY_OPTIONS.includes(value as (typeof DIFFICULTY_OPTIONS)[number])) {
      this._difficulty = value;
      this._isSurpriseMode = false;
    }
  }

  setSetting(value: string): void {
    this._setting = value;
    this._isSurpriseMode = false;
  }

  setGoals(value: string): void {
    this._goals = value;
    this._isSurpriseMode = false;
  }

  // ── Navigation ──

  advanceStep(): void {
    if (!this.canAdvance) {
      return;
    }
    const next = this._currentStepIndex + 1;
    if (next < STEPS.length) {
      this._currentStepIndex = next;
    }
  }

  goBack(): void {
    if (this._currentStepIndex <= 0) {
      return;
    }
    // Leaving a live run by hand is a cancellation, not a pause. This runs
    // BEFORE the step is moved, because `isGenerating` is derived from the
    // draft service's live run and is independent of which step we land on.
    this._cancelIfRunning();
    this._currentStepIndex = this._previousStepIndex(this._currentStepIndex);
  }

  // ── Generation ──

  async generateWorld(): Promise<void> {
    // Single-flight: a second Generate while a run is live is ignored. The
    // draft service owns this guard too; repeating it here keeps the wizard's
    // own step machine from advancing a second time.
    if (this.isGenerating) {
      this.debug('generateWorld:ignored-already-running');
      return;
    }
    this._currentStepIndex = GENERATING_STEP_INDEX;
    const draft = await this._drafts.generate({ input: this._buildInput() });
    if (draft !== undefined && this.currentStep === 'generating') {
      this._currentStepIndex = this._indexOf('preview');
    }
  }

  /**
   * Re-runs generation after a failure.
   *
   * Stages that already succeeded keep their checkpoints, so only the stages
   * that failed are re-issued.
   */
  async retryGeneration(): Promise<void> {
    if (this.isGenerating) {
      return;
    }
    await this.generateWorld();
  }

  cancelGeneration(): void {
    this._drafts.cancel('Cancelled by the player');
  }

  async changeConnection(): Promise<void> {
    this._cancelIfRunning();
    await this._router.goToRoute('setup', {
      queryParameters: { reason: 'generation-failed' },
      pathParameters: undefined,
    });
  }

  /**
   * Accepts the draft, privately and durably.
   *
   * This does not create a world, a campaign, an NPC, a map or a save, and it
   * publishes nothing to the live combat GM context. It marks the private draft
   * row accepted; the wizard then reads that same row back.
   */
  async acceptWorld(): Promise<void> {
    const accepted = await this._drafts.accept();
    if (accepted !== undefined) {
      this._currentStepIndex = this._indexOf('draft_saved');
    }
  }

  // ── Hydration ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const draft = await this._drafts.initialize();
    if (draft === undefined) {
      return;
    }
    // The inputs come back with the draft, so the wizard's own fields match
    // what the user actually typed before the reload rather than resetting to
    // the defaults.
    this._genre = draft.input.genre;
    this._tone = draft.input.tone;
    this._setting = draft.input.setting;
    this._difficulty = draft.input.difficulty;
    this._goals = draft.input.goals;
    this._isSurpriseMode = false;
    this._currentStepIndex = this._indexOf(
      draft.status === 'accepted_preview' ? 'draft_saved' : 'preview',
    );
  }

  // ── Surprise Me ──

  surpriseMe(): void {
    const preset = getRandomPreset();
    this._genre = preset.genre;
    this._tone = preset.tone;
    this._setting = preset.setting;
    this._difficulty = preset.difficulty;
    this._goals = preset.goals;
    this._isSurpriseMode = true;
  }

  // ── Reset / Edit ──

  restart(): void {
    this._cancelIfRunning();
    this._currentStepIndex = 0;
    this._genre = '';
    this._tone = '';
    this._setting = '';
    this._difficulty = 'Medium';
    this._goals = '';
    this._isSurpriseMode = false;
  }

  editInputs(): void {
    this._cancelIfRunning();
    this._currentStepIndex = 0;
  }

  // ── Disposal ──

  /**
   * Cancels any live run before the base class tears the reactive roots down.
   *
   * Abort is synchronous, so a provider call that is still in flight observes
   * it immediately and cannot write into a disposed ViewModel.
   */
  override async dispose(): Promise<void> {
    this._drafts.cancel('Wizard disposed');
    await this._drafts.dispose();
    await super.dispose();
  }

  // ── Private helpers ──

  private _cancelIfRunning(): void {
    if (this.isGenerating) {
      this._drafts.cancel('Wizard navigated away');
    }
  }

  /**
   * The step Back lands on.
   *
   * `generating` is a progress screen, not a step a player can return to: it
   * only has content while a run is live, and there is no run to go back to
   * once one has finished. Decrementing straight into it — which is what the
   * previous version did, from `preview` and `draft_saved` — parked the wizard
   * on an empty screen whose only button was Cancel against a run that had
   * already ended. It is skipped, so Back from the preview lands on the last
   * answer the player actually gave.
   */
  private _previousStepIndex(from: number): number {
    const candidate = from - 1;
    const index = candidate === GENERATING_STEP_INDEX ? candidate - 1 : candidate;
    return index < 0 ? 0 : index;
  }

  private _indexOf(step: WizardStep): number {
    const index = STEPS.indexOf(step);
    return index < 0 ? 0 : index;
  }

  private _buildInput(): WorldGenInput {
    return {
      genre: this._genre,
      tone: this._tone,
      setting: this._setting,
      difficulty: this._difficulty,
      goals: this._goals,
    };
  }
}

/** Builds a world-generation wizard ViewModel from explicit capabilities. */
export const createWorldGenWizardViewModel = (
  options: WorldGenWizardViewModelOptions,
): WorldGenWizardViewModelInterface => WorldGenWizardViewModel.create(options);
