// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts
//
// Onboarding coordinator ViewModel — orchestrates the fast character onboarding
// flow: DM chat, 4-step custom creation, preset selection, and persona review.
// All paths converge to a shared review page where the user can edit before
// entering the world.
// Contract: C-319 Replace /setup with Fast Character Onboarding
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import type {
  AppearancePreset,
  ClassPreset,
  OnboardingStep,
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
  RANDOM_BACKGROUNDS,
  RANDOM_FANTASY_NAMES,
  RANDOM_PERSONALITIES,
  SPECIES_OPTIONS,
  STARTER_HEROES,
} from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { OnboardingDraft, PersonaData } from '@aikami/types';
import { campaignService, personaCreationService, personaService, routerService } from '$services';
import type { PersonaCreateViewModelInterface } from '$views/character/persona/create/persona_create_view_model.svelte';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';

// ── Constants ──────────────────────────────────────────────────────────

const DRAFT_KEY = 'aikami-onboarding-draft' as const;

/**
 * Max total across all six ability scores. Matches the sum of the D&D
 * standard array (15+14+13+12+10+8 = 72) so players can't pump every
 * score to 15.
 */
const ABILITY_SCORE_BUDGET = DND_STANDARD_ARRAY.reduce((sum, v) => sum + v, 0);

const EMPTY_SCORES: Record<string, number> = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/** Canonical render-order for LPC slots. Matches engine ordering. */
const ENGINE_SLOTS = [
  'body',
  'accessories',
  'hair',
  'torso',
  'legs',
  'feet',
  'head',
  'headAccessories',
] as const;

/** LPC slot labels for the appearance step UI. */
const LPC_SLOT_LABELS: Record<string, string> = {
  body: 'Body',
  accessories: 'Accessories',
  hair: 'Hair',
  head: 'Head',
  headAccessories: 'Head Accessories',
  torso: 'Torso',
  legs: 'Legs',
  feet: 'Feet',
};

/**
 * Onboarding flow mode.
 * - 'chat': DM chat interface (default)
 * - 'manual_steps': Step-by-step creation wizard
 * - 'review': Shared complete page (edit before entering world)
 */
export type OnboardingMode = 'chat' | 'manual_steps' | 'review';

// ── Interface ──────────────────────────────────────────────────────────

export type OnboardingCoordinatorViewModelInterface = BaseViewModelInterface & {
  /** Current flow mode. */
  readonly mode: OnboardingMode;
  /** The PersonaCreateViewModel for the DM chat phase. */
  readonly chatViewModel: PersonaCreateViewModelInterface;
  /** Whether a persona has been generated (from chat, manual, or preset). */
  readonly hasPersona: boolean;
  /** The current persona data from personaCreationService. */
  readonly persona: PersonaData | undefined;

  // Manual creation step state
  readonly step: OnboardingStep;
  readonly stepIndex: number;
  readonly starterHeroes: readonly StarterHero[];
  readonly isTextProviderAvailable: boolean;
  readonly isConfirming: boolean;
  readonly canGoNext: boolean;
  readonly classPresets: readonly ClassPreset[];
  readonly speciesOptions: readonly SpeciesOption[];
  readonly abilityLabels: typeof ABILITY_LABELS;
  readonly playStyleTags: typeof PLAY_STYLE_TAGS;
  readonly abilityScoreBudget: number;
  readonly abilityScoreTotal: number;
  readonly appearancePresets: readonly AppearancePreset[];
  readonly hasDraft: boolean;

  // Manual creation form fields
  name: string;
  raceId: string;
  classId: string;
  alignment: string;
  abilityScores: Record<string, number>;
  appearanceDescription: string;
  background: string;
  personalityTraits: string;
  equipment: string[];

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

  // Navigation
  /** Switch to manual creation steps. */
  startCustom(): void;
  /** Switch back to chat from manual steps. */
  backToChat(): void;
  /** Go to the next manual step. */
  nextStep(): void;
  /** Go to the previous manual step. */
  previousStep(): void;
  /** Randomize character fields. */
  randomizeCharacter(): void;

  // Step mutators
  setName(value: string): void;
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

  // LPC appearance
  selectAppearancePreset(presetId: string): void;
  setLpcLayer(slotName: string, assetId: string): void;
  setPaletteOverride(slotName: string, hexColor: string): void;
  togglePreviewAnimation(): void;

  // Preset selection
  /** Select a starter hero preset and go to review. */
  selectPreset(hero: StarterHero): Promise<void>;

  // Finalize
  /** Confirm the persona and enter the world. */
  confirmAndEnter(): Promise<void>;
};

// ── Options ────────────────────────────────────────────────────────────

export type OnboardingCoordinatorViewModelOptions = BaseViewModelOptions;

