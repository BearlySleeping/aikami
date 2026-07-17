// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts
//
// Onboarding coordinator ViewModel — orchestrates the fast character onboarding
// flow: starter hero selection, 4-step custom creation, draft persistence,
// persona assembly, campaign attachment, and Session Zero routing.
// Contract: C-319 Replace /setup with Fast Character Onboarding
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import type {
  AppearancePreset,
  ClassPreset,
  OnboardingStep,
  PronounSet,
  SpeciesOption,
  StarterHero,
} from '@aikami/constants';
import {
  ABILITY_LABELS,
  APPEARANCE_PRESETS,
  CLASS_PRESETS,
  DEFAULT_LPC_RECIPE,
  DND_STANDARD_ARRAY,
  ONBOARDING_STEPS,
  PLAY_STYLE_TAGS,
  PRONOUN_SETS,
  RANDOM_BACKGROUNDS,
  RANDOM_FANTASY_NAMES,
  RANDOM_PERSONALITIES,
  SPECIES_OPTIONS,
  STARTER_HEROES,
} from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { OnboardingDraft, PersonaData, SetupMode } from '@aikami/types';
import { campaignService, routerService } from '$services';

// ── Constants ──────────────────────────────────────────────────────────

const DRAFT_KEY = 'aikami-onboarding-draft' as const;
const EMPTY_SCORES: Record<string, number> = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/** Canonical render-order for LPC slots. Matches engine ordering. */
const ENGINE_SLOTS = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

/** LPC slot labels for the appearance step UI. */
const LPC_SLOT_LABELS: Record<string, string> = {
  body: 'Body',
  hair: 'Hair',
  head: 'Head',
  torso: 'Torso',
  legs: 'Legs',
  feet: 'Feet',
};

// ── Interface ──────────────────────────────────────────────────────────

export type OnboardingCoordinatorViewModelInterface = BaseViewModelInterface & {
  readonly mode: SetupMode;
  readonly step: OnboardingStep;
  readonly stepIndex: number;
  readonly starterHeroes: readonly StarterHero[];
  readonly isTextProviderAvailable: boolean;
  readonly isConfirming: boolean;
  readonly canGoNext: boolean;
  readonly classPresets: readonly ClassPreset[];
  readonly speciesOptions: readonly SpeciesOption[];
  readonly pronounSets: readonly PronounSet[];
  readonly abilityLabels: typeof ABILITY_LABELS;
  readonly playStyleTags: typeof PLAY_STYLE_TAGS;
  readonly appearancePresets: readonly AppearancePreset[];
  readonly hasDraft: boolean;

  // Starter path
  selectStarterHero(hero: StarterHero): Promise<void>;

  // Custom path
  startCustom(): void;
  nextStep(): void;
  previousStep(): void;
  randomizeCharacter(): void;

  // Custom path state (bound by step views)
  name: string;
  pronounId: string;
  raceId: string;
  classId: string;
  alignment: string;
  abilityScores: Record<string, number>;
  appearanceDescription: string;
  background: string;
  personalityTraits: string;
  equipment: string[];

  // Step mutators
  setName(value: string): void;
  setPronounId(value: string): void;
  setRaceId(value: string): void;
  setClassId(value: string): void;
  setAlignment(value: string): void;
  setAppearanceDescription(value: string): void;
  setBackground(value: string): void;
  setPersonalityTraits(value: string): void;
  adjustAbilityScore(key: string, delta: number): void;

  // Selected class/race resolved data
  readonly selectedClass: ClassPreset | undefined;
  readonly selectedRace: SpeciesOption | undefined;
  readonly selectedPronoun: PronounSet | undefined;

  // LPC appearance state
  lpcRecipe: Record<string, string>;
  paletteOverrides: Record<string, string>;
  selectedPresetId: string | undefined;
  previewPlaying: boolean;
  readonly lpcPreviewRecipes: LpcLayerRecipe[];
  readonly availableLpcSlots: Array<{
    slot: string;
    label: string;
    variants: Array<{ assetId: string; label: string }>;
  }>;
  selectAppearancePreset(presetId: string): void;
  setLpcLayer(slotName: string, assetId: string): void;
  setPaletteOverride(slotName: string, hexColor: string): void;
  togglePreviewAnimation(): void;

  // Finalize
  confirmAndEnter(): Promise<void>;

  // Session Zero
  startSessionZero(): void;
};

