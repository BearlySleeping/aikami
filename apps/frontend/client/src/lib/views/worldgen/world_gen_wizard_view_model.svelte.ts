// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts
//
// Wizard state machine for the World Generation Wizard (C-233).
// Manages step flow: Genre/Tone → Setting/Difficulty → Goals → Generating →
// Preview → Character Creation. Supports Surprise Me! one-click mode,
// retry logic (3 auto-retries), and GM prompt assembly.
//
// Contract: C-233

import { STEP_LABELS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { WizardStep, WorldGenInput, WorldGenOutput } from '@aikami/types';
import { getRandomPreset } from '@aikami/types';
import {
  WorldGenHudWidgetsStageSchema,
  WorldGenLocationsStageSchema,
  WorldGenNpcsStageSchema,
  WorldGenPartyArcsStageSchema,
  WorldGenSchema,
  WorldGenSettingStageSchema,
} from '$lib/data/ai_prompts/world_gen_schema';
import { WORLD_GEN_SYSTEM_PROMPT } from '$lib/data/ai_prompts/world_gen_system_prompt';
import {
  campaignService,
  routerService,
  textGenerationService,
  worldGenSeedingService,
  worldStateService,
} from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorldGenWizardViewModelOptions = BaseViewModelOptions & {
  /** Pre-populated inputs for editing (e.g. from a previous session). */
  initialInputs?: WorldGenInput;
  /** Optional callback when the wizard completes world generation. */
  onWorldAccepted?: (output: WorldGenOutput) => Promise<void>;
};

/** Public interface for the wizard ViewModel. */
export type WorldGenWizardViewModelInterface = BaseViewModelInterface & {
  /** Current wizard step. */
  readonly currentStep: WizardStep;
  /** Ordered list of all steps for the step indicator. */
  readonly steps: readonly WizardStep[];
  /** Current genre selection. */
  readonly genre: string;
  /** Current tone selection. */
  readonly tone: string;
  /** Current setting description. */
  readonly setting: string;
  /** Current difficulty selection. */
  readonly difficulty: string;
  /** Current goals text. */
  readonly goals: string;
  /** Generated world output (undefined until generation completes). */
  readonly worldOutput: WorldGenOutput | undefined;
  /** Whether a generation request is in progress. */
  readonly isGenerating: boolean;
  /** Error message from the last generation attempt. */
  readonly generationError: string | undefined;
  /** Progress message shown during auto-retry. */
  readonly retryStatus: string | undefined;
  /** Whether the current step can advance to the next. */
  readonly canAdvance: boolean;
  /** Whether the wizard is on the first step (no going back). */
  readonly isFirstStep: boolean;
  /** Whether the wizard is on the last input step (ready to generate). */
  readonly isLastInputStep: boolean;
  /** Number of retries remaining. */
  readonly retriesRemaining: number;
  /** Human-readable step label for display. */
  readonly currentStepLabel: string;
  /** GM prompt preview — assembled inputs formatted for the LLM. */
  readonly gmPromptPreview: string;
  /** Whether Surprise Me mode is active (auto-generated inputs). */
  readonly isSurpriseMode: boolean;
  /** Progress percentage through the wizard (0-100). */
  readonly progressPercent: number;

  // ── Step setters ──
  setGenre(value: string): void;
  setTone(value: string): void;
  setDifficulty(value: string): void;
  setSetting(value: string): void;
  setGoals(value: string): void;

  // ── Navigation ──
  advanceStep(): void;
  goBack(): void;

  // ── Generation ──
  generateWorld(): Promise<void>;
  retryGeneration(): Promise<void>;
  /** Navigates to /capability to change the AI connection. */
  changeConnection(): Promise<void>;
  acceptWorld(): Promise<void>;

  // ── Surprise Me ──
  surpriseMe(): void;

  // ── Navigation to Character Creation ──
  navigateToCharacterCreation(): Promise<void>;

  // ── Reset / Edit ──
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
  'character_creation',
] as const;

/** Step index threshold for input vs output phases. */
const GENERATING_STEP_INDEX = 3;

/** Maximum auto-retries on LLM failure before showing error. */
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// C-405 AC-5: parallel generation stages
// ---------------------------------------------------------------------------
//
// Dependency graph (written down before parallelizing — OQ-3):
//   setting | npcs | locations | hudWidgets  — mutually independent
//   partyArcs                                 — DEPENDS on npcs: arcs reference
//                                               NPC names as questGivers, so
//                                               the arcs call runs only after
//                                               the NPC roster resolves.

/** The five generation stages. */
type GenerationStage = 'setting' | 'npcs' | 'locations' | 'hudWidgets' | 'partyArcs';

/** Per-stage TypeBox schema used for LLM structured-output validation. */
const STAGE_SCHEMAS: Record<GenerationStage, Record<string, unknown>> = {
  setting: WorldGenSettingStageSchema,
  npcs: WorldGenNpcsStageSchema,
  locations: WorldGenLocationsStageSchema,
  hudWidgets: WorldGenHudWidgetsStageSchema,
  partyArcs: WorldGenPartyArcsStageSchema,
} as const;

/** Human-readable label for each stage (used in stage prompts). */
const STAGE_LABELS: Record<GenerationStage, string> = {
  setting: 'the world name and description',
  npcs: 'the NPC roster',
  locations: 'the location list',
  hudWidgets: 'the HUD widget blueprints',
  partyArcs: 'the party story arcs',
} as const;

/** Minimal JSON shape hint embedded in each stage prompt. */
const STAGE_SHAPE_HINTS: Record<GenerationStage, string> = {
  setting: '{ "worldName": "...", "worldDescription": "..." }',
  npcs: '{ "npcs": [ { "name": "...", "race": "...", "class": "...", "role": "...", "description": "...", "personality": "..." } ] }',
  locations: '{ "locations": [ "...", "...", "..." ] }',
  hudWidgets:
    '{ "hudWidgets": [ { "slot": "...", "label": "...", "icon": "...", "defaultVisibility": true } ] }',
  partyArcs:
    '{ "partyArcs": [ { "chapter": "...", "description": "...", "objectives": [ "..." ], "questGivers": [ "<NPC name from the roster>" ] } ] }',
} as const;

/** Fallback step label if not found. */
const FALLBACK_LABEL = 'Unknown';

/** All available genre options for chips. */
export const GENRE_OPTIONS = [
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Cyberpunk',
  'Horror',
  'Post-Apocalyptic',
] as const;

/** All available tone options for chips. */
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

/** All available difficulty options. */
export const DIFFICULTY_OPTIONS = ['Easy', 'Medium', 'Hard'] as const;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export class WorldGenWizardViewModel
  extends BaseViewModel<WorldGenWizardViewModelOptions>
  implements WorldGenWizardViewModelInterface
{
  // ── Instance fields ──

  private readonly _onWorldAccepted: ((output: WorldGenOutput) => Promise<void>) | undefined;
  private _currentStepIndex = $state(0);
  private _genre = $state('');
  private _tone = $state('');
  private _setting = $state('');
  private _difficulty = $state('Medium');
  private _goals = $state('');
  private _worldOutput = $state<WorldGenOutput | undefined>();
  private _isGenerating = $state(false);
  private _generationError = $state<string | undefined>();
  private _retriesRemaining = $state(MAX_RETRIES);
  private _isSurpriseMode = $state(false);
  /** Progress message during auto-retry (e.g. "Retrying... (2/3)"). */
  private _retryStatus = $state<string | undefined>();

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

  get worldOutput(): WorldGenOutput | undefined {
    return this._worldOutput;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  get generationError(): string | undefined {
    return this._generationError;
  }

  /** Progress message shown during auto-retry attempts. */
  get retryStatus(): string | undefined {
    return this._retryStatus;
  }

  get canAdvance(): boolean {
    switch (this.currentStep) {
      case 'genre_tone':
        return this._genre.length > 0 && this._tone.length > 0;
      case 'setting_difficulty':
        return this._setting.length > 0 && this._difficulty.length > 0;
      case 'goals':
        return this._goals.length > 0;
      case 'generating':
      case 'preview':
      case 'character_creation':
        return true;
      default:
        return false;
    }
  }

  get isFirstStep(): boolean {
    return this._currentStepIndex === 0;
  }

  get isLastInputStep(): boolean {
    return this._currentStepIndex === GENERATING_STEP_INDEX - 1;
  }

  get retriesRemaining(): number {
    return this._retriesRemaining;
  }

  get currentStepLabel(): string {
    return STEP_LABELS[this.currentStep] ?? FALLBACK_LABEL;
  }

  get gmPromptPreview(): string {
    return this._assembleGmPrompt();
  }

  get isSurpriseMode(): boolean {
    return this._isSurpriseMode;
  }

  get progressPercent(): number {
    return Math.round((this._currentStepIndex / (STEPS.length - 1)) * 100);
  }

  // ── Constructor ──

  constructor(options: WorldGenWizardViewModelOptions) {
    super(options);

    const { initialInputs, onWorldAccepted } = options;

    this._onWorldAccepted = onWorldAccepted;

    if (initialInputs) {
      this._genre = initialInputs.genre;
      this._tone = initialInputs.tone;
      this._setting = initialInputs.setting;
      this._difficulty = initialInputs.difficulty;
      this._goals = initialInputs.goals;
    }
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

    const nextIndex = this._currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      this._currentStepIndex = nextIndex;
      this._generationError = undefined;
    }
  }

  goBack(): void {
    if (this._currentStepIndex > 0) {
      this._currentStepIndex--;
      this._generationError = undefined;
    }
  }

  // ── Generation ──

  async generateWorld(): Promise<void> {
    this._isGenerating = true;
    this._generationError = undefined;
    this._retryStatus = undefined;
    this._retriesRemaining = MAX_RETRIES;

    // Advance to generating step
    this._currentStepIndex = GENERATING_STEP_INDEX;

    await this._performGeneration();
  }

  async retryGeneration(): Promise<void> {
    if (this._retriesRemaining <= 0 || this._isGenerating) {
      return;
    }

    this._retriesRemaining--;
    this._generationError = undefined;
    this._retryStatus = undefined;
    this._isGenerating = true;

    await this._performGeneration();
  }

  /** Navigates back to capability screen to change the AI connection. */
  async changeConnection(): Promise<void> {
    await routerService.goToRoute('capability', {
      queryParameters: { reason: 'generation-failed' },
      pathParameters: undefined,
    });
  }

  async acceptWorld(): Promise<void> {
    if (!this._worldOutput) {
      return;
    }

    const output = this._worldOutput;
    this.debug('acceptWorld:seeding', { worldName: output.worldName });

    // Initialize world state before seeding — creates the world and a
    // default location so NPCs and events have a place to attach to.
    const campaignId = campaignService.activeCampaign?.id ?? crypto.randomUUID();
    await worldStateService.subscribeToWorld(campaignId);
    worldStateService.addLocation({
      name: output.locations[0] ?? 'Town Square',
      description: output.worldDescription,
    });

    // Seed generated data into game state
    await worldGenSeedingService.seedNpcs({ npcs: output.npcs });
    await worldGenSeedingService.seedLocations({
      locations: output.locations,
      worldName: output.worldName,
    });
    await worldGenSeedingService.seedPartyArcs({ arcs: output.partyArcs });
    await worldGenSeedingService.seedHudWidgets({ widgets: output.hudWidgets });

    if (this._onWorldAccepted) {
      await this._onWorldAccepted(output);
    }

    // Advance to character creation step
    const charCreationIndex = STEPS.indexOf('character_creation');
    if (charCreationIndex >= 0) {
      this._currentStepIndex = charCreationIndex;
    }
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

    this._generationError = undefined;
  }

  // ── Navigation to Character Creation ──

  async navigateToCharacterCreation(): Promise<void> {
    this.debug('navigateToCharacterCreation');
    await routerService.goToRoute('personas', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  // ── Reset / Edit ──

  restart(): void {
    this._currentStepIndex = 0;
    this._genre = '';
    this._tone = '';
    this._setting = '';
    this._difficulty = 'Medium';
    this._goals = '';
    this._worldOutput = undefined;
    this._isGenerating = false;
    this._generationError = undefined;
    this._retriesRemaining = MAX_RETRIES;
    this._isSurpriseMode = false;
  }

  editInputs(): void {
    // Go back to the first input step
    this._currentStepIndex = 0;
    this._worldOutput = undefined;
    this._generationError = undefined;
  }

  // ── Private helpers ──

  /**
   * Calls the LLM to generate a world from current inputs.
   * On failure, triggers auto-retry logic.
   * C-405 AC-5: independent stages (setting, npcs, locations, hudWidgets) are
   * issued concurrently; partyArcs run after npcs resolves.
   */
  private async _performGeneration(): Promise<void> {
    try {
      const input = this._buildInput();

      // Stage A — mutually independent sections, issued concurrently.
      const [settingRaw, npcsRaw, locationsRaw, hudWidgetsRaw] = await Promise.all([
        this._generateStage(input, 'setting'),
        this._generateStage(input, 'npcs'),
        this._generateStage(input, 'locations'),
        this._generateStage(input, 'hudWidgets'),
      ]);

      // Stage B — party arcs reference NPC names as quest-givers, so they
      // must wait for the NPC roster before resolving.
      const npcNames = (Array.isArray(npcsRaw.npcs) ? npcsRaw.npcs : []).map(
        (npc: unknown) => (npc as { name?: unknown }).name as string,
      );
      const arcsRaw = await this._generateStage(input, 'partyArcs', npcNames);

      const parsed = this._mergeStages({
        settingRaw,
        npcsRaw,
        locationsRaw,
        hudWidgetsRaw,
        arcsRaw,
      });

      if (!parsed.worldName || !parsed.worldDescription || !Array.isArray(parsed.npcs)) {
        throw new Error('LLM response missing required fields');
      }

      this._worldOutput = parsed;
      this._isGenerating = false;
      this._retryStatus = undefined;

      const previewIndex = STEPS.indexOf('preview');
      if (previewIndex >= 0) {
        this._currentStepIndex = previewIndex;
      }
    } catch (error) {
      this.warn('_performGeneration:failed', error);

      const reason = error instanceof Error ? error.message : 'Unknown error';

      if (this._retriesRemaining > 0) {
        this._retriesRemaining--;
        const attempt = MAX_RETRIES - this._retriesRemaining;
        this._retryStatus = `Failed: ${reason}. Retrying... (${attempt}/${MAX_RETRIES})`;
        await this._performGeneration();
      } else {
        this._generationError = reason;
        this._isGenerating = false;
        this._retryStatus = undefined;
      }
    }
  }

  /**
   * Builds a WorldGenInput from current state.
   */
  private _buildInput(): WorldGenInput {
    return {
      genre: this._genre,
      tone: this._tone,
      setting: this._setting,
      difficulty: this._difficulty,
      goals: this._goals,
    };
  }

  /**
   * Assembles the prompt text sent to the LLM.
   * Combines the system prompt with user input values.
   */
  private _assembleGmPrompt(): string {
    const input = this._buildInput();
    return [
      WORLD_GEN_SYSTEM_PROMPT,
      '',
      '## User Input',
      JSON.stringify(input, null, 2),
      '',
      '## Response',
      'Return ONLY valid JSON matching the schema. No markdown fences, no explanations.',
    ].join('\n');
  }

  /**
   * Calls the LLM to generate a world.
   * C-405 AC-5: generation is split into stages; `schema` selects the
   * per-stage TypeBox schema for structured output validation. The dev
   * sandbox overrides this method with a fixed signature and returns the
   * full mock output — each stage parser extracts its own section from it.
   */
  protected async _callLlm(
    _input: WorldGenInput,
    prompt: string,
    schema: Record<string, unknown> = WorldGenSchema as unknown as Record<string, unknown>,
  ): Promise<string | undefined> {
    this.debug('_callLlm:calling-textGenerationService');

    try {
      const result = await textGenerationService.extractStructure({
        schema,
        schemaName: 'WorldGenOutput',
        prompt,
        systemPrompt: WORLD_GEN_SYSTEM_PROMPT,
      });

      if (result === undefined) {
        return undefined;
      }

      this.debug('_callLlm:success', { outputLength: JSON.stringify(result).length });
      return JSON.stringify(result);
    } catch (error) {
      this.error('_callLlm:failed', { error });
      throw error;
    }
  }

  /**
   * Runs one generation stage: assembles the stage prompt, calls the LLM with
   * the stage schema, and parses the JSON response. Throws 'LLM returned
   * empty response' when the LLM yields nothing — the same contract the
   * retry logic in {@link _performGeneration} already handles.
   */
  private async _generateStage(
    input: WorldGenInput,
    stage: GenerationStage,
    npcNames?: string[],
  ): Promise<Record<string, unknown>> {
    const prompt = this._assembleStagePrompt(input, stage, npcNames);
    const rawOutput = await this._callLlm(input, prompt, STAGE_SCHEMAS[stage]);

    if (!rawOutput) {
      throw new Error('LLM returned empty response');
    }

    return JSON.parse(rawOutput) as Record<string, unknown>;
  }

  /**
   * Assembles a stage-specific prompt. For partyArcs, the resolved NPC roster
   * is embedded so questGivers reference real NPC names.
   */
  private _assembleStagePrompt(
    input: WorldGenInput,
    stage: GenerationStage,
    npcNames?: string[],
  ): string {
    const lines = [WORLD_GEN_SYSTEM_PROMPT, '', '## User Input', JSON.stringify(input, null, 2)];

    if (stage === 'partyArcs') {
      lines.push('', '## NPC Roster (already generated)', JSON.stringify(npcNames ?? [], null, 2));
      lines.push('The questGivers array MUST contain only names from this roster.');
    }

    lines.push(
      '',
      `## Task`,
      `Generate ONLY ${STAGE_LABELS[stage]} for this world. Do NOT generate any other section.`,
      '',
      '## Response',
      `Return ONLY valid JSON matching this shape: ${STAGE_SHAPE_HINTS[stage]}. No markdown fences, no explanations.`,
    );

    return lines.join('\n');
  }

  /**
   * Merges the per-stage results into a full WorldGenOutput.
   * Runtime validation of the merged shape happens in _performGeneration.
   */
  private _mergeStages(options: {
    settingRaw: Record<string, unknown>;
    npcsRaw: Record<string, unknown>;
    locationsRaw: Record<string, unknown>;
    hudWidgetsRaw: Record<string, unknown>;
    arcsRaw: Record<string, unknown>;
  }): WorldGenOutput {
    const { settingRaw, npcsRaw, locationsRaw, hudWidgetsRaw, arcsRaw } = options;

    return {
      worldName: String(settingRaw.worldName ?? ''),
      worldDescription: String(settingRaw.worldDescription ?? ''),
      npcs: Array.isArray(npcsRaw.npcs) ? npcsRaw.npcs : [],
      locations: Array.isArray(locationsRaw.locations) ? locationsRaw.locations : [],
      partyArcs: Array.isArray(arcsRaw.partyArcs) ? arcsRaw.partyArcs : [],
      hudWidgets: Array.isArray(hudWidgetsRaw.hudWidgets) ? hudWidgetsRaw.hudWidgets : [],
    } as WorldGenOutput;
  }
}

/** Factory function for the wizard ViewModel. */
export const getWorldGenWizardViewModel = (
  options: WorldGenWizardViewModelOptions,
): WorldGenWizardViewModelInterface => WorldGenWizardViewModel.create(options);
