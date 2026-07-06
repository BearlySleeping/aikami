// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.svelte.ts
//
// Character Sheet ViewModel. Combines game stats from GameStateService
// with D&D-style ability scores, skills proficiency grid, saving throws,
// personality traits, and narrative traits (Likes/Temptations/Keys).
// Replaces the minimal CharacterDashboardViewModel from C-153.
//
// Contract: C-232 Character Sheet & Traits System

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  recomputeSavingThrows,
  recomputeSkills,
  serializeForAi,
  validateSheetJson,
} from '$lib/data/character_sheet_helpers';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type AbilityScores,
  type CharacterSheet,
  type CharacterTraits,
  createDefaultAbilities,
  createDefaultSavingThrows,
  createDefaultSkills,
  DEFAULT_NARRATIVE_TRAITS,
  DEFAULT_TRAITS,
  type NarrativeTraits,
  type SavingThrow,
  type Skill,
} from '$lib/data/character_sheet_types';
import { gameStateService, getItemDefinition } from '$services';

export type { EquipmentSlot, ItemDefinition };

// ── Tabs ──────────────────────────────────────────────────

export type CharacterSheetTab = 'abilities' | 'skills' | 'traits';

export const CHARACTER_SHEET_TABS: readonly CharacterSheetTab[] = [
  'abilities',
  'skills',
  'traits',
] as const;

// ── Interface ─────────────────────────────────────────────

export type CharacterSheetViewModelInterface = BaseViewModelInterface & {
  // ── Game stats (from GameStateService) ──

  readonly level: number;
  readonly xp: number;
  readonly xpToNext: number;
  readonly xpPercent: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hpPercent: number;
  readonly baseAttack: number;
  readonly baseDefense: number;
  readonly totalAttack: number;
  readonly totalDefense: number;
  readonly equippedWeaponDef: ItemDefinition | undefined;
  readonly equippedArmorDef: ItemDefinition | undefined;

  // ── Character sheet data ──

  readonly abilities: AbilityScores;
  readonly skills: Skill[];
  readonly savingThrows: SavingThrow[];
  readonly traits: CharacterTraits;
  readonly narrativeTraits: NarrativeTraits;
  readonly proficiencyBonus: number;

  // ── UI state ──

  readonly activeTab: CharacterSheetTab;
  readonly isProMode: boolean;
  readonly isJsonEditing: boolean;
  readonly jsonText: string;
  readonly jsonError: string | undefined;
  readonly showAiPreview: boolean;
  readonly aiPreviewText: string;

  // ── Computed / display helpers ──

  readonly abilityLabels: Record<AbilityKey, string>;
  readonly modifierColor: (modifier: number) => string;
  readonly modifierSign: (modifier: number) => string;
  readonly skillsByAbility: Record<AbilityKey, Skill[]>;

  // ── Mutations ──

  setActiveTab(tab: CharacterSheetTab): void;
  setAbilityScore(key: AbilityKey, value: number): void;
  toggleSkillProficiency(name: string): void;
  toggleSkillExpertise(name: string): void;
  toggleSaveProficiency(ability: AbilityKey): void;
  setTrait(field: keyof CharacterTraits, text: string): void;
  addNarrativeTrait(category: keyof NarrativeTraits, value: string): void;
  removeNarrativeTrait(category: keyof NarrativeTraits, value: string): void;
  toggleProMode(): void;
  toggleJsonEditing(): void;
  setJsonText(text: string): void;
  saveJsonEdit(): void;
  toggleAiPreview(): void;
  getAiContext(): string;
  closeSheet(): void;
};

export type CharacterSheetViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the sheet. */
  onClose: () => void;
};

// ── Implementation ────────────────────────────────────────