// ── Implementation ─────────────────────────────────────────────────────

class OnboardingCoordinatorViewModel
  extends BaseViewModel<OnboardingCoordinatorViewModelOptions>
  implements OnboardingCoordinatorViewModelInterface
{
  // ── Flow mode ──────────────────────────────────────────────────────
  mode: OnboardingMode = $state('chat');

  // ── Chat ViewModel ─────────────────────────────────────────────────
  chatViewModel: PersonaCreateViewModelInterface;

  // ── Manual creation state ──────────────────────────────────────────
  step: OnboardingStep = $state('identity');
  isConfirming = $state(false);

  // Custom path form fields
  name = $state('');
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

  constructor(options: OnboardingCoordinatorViewModelOptions) {
    super(options);

    // Create the chat ViewModel for the DM chat phase
    this.chatViewModel = getPersonaCreateViewModel({
      className: 'PersonaCreateViewModel',
    });

    // Watch for persona being set by the chat VM → switch to review
    $effect(() => {
      const persona = personaCreationService.persona;
      if (persona && this.mode === 'chat') {
        this.debug('chatViewModel:persona-ready — switching to review');
        this.mode = 'review';
      }
    });
  }

  // ── Computed ──────────────────────────────────────────────────────

  get hasPersona(): boolean {
    return !!personaCreationService.persona;
  }

  get persona(): PersonaData | undefined {
    return personaCreationService.persona;
  }

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

  get abilityLabels(): typeof ABILITY_LABELS {
    return ABILITY_LABELS;
  }

  get playStyleTags(): typeof PLAY_STYLE_TAGS {
    return PLAY_STYLE_TAGS;
  }

  get abilityScoreBudget(): number {
    return ABILITY_SCORE_BUDGET;
  }

  get abilityScoreTotal(): number {
    return Object.values(this.abilityScores).reduce((sum, v) => sum + v, 0);
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
    await this.chatViewModel.initialize();
    await super.initialize();
  }

  // ── Navigation ────────────────────────────────────────────────────

  startCustom(): void {
    this.mode = 'manual_steps';
    this.step = 'identity';
    this._ensureDefaultRecipe();
    this._saveDraft();
  }

  backToChat(): void {
    this.mode = 'chat';
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
      const nextStep = ONBOARDING_STEPS[currentIndex + 1];
      this.step = nextStep;

      // When entering the review step, assemble the persona so the
      // OnboardingReviewView can display and edit it directly.
      if (nextStep === 'review') {
        const persona = this._assemblePersonaFromDraft();
        personaCreationService.persona = persona;
        this._clearDraft();
      }

      this._saveDraft();
    }
    // At the last step (review), the user clicks "Enter World" which
    // calls confirmAndEnter() directly — no mode switch needed.
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
    // Enforce the total budget: increasing a score must not push the sum
    // of all scores past ABILITY_SCORE_BUDGET (e.g. can't set all to 15).
    if (delta > 0 && this.abilityScoreTotal + delta > ABILITY_SCORE_BUDGET) {
      return;
    }
    this.abilityScores = { ...this.abilityScores, [key]: next };
    this._saveDraft();
  }

  // ── LPC Appearance ────────────────────────────────────────────────

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

  setLpcLayer(slotName: string, assetId: string): void {
    this.lpcRecipe = { ...this.lpcRecipe, [slotName]: assetId };
    this.selectedPresetId = undefined;
    this._saveDraft();
  }

  setPaletteOverride(slotName: string, hexColor: string): void {
    this.paletteOverrides = { ...this.paletteOverrides, [slotName]: hexColor };
    this.selectedPresetId = undefined;
    this._saveDraft();
  }

  togglePreviewAnimation(): void {
    this.previewPlaying = !this.previewPlaying;
  }

  // ── Randomize ─────────────────────────────────────────────────────

  randomizeCharacter(): void {
    const randomName =
      RANDOM_FANTASY_NAMES[Math.floor(Math.random() * RANDOM_FANTASY_NAMES.length)];
    const randomRace = SPECIES_OPTIONS[Math.floor(Math.random() * SPECIES_OPTIONS.length)];
    const randomClass = CLASS_PRESETS[Math.floor(Math.random() * CLASS_PRESETS.length)];
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

  // ── Preset Selection ──────────────────────────────────────────────

  async selectPreset(hero: StarterHero): Promise<void> {
    this.debug('selectPreset', { heroId: hero.id });

    const persona = this._assemblePersonaFromStarter(hero);
    personaCreationService.persona = persona;
    this.mode = 'review';
  }

  // ── Finalize ──────────────────────────────────────────────────────

  async confirmAndEnter(): Promise<void> {
    if (this.isConfirming) {
      return;
    }

    this.isConfirming = true;

    try {
      const persona = this.persona ?? this._assemblePersonaFromDraft();
      await this._attachPersonaToCampaign(persona);
    } catch (error) {
      this.error('confirmAndEnter:failed', error);
      this.isConfirming = false;
    }
  }

  // ── Private: Persona Assembly ─────────────────────────────────────

  private _assemblePersonaFromStarter(hero: StarterHero): PersonaData {
    return {
      id: crypto.randomUUID(),
      name: hero.name,
      race: hero.race,
      class: hero.class,
      alignment: hero.alignment,
      abilityScores: hero.abilityScores,
      equipment: hero.equipment,
      appearance: {
        physicalDescription: hero.appearance,
        lpcRecipe: { ...hero.lpcRecipe },
        paletteOverrides: { ...(hero.paletteOverrides ?? {}) },
      } as Record<string, unknown>,
      background: hero.background,
      personalityTraits: hero.personalityTraits,
      notes: '',
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

  private _assemblePersonaFromDraft(): PersonaData {
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
        paletteOverrides: { ...this.paletteOverrides },
      } as Record<string, unknown>,
      background: this.background,
      personalityTraits: this.personalityTraits,
      notes: '',
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

  private async _attachPersonaToCampaign(persona: PersonaData): Promise<void> {
    // Resolve a campaign in the 'creating' state. When /setup is refreshed or
    // entered directly (not via the index flow), no active campaign exists —
    // create one so character creation can complete.
    let campaign = campaignService.activeCampaign;
    if (campaign?.state !== 'creating') {
      try {
        campaign = await campaignService.startNewCampaign();
      } catch (error) {
        this.error('_attachPersonaToCampaign:create-failed', error);
        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'No active campaign found. Please return to the start menu.';
        return;
      }
    }

    try {
      // Persist the persona to the same stores the game reads
      await this._persistPersona(persona);

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

  // ── Private: Persona Persistence ──────────────────────────────────

  private async _persistPersona(persona: PersonaData): Promise<void> {
    // 1. Legacy `aikami-characters` list (append or replace by id)
    try {
      const stored = localStorage.getItem('aikami-characters');
      const characters = stored ? (JSON.parse(stored) as unknown[]) : [];
      const idx = characters.findIndex(
        (c: unknown) => (c as { persona: { id: string } }).persona?.id === persona.id,
      );
      const entry = { persona, savedAt: new Date().toISOString() };
      if (idx >= 0) {
        characters[idx] = entry;
      } else {
        characters.push(entry);
      }
      localStorage.setItem('aikami-characters', JSON.stringify(characters));
    } catch (error) {
      this.warn('_persistPersona:local-list-failed', error);
    }

    // 2. Local `personas` SQLite table (upsert) + mark active
    try {
      await personaService.updatePersona(persona.id, { ...persona, isActive: true });
      await personaService.setActivePersona(persona.id);
    } catch (error) {
      this.warn('_persistPersona:local-table-failed', error);
    }
  }

  // ── Private: Ability Score Assignment ─────────────────────────────

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

  private _assignStandardArrayIfDefault(): void {
    const allDefaults = Object.values(this.abilityScores).every((v) => v === 10);
    if (allDefaults) {
      this._assignStandardArray();
    }
  }

  // ── Private: Draft Persistence ────────────────────────────────────

  private _saveDraft(): void {
    try {
      const draft: OnboardingDraft = {
        step: this.step,
        name: this.name,
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

  private _recoverDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        return;
      }

      const draft = JSON.parse(raw) as OnboardingDraft;

      const raceExists = SPECIES_OPTIONS.some((s) => s.id === draft.raceId);
      const classExists = CLASS_PRESETS.some((c) => c.id === draft.classId);

      if (!raceExists || !classExists) {
        this.warn('_recoverDraft:stale-ids', {
          raceExists,
          classExists,
        });
        this._clearDraft();
        return;
      }

      this.mode = 'manual_steps';
      this.step = draft.step;
      this.name = draft.name;
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

  private _clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Best effort
    }
  }

  // ── Private: LPC helpers ──────────────────────────────────────────

  private _buildPaletteLut(hexColor: string | undefined): Uint8Array {
    const palette = new Uint8Array(1024);

    if (hexColor?.length !== 6) {
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

  private _ensureDefaultRecipe(): void {
    if (Object.keys(this.lpcRecipe).length === 0) {
      this.lpcRecipe = { ...DEFAULT_LPC_RECIPE };
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getOnboardingCoordinatorViewModel = (
  options: OnboardingCoordinatorViewModelOptions,
): OnboardingCoordinatorViewModelInterface => OnboardingCoordinatorViewModel.create(options);