// ── Options ────────────────────────────────────────────────────────────

export type OnboardingCoordinatorViewModelOptions = BaseViewModelOptions;

// ── Implementation ─────────────────────────────────────────────────────

class OnboardingCoordinatorViewModel
  extends BaseViewModel<OnboardingCoordinatorViewModelOptions>
  implements OnboardingCoordinatorViewModelInterface
{
  // ── Reactive state ─────────────────────────────────────────────────

  mode: SetupMode = $state('starter_select');
  step: OnboardingStep = $state('identity');
  isConfirming = $state(false);

  // Custom path form fields
  name = $state('');
  pronounId = $state('he_him');
  raceId = $state('');
  classId = $state('');
  alignment = $state('True Neutral');
  abilityScores = $state<Record<string, number>>({ ...EMPTY_SCORES });
  appearanceDescription = $state('');
  background = $state('');
  personalityTraits = $state('');
  equipment = $state<string[]>([]);

  // LPC appearance state
  lpcRecipe = $state<Record<string, string>>({ ...DEFAULT_LPC_RECIPE });
  paletteOverrides = $state<Record<string, string>>({});
  selectedPresetId = $state<string | undefined>(undefined);
  previewPlaying = $state(false);

  // ── Computed ──────────────────────────────────────────────────────

  get stepIndex(): number {
    return ONBOARDING_STEPS.indexOf(this.step);
  }

  get starterHeroes(): readonly StarterHero[] {
    return STARTER_HEROES;
  }

  get classPresets(): readonly ClassPreset[] {
    return CLASS_PRESETS;
  }

  get speciesOptions(): readonly SpeciesOption[] {
    return SPECIES_OPTIONS;
  }

  get pronounSets(): readonly PronounSet[] {
    return PRONOUN_SETS;
  }

  get abilityLabels(): typeof ABILITY_LABELS {
    return ABILITY_LABELS;
  }

  get playStyleTags(): typeof PLAY_STYLE_TAGS {
    return PLAY_STYLE_TAGS;
  }

  get appearancePresets(): readonly AppearancePreset[] {
    return APPEARANCE_PRESETS;
  }

  get isTextProviderAvailable(): boolean {
    const campaign = campaignService.activeCampaign;
    return campaign?.capabilityProfile?.textProvider ?? true;
  }

  get hasDraft(): boolean {
    try {
      return localStorage.getItem(DRAFT_KEY) !== null;
    } catch {
      return false;
    }
  }

  get canGoNext(): boolean {
    if (this.mode !== 'custom') {
      return false;
    }
    if (this.step === 'identity') {
      return this.name.trim().length > 0 && this.raceId.length > 0;
    }
    if (this.step === 'play_style') {
      return this.classId.length > 0;
    }
    return true;
  }

  get selectedClass(): ClassPreset | undefined {
    return CLASS_PRESETS.find((c) => c.id === this.classId);
  }

  get selectedRace(): SpeciesOption | undefined {
    return SPECIES_OPTIONS.find((s) => s.id === this.raceId);
  }

  get selectedPronoun(): PronounSet | undefined {
    return PRONOUN_SETS.find((p) => p.id === this.pronounId);
  }

  /**
   * Builds LpcLayerRecipe[] from the current lpcRecipe + paletteOverrides.
   * Recipes are ordered by engine slot priority (body, hair, torso, legs, feet, head).
   */
  get lpcPreviewRecipes(): LpcLayerRecipe[] {
    const recipes: LpcLayerRecipe[] = [];

    for (const slot of ENGINE_SLOTS) {
      const assetId = this.lpcRecipe[slot];
      if (!assetId) {
        continue;
      }

      const hexColor = this.paletteOverrides[slot];
      const hexPalette = this._buildPaletteLut(hexColor);

      recipes.push({ slot, assetId, hexPalette });
    }

    return recipes;
  }

  /**
   * Returns the 6 engine LPC slots with their labels.
   *
   * Full variant lists are not exposed here to keep the coordinator thin.
   * The appearance step view imports variant data from the LPC catalog directly.
   */
  get availableLpcSlots(): Array<{
    slot: string;
    label: string;
    variants: Array<{ assetId: string; label: string }>;
  }> {
    return ENGINE_SLOTS.map((slot) => ({
      slot,
      label: LPC_SLOT_LABELS[slot] ?? slot,
      variants: [], // populated by the view from the catalog
    }));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this._recoverDraft();
    await super.initialize();
  }

  // ── Starter Path ──────────────────────────────────────────────────

  async selectStarterHero(hero: StarterHero): Promise<void> {
    this.debug('selectStarterHero', { heroId: hero.id });

    const persona = this._assemblePersonaFromStarter(hero);
    await this._attachPersonaToCampaign(persona);
  }

  // ── Custom Path Navigation ────────────────────────────────────────

  startCustom(): void {
    this.mode = 'custom';
    this.step = 'identity';
    this._ensureDefaultRecipe();
    this._saveDraft();
  }

  nextStep(): void {
    if (!this.canGoNext) {
      return;
    }

    // When transitioning from play_style to appearance, pre-fill scores
    // using standard array if class is selected and scores are still defaults
    if (this.step === 'play_style' && this.classId) {
      this._assignStandardArrayIfDefault();
    }

    const currentIndex = ONBOARDING_STEPS.indexOf(this.step);
    if (currentIndex >= 0 && currentIndex < ONBOARDING_STEPS.length - 1) {
      this.step = ONBOARDING_STEPS[currentIndex + 1];
      this._saveDraft();
    }
  }

  previousStep(): void {
    const currentIndex = ONBOARDING_STEPS.indexOf(this.step);
    if (currentIndex > 0) {
      this.step = ONBOARDING_STEPS[currentIndex - 1];
      this._saveDraft();
    }
  }

  // ── Step Mutators ─────────────────────────────────────────────────

  setName(value: string): void {
    this.name = value;
    this._saveDraft();
  }

  setPronounId(value: string): void {
    this.pronounId = value;
    this._saveDraft();
  }

  setRaceId(value: string): void {
    this.raceId = value;
    this._saveDraft();
  }

  setClassId(value: string): void {
    this.classId = value;
    // Pre-fill ability scores when class is selected
    this._assignStandardArrayIfDefault();
    this._saveDraft();
  }

  setAlignment(value: string): void {
    this.alignment = value;
    this._saveDraft();
  }

  setAppearanceDescription(value: string): void {
    this.appearanceDescription = value;
    this._saveDraft();
  }

  setBackground(value: string): void {
    this.background = value;
    this._saveDraft();
  }

  setPersonalityTraits(value: string): void {
    this.personalityTraits = value;
    this._saveDraft();
  }

  adjustAbilityScore(key: string, delta: number): void {
    const current = this.abilityScores[key];
    if (typeof current !== 'number') {
      return;
    }
    const next = current + delta;
    if (next < 8 || next > 15) {
      return;
    }
    this.abilityScores = { ...this.abilityScores, [key]: next };
    this._saveDraft();
  }

  // ── LPC Appearance ────────────────────────────────────────────────

  /**
   * Applies a curated appearance preset, replacing all layers.
   * Uses DEFAULT_LPC_RECIPE as fallback if the preset is not found.
   */
  selectAppearancePreset(presetId: string): void {
    const preset = APPEARANCE_PRESETS.find((p) => p.id === presetId);

    if (!preset) {
      this.warn('selectAppearancePreset:notFound', { presetId });
      return;
    }

    this.lpcRecipe = { ...preset.lpcLayers };
    this.paletteOverrides = { ...(preset.paletteOverrides ?? {}) };
    this.selectedPresetId = presetId;
    this.appearanceDescription = preset.description;
    this._saveDraft();
  }

  /** Updates a single LPC layer's asset ID. */
  setLpcLayer(slotName: string, assetId: string): void {
    this.lpcRecipe = { ...this.lpcRecipe, [slotName]: assetId };
    this.selectedPresetId = undefined;
    this._saveDraft();
  }

  /** Sets a palette override color for a specific slot. */
  setPaletteOverride(slotName: string, hexColor: string): void {
    this.paletteOverrides = { ...this.paletteOverrides, [slotName]: hexColor };
    this._saveDraft();
  }

  /** Toggles the preview animation playback. */
  togglePreviewAnimation(): void {
    this.previewPlaying = !this.previewPlaying;
  }

  // ── Randomize ─────────────────────────────────────────────────────

  randomizeCharacter(): void {
    const randomName =
      RANDOM_FANTASY_NAMES[Math.floor(Math.random() * RANDOM_FANTASY_NAMES.length)];
    const randomRace = SPECIES_OPTIONS[Math.floor(Math.random() * SPECIES_OPTIONS.length)];
    const randomClass = CLASS_PRESETS[Math.floor(Math.random() * CLASS_PRESETS.length)];
    const randomPronoun = PRONOUN_SETS[Math.floor(Math.random() * PRONOUN_SETS.length)];
    const randomPreset = APPEARANCE_PRESETS[Math.floor(Math.random() * APPEARANCE_PRESETS.length)];
    const randomBg = RANDOM_BACKGROUNDS[Math.floor(Math.random() * RANDOM_BACKGROUNDS.length)];
    const randomPers =
      RANDOM_PERSONALITIES[Math.floor(Math.random() * RANDOM_PERSONALITIES.length)];

    const alignments = [
      'Lawful Good',
      'Neutral Good',
      'Chaotic Good',
      'Lawful Neutral',
      'True Neutral',
      'Chaotic Neutral',
    ];
    const randomAlignment = alignments[Math.floor(Math.random() * alignments.length)];

    this.name = randomName;
    this.pronounId = randomPronoun.id;
    this.raceId = randomRace.id;
    this.classId = randomClass.id;
    this.alignment = randomAlignment;
    this.appearanceDescription = randomPreset.description;
    this.background = randomBg;
    this.personalityTraits = randomPers;

    // Apply random preset's LPC layers
    this.lpcRecipe = { ...randomPreset.lpcLayers };
    this.paletteOverrides = { ...(randomPreset.paletteOverrides ?? {}) };
    this.selectedPresetId = randomPreset.id;

    // Assign standard array with primary at 15, secondary at 14
    this._assignStandardArray();

    this._saveDraft();
  }

  // ── Finalize ──────────────────────────────────────────────────────

  async confirmAndEnter(): Promise<void> {
    if (this.isConfirming) {
      return;
    }

    this.isConfirming = true;

    try {
      const persona = this._assemblePersonaFromDraft();
      await this._attachPersonaToCampaign(persona);
    } catch (error) {
      this.error('confirmAndEnter:failed', error);
      this.isConfirming = false;
    }
  }

  // ── Session Zero ──────────────────────────────────────────────────

  startSessionZero(): void {
    this.debug('startSessionZero');
    this.mode = 'session_zero';
  }

  // ── Private: Persona Assembly ─────────────────────────────────────

  /** Creates a PersonaData object from a starter hero definition. */
  private _assemblePersonaFromStarter(hero: StarterHero): PersonaData {
    const pronounDisplay = `${hero.pronouns.subjective}/${hero.pronouns.objective}`;

    return {
      id: crypto.randomUUID(),
      name: hero.name,
      race: hero.race,
      class: hero.class,
      alignment: hero.alignment,
      abilityScores: hero.abilityScores,
      equipment: hero.equipment,
      appearance: { physicalDescription: hero.appearance },
      background: hero.background,
      personalityTraits: hero.personalityTraits,
      notes: `Pronouns: ${pronounDisplay}`,
      hitPoints: 10,
      hitPointsMax: 10,
      temporaryHitPoints: 0,
      armorClass: 10,
      speed: 30,
      experiencePoints: 0,
      savingThrows: [],
      skills: [],
      proficiencies: [],
      languages: ['Common'],
      inventory: [],
      isActive: false,
    };
  }

  /** Creates a PersonaData object from the current draft state. */
  private _assemblePersonaFromDraft(): PersonaData {
    const pronoun = this.selectedPronoun;
    const pronounDisplay = pronoun ? `${pronoun.subjective}/${pronoun.objective}` : 'they/them';

    return {
      id: crypto.randomUUID(),
      name: this.name.trim(),
      race: this.selectedRace?.label ?? this.raceId,
      class: this.selectedClass?.label ?? this.classId,
      alignment: this.alignment,
      abilityScores: this.abilityScores,
      equipment: this.selectedClass?.suggestedEquipment ?? [],
      appearance: {
        physicalDescription: this.appearanceDescription,
        lpcRecipe: { ...this.lpcRecipe },
      },
      background: this.background,
      personalityTraits: this.personalityTraits,
      notes: `Pronouns: ${pronounDisplay}`,
      hitPoints: 10,
      hitPointsMax: 10,
      temporaryHitPoints: 0,
      armorClass: 10,
      speed: 30,
      experiencePoints: 0,
      savingThrows: [],
      skills: [],
      proficiencies: [],
      languages: ['Common'],
      inventory: [],
      isActive: false,
    };
  }

  // ── Private: Campaign Attachment ──────────────────────────────────

  /** Attaches the persona to the campaign, completes setup, and navigates to /game. */
  private async _attachPersonaToCampaign(persona: PersonaData): Promise<void> {
    const campaign = campaignService.activeCampaign;
    if (!campaign) {
      this.error('_attachPersonaToCampaign:no-campaign');
      this.errorMessage = 'No active campaign found. Please return to the start menu.';
      return;
    }

    if (campaign.state !== 'creating') {
      this.error('_attachPersonaToCampaign:wrong-state', { state: campaign.state });
      this.errorMessage = 'Campaign is not ready for character creation.';
      return;
    }

    try {
      localStorage.setItem(`persona-${persona.id}`, JSON.stringify(persona));
      campaign.personaId = persona.id;
      campaignService.completeSetup();
      this._clearDraft();

      this.info('_attachPersonaToCampaign:complete', {
        personaId: persona.id,
        campaignId: campaign.id,
      });

      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('_attachPersonaToCampaign:failed', error);
      throw error;
    }
  }

  // ── Private: Ability Score Assignment ─────────────────────────────

  /** Assigns standard array with the selected class's primary/secondary stats. */
  private _assignStandardArray(): void {
    const cls = this.selectedClass;
    if (!cls) {
      return;
    }

    const scores: Record<string, number> = { ...EMPTY_SCORES };
    const abilityKeys = Object.keys(scores) as Array<keyof typeof scores>;

    scores[cls.primaryAbility] = DND_STANDARD_ARRAY[0]; // 15
    scores[cls.secondaryAbility] = DND_STANDARD_ARRAY[1]; // 14

    const remaining = abilityKeys.filter(
      (k) => k !== cls.primaryAbility && k !== cls.secondaryAbility,
    );
    const remainingValues = DND_STANDARD_ARRAY.slice(2);

    const shuffled = [...remainingValues].sort(() => Math.random() - 0.5);
    for (let i = 0; i < remaining.length; i++) {
      scores[remaining[i]] = shuffled[i];
    }

    this.abilityScores = scores;
  }

  /**
   * Assigns standard array scores only if the current scores are still
   * at their default values (all 10s).
   */
  private _assignStandardArrayIfDefault(): void {
    const allDefaults = Object.values(this.abilityScores).every((v) => v === 10);
    if (allDefaults) {
      this._assignStandardArray();
    }
  }

  // ── Private: Draft Persistence ────────────────────────────────────

  /** Saves the current draft state to localStorage. */
  private _saveDraft(): void {
    try {
      const draft: OnboardingDraft = {
        step: this.step,
        name: this.name,
        pronounId: this.pronounId,
        pronounDisplay: this.selectedPronoun
          ? `${this.selectedPronoun.subjective}/${this.selectedPronoun.objective}`
          : 'they/them',
        raceId: this.raceId,
        classId: this.classId,
        alignment: this.alignment,
        abilityScores: { ...this.abilityScores },
        appearanceDescription: this.appearanceDescription,
        background: this.background,
        personalityTraits: this.personalityTraits,
        equipment: [...this.equipment],
        lpcRecipe: { ...this.lpcRecipe },
        paletteOverrides: { ...this.paletteOverrides },
        selectedPresetId: this.selectedPresetId,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      this.warn('_saveDraft:failed', error);
    }
  }

  /** Recovers draft state from localStorage on mount. */
  private _recoverDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        return;
      }

      const draft = JSON.parse(raw) as OnboardingDraft;

      const raceExists = SPECIES_OPTIONS.some((s) => s.id === draft.raceId);
      const classExists = CLASS_PRESETS.some((c) => c.id === draft.classId);
      const pronounExists = PRONOUN_SETS.some((p) => p.id === draft.pronounId);

      if (!raceExists || !classExists || !pronounExists) {
        this.warn('_recoverDraft:stale-ids', {
          raceExists,
          classExists,
          pronounExists,
        });
        this._clearDraft();
        return;
      }

      this.mode = 'custom';
      this.step = draft.step;
      this.name = draft.name;
      this.pronounId = draft.pronounId;
      this.raceId = draft.raceId;
      this.classId = draft.classId;
      this.alignment = draft.alignment;
      this.abilityScores = draft.abilityScores;
      this.appearanceDescription = draft.appearanceDescription;
      this.background = draft.background;
      this.personalityTraits = draft.personalityTraits;
      this.equipment = draft.equipment;

      // Recover LPC recipe from draft (default to DEFAULT_LPC_RECIPE if absent)
      this.lpcRecipe = draft.lpcRecipe ?? { ...DEFAULT_LPC_RECIPE };
      this.paletteOverrides = draft.paletteOverrides ?? {};
      this.selectedPresetId = draft.selectedPresetId;

      this.info('_recoverDraft', { step: draft.step });
    } catch (error) {
      this.warn('_recoverDraft:parse-failed', error);
      this._clearDraft();
    }
  }

  /** Clears the draft from localStorage. */
  private _clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Best effort
    }
  }

  // ── Private: LPC helpers ──────────────────────────────────────────

  /** Builds a 1024-byte palette LUT from a 6-char hex color string. */
  private _buildPaletteLut(hexColor: string | undefined): Uint8Array {
    const palette = new Uint8Array(1024);

    if (!hexColor || hexColor.length !== 6) {
      return palette;
    }

    const r = Number.parseInt(hexColor.slice(0, 2), 16);
    const g = Number.parseInt(hexColor.slice(2, 4), 16);
    const b = Number.parseInt(hexColor.slice(4, 6), 16);

    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return palette;
    }

    for (let entry = 0; entry < 256; entry++) {
      const offset = entry * 4;
      palette[offset] = r;
      palette[offset + 1] = g;
      palette[offset + 2] = b;
      palette[offset + 3] = 255;
    }

    return palette;
  }

  /** Ensures the LPC recipe is at the default if empty. */
  private _ensureDefaultRecipe(): void {
    if (Object.keys(this.lpcRecipe).length === 0) {
      this.lpcRecipe = { ...DEFAULT_LPC_RECIPE };
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────

export const getOnboardingCoordinatorViewModel = (
  options: OnboardingCoordinatorViewModelOptions,
): OnboardingCoordinatorViewModelInterface => OnboardingCoordinatorViewModel.create(options);