class CharacterSheetViewModel
  extends BaseViewModel<CharacterSheetViewModelOptions>
  implements CharacterSheetViewModelInterface
{
  private readonly _onClose: () => void;

  // ── Game stats proxied from GameStateService ──

  get level(): number {
    return gameStateService.playerLevel;
  }

  get xp(): number {
    return gameStateService.playerXp;
  }

  get xpToNext(): number {
    return gameStateService.playerXpToNext;
  }

  get xpPercent(): number {
    const threshold = this.xpToNext;
    if (threshold <= 0) {
      return 100;
    }
    return Math.min(100, Math.round((this.xp / threshold) * 100));
  }

  get hp(): number {
    return gameStateService.playerHp;
  }

  get maxHp(): number {
    return gameStateService.playerMaxHp;
  }

  get hpPercent(): number {
    const max = this.maxHp;
    if (max <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.hp / max) * 100));
  }

  get baseAttack(): number {
    return gameStateService.playerBaseAttack;
  }

  get baseDefense(): number {
    return gameStateService.playerBaseDefense;
  }

  get totalAttack(): number {
    return gameStateService.playerTotalAttack;
  }

  get totalDefense(): number {
    return gameStateService.playerTotalDefense;
  }

  get equippedWeaponDef(): ItemDefinition | undefined {
    const weaponId = gameStateService.equippedWeapon;
    if (!weaponId) {
      return undefined;
    }
    return getItemDefinition(weaponId);
  }

  get equippedArmorDef(): ItemDefinition | undefined {
    const armorId = gameStateService.equippedArmor;
    if (!armorId) {
      return undefined;
    }
    return getItemDefinition(armorId);
  }

  // ── Character sheet data ($state) ──

  protected _abilities = $state<AbilityScores>(createDefaultAbilities());
  protected _skills = $state<Skill[]>(createDefaultSkills());
  protected _savingThrows = $state<SavingThrow[]>(createDefaultSavingThrows());
  protected _traits = $state<CharacterTraits>({ ...DEFAULT_TRAITS });
  protected _narrativeTraits = $state<NarrativeTraits>({ ...DEFAULT_NARRATIVE_TRAITS });

  // ── UI state ──

  activeTab = $state<CharacterSheetTab>('abilities');
  isProMode = $state<boolean>(false);
  isJsonEditing = $state<boolean>(false);
  jsonText = $state<string>('');
  jsonError = $state<string | undefined>(undefined);
  showAiPreview = $state<boolean>(false);

  constructor(options: CharacterSheetViewModelOptions) {
    super(options);
    this._onClose = options.onClose;

    // Restore pro mode preference from localStorage
    try {
      const stored = localStorage.getItem('character_sheet_pro_mode');
      if (stored === 'true') {
        this.isProMode = true;
      }
    } catch {
      // Ignore — localStorage might not be available
    }
  }

  // ── Computed ──

  get abilities(): AbilityScores {
    return this._abilities;
  }

  get skills(): Skill[] {
    return recomputeSkills(this._skills, this._abilities, this.proficiencyBonus);
  }

  get savingThrows(): SavingThrow[] {
    return recomputeSavingThrows(this._savingThrows, this._abilities, this.proficiencyBonus);
  }

  get traits(): CharacterTraits {
    return this._traits;
  }

  get narrativeTraits(): NarrativeTraits {
    return this._narrativeTraits;
  }

  get proficiencyBonus(): number {
    return computeProficiencyBonus(this.level);
  }

  get aiPreviewText(): string {
    return this.getAiContext();
  }

  /** Labels for ability keys. */
  readonly abilityLabels: Record<AbilityKey, string> = { ...ABILITY_LABELS };

  /** DaisyUI color class for modifier. */
  readonly modifierColor = (modifier: number): string => {
    if (modifier > 0) {
      return 'text-success';
    }
    if (modifier < 0) {
      return 'text-error';
    }
    return 'text-base-content/50';
  };

  /** Format a modifier with sign (e.g. "+3" or "-1"). */
  readonly modifierSign = (modifier: number): string => {
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  /** Skills grouped by ability for tabular display. */
  get skillsByAbility(): Record<AbilityKey, Skill[]> {
    const groups = {} as Record<AbilityKey, Skill[]>;
    for (const key of ABILITY_KEYS) {
      groups[key] = this.skills.filter((s) => s.ability === key);
    }
    return groups;
  }

  // ── Mutations ──

  setActiveTab(tab: CharacterSheetTab): void {
    this.activeTab = tab;
  }

  setAbilityScore(key: AbilityKey, value: number): void {
    const clamped = Math.max(3, Math.min(20, Math.round(value)));
    const current = this._abilities[key];
    if (current.value === clamped) {
      return;
    }
    this._abilities = {
      ...this._abilities,
      [key]: { value: clamped, modifier: computeModifier(clamped) },
    };
  }

  toggleSkillProficiency(name: string): void {
    this._skills = this._skills.map((s) =>
      s.name === name ? { ...s, isProficient: !s.isProficient } : s,
    );
  }

  toggleSkillExpertise(name: string): void {
    this._skills = this._skills.map((s) =>
      s.name === name ? { ...s, isExpertise: !s.isExpertise, isProficient: true } : s,
    );
  }

  toggleSaveProficiency(ability: AbilityKey): void {
    this._savingThrows = this._savingThrows.map((s) =>
      s.ability === ability ? { ...s, isProficient: !s.isProficient } : s,
    );
  }

  setTrait(field: keyof CharacterTraits, text: string): void {
    this._traits = { ...this._traits, [field]: text };
  }

  addNarrativeTrait(category: keyof NarrativeTraits, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const current = this._narrativeTraits[category];
    if (current.includes(trimmed)) {
      return;
    }
    this._narrativeTraits = {
      ...this._narrativeTraits,
      [category]: [...current, trimmed],
    };
  }

  removeNarrativeTrait(category: keyof NarrativeTraits, value: string): void {
    this._narrativeTraits = {
      ...this._narrativeTraits,
      [category]: this._narrativeTraits[category].filter((v) => v !== value),
    };
  }

  // ── Pro Mode ──

  toggleProMode(): void {
    this.isProMode = !this.isProMode;
    this.isJsonEditing = false;
    this.jsonError = undefined;
    // Persist to localStorage
    try {
      localStorage.setItem('character_sheet_pro_mode', String(this.isProMode));
    } catch {
      // Ignore
    }
    if (this.isProMode) {
      this._refreshJsonText();
    }
  }

  toggleJsonEditing(): void {
    this.isJsonEditing = !this.isJsonEditing;
    if (this.isJsonEditing) {
      this._refreshJsonText();
    } else {
      this.jsonError = undefined;
      this._refreshJsonText();
    }
  }

  setJsonText(text: string): void {
    this.jsonText = text;
    this.jsonError = undefined;
  }

  saveJsonEdit(): void {
    const result = validateSheetJson(this.jsonText);
    if (!result.ok) {
      this.jsonError = result.error;
      return;
    }
    const data = result.data;
    this._abilities = data.abilities;
    this._skills = data.skills;
    this._savingThrows = data.savingThrows;
    this._traits = data.traits;
    this._narrativeTraits = data.narrativeTraits;
    this.jsonError = undefined;
    this.isJsonEditing = false;
    this._refreshJsonText();
  }

  /** Refresh the JSON display from current state. */
  private _refreshJsonText(): void {
    const sheet: CharacterSheet = {
      abilities: this._abilities,
      skills: this._skills,
      savingThrows: this._savingThrows,
      traits: this._traits,
      narrativeTraits: this._narrativeTraits,
      proficiencyBonus: this.proficiencyBonus,
      level: this.level,
      xp: this.xp,
      hp: this.hp,
      maxHp: this.maxHp,
      attack: this.baseAttack,
      defense: this.baseDefense,
    };
    this.jsonText = JSON.stringify(sheet, null, 2);
  }

  // ── AI Context ──

  getAiContext(): string {
    const sheet: CharacterSheet = {
      abilities: this._abilities,
      skills: this._skills,
      savingThrows: this._savingThrows,
      traits: this._traits,
      narrativeTraits: this._narrativeTraits,
      proficiencyBonus: this.proficiencyBonus,
      level: this.level,
      xp: this.xp,
      hp: this.hp,
      maxHp: this.maxHp,
      attack: this.baseAttack,
      defense: this.baseDefense,
    };
    return serializeForAi(sheet);
  }

  toggleAiPreview(): void {
    this.showAiPreview = !this.showAiPreview;
  }

  /** Closes the sheet overlay. */
  closeSheet(): void {
    this._onClose();
  }
}

export { CharacterSheetViewModel };

export const getCharacterSheetViewModel = (
  options: CharacterSheetViewModelOptions,
): CharacterSheetViewModelInterface => CharacterSheetViewModel.create(options);
