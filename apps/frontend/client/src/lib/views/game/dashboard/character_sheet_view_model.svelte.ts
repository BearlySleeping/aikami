// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.svelte.ts
//
// Character Sheet ViewModel. Combines game stats from GameStateService
// with D&D-style ability scores, skills proficiency grid, saving throws,
// personality traits, and narrative traits (Likes/Temptations/Keys).
// Replaces the minimal CharacterDashboardViewModel from C-153.
//
// Contract: C-232 Character Sheet & Traits System

import { CLASS_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ClassFeature, EquipmentSlot, ItemDefinition } from '@aikami/types';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type AbilityScores,
  type CharacterSavingThrow,
  type CharacterSkill,
  type CharacterTraits,
  DEFAULT_NARRATIVE_TRAITS,
  DEFAULT_TRAITS,
  type GameCharacterSheet,
  type NarrativeTraits,
} from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  createDefaultAbilities,
  createDefaultSavingThrows,
  createDefaultSkills,
  recomputeSavingThrows,
  recomputeSkills,
  serializeForAi,
  validateSheetJson,
} from '@aikami/utils';
import { equipmentService, getItemDefinition, playerStateService } from '$services';

export type { EquipmentSlot, ItemDefinition };

// ── Resolved Feature (C-337) ──

export type ResolvedFeature = {
  id: string;
  name: string;
  description: string;
  level: number;
  kind: 'active' | 'passive';
  earned: boolean;
  activation?: ClassFeature['activation'];
};

// ── Tabs ──────────────────────────────────────────────────

export type CharacterSheetTab = 'abilities' | 'skills' | 'traits' | 'features';

export const CHARACTER_SHEET_TABS: readonly CharacterSheetTab[] = [
  'abilities',
  'skills',
  'traits',
  'features',
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
  readonly skills: CharacterSkill[];
  readonly savingThrows: CharacterSavingThrow[];
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
  readonly skillsByAbility: Record<AbilityKey, CharacterSkill[]>;

  // ── Class Features (C-337) ──

  readonly classId: string;
  readonly className: string;
  readonly classFeatures: readonly ResolvedFeature[];
  readonly nextLevelFeatures: readonly ResolvedFeature[];
  readonly isMaxLevel: boolean;
  readonly hotbarSlots: readonly string[];

  /** Assign a feature to a hotbar slot. */
  setHotbarSlot(slotIndex: number, featureId: string): void;
  /** Clear a hotbar slot. */
  clearHotbarSlot(slotIndex: number): void;
  /** Activate an ability (pulse animation callback). */
  activateAbility(featureId: string): void;

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
    return playerStateService.playerLevel;
  }

  get xp(): number {
    return playerStateService.playerXp;
  }

  get xpToNext(): number {
    return playerStateService.playerXpToNext;
  }

  get xpPercent(): number {
    const threshold = this.xpToNext;
    if (threshold <= 0) {
      return 100;
    }
    return Math.min(100, Math.round((this.xp / threshold) * 100));
  }

  get hp(): number {
    return playerStateService.playerHp;
  }

  get maxHp(): number {
    return playerStateService.playerMaxHp;
  }

  get hpPercent(): number {
    const max = this.maxHp;
    if (max <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.hp / max) * 100));
  }

  get baseAttack(): number {
    return playerStateService.playerBaseAttack;
  }

  get baseDefense(): number {
    return playerStateService.playerBaseDefense;
  }

  get totalAttack(): number {
    return equipmentService.totalAttack;
  }

  get totalDefense(): number {
    return equipmentService.totalDefense;
  }

  get equippedWeaponDef(): ItemDefinition | undefined {
    const weaponId = equipmentService.equippedWeapon;
    if (!weaponId) {
      return undefined;
    }
    return getItemDefinition(weaponId);
  }

  get equippedArmorDef(): ItemDefinition | undefined {
    const armorId = equipmentService.equippedArmor;
    if (!armorId) {
      return undefined;
    }
    return getItemDefinition(armorId);
  }

  // ── Character sheet data ($state) ──

  protected _abilities = $state<AbilityScores>(createDefaultAbilities());
  protected _skills = $state<CharacterSkill[]>(createDefaultSkills());
  protected _savingThrows = $state<CharacterSavingThrow[]>(createDefaultSavingThrows());
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

  get skills(): CharacterSkill[] {
    return recomputeSkills(this._skills, this._abilities, this.proficiencyBonus);
  }

  get savingThrows(): CharacterSavingThrow[] {
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
  get skillsByAbility(): Record<AbilityKey, CharacterSkill[]> {
    const groups = {} as Record<AbilityKey, CharacterSkill[]>;
    for (const key of ABILITY_KEYS) {
      groups[key] = this.skills.filter((s) => s.ability === key);
    }
    return groups;
  }

  // ── Class Features (C-337) ──

  get classId(): string {
    return playerStateService.classId;
  }

  get className(): string {
    const def = (CLASS_REGISTRY as Record<string, { name?: string }>)[this.classId];
    return def?.name ?? this.classId;
  }

  /** Resolved features for the current class: all known features with earned status. */
  get classFeatures(): ResolvedFeature[] {
    const earnedIds = new Set(playerStateService.classFeatures);
    const classDef = (
      CLASS_REGISTRY as Record<
        string,
        {
          features: Record<
            string,
            {
              id: string;
              name: string;
              description: string;
              level: number;
              kind: string;
              activation?: ClassFeature['activation'];
            }[]
          >;
        }
      >
    )[this.classId];
    if (!classDef) {
      return [];
    }
    const features: ResolvedFeature[] = [];
    const seen = new Set<string>();
    // Collect from all levels up to max
    for (let lvl = 1; lvl <= 5; lvl++) {
      const levelFeatures = classDef.features[String(lvl)];
      if (levelFeatures) {
        for (const feat of levelFeatures) {
          if (seen.has(feat.id)) {
            continue;
          }
          seen.add(feat.id);
          features.push({
            id: feat.id,
            name: feat.name,
            description: feat.description,
            level: feat.level,
            kind: feat.kind as 'active' | 'passive',
            earned: earnedIds.has(feat.id),
            activation: feat.activation,
          });
        }
      }
    }
    return features.sort((a, b) => a.level - b.level);
  }

  /** Features to be granted at the next level (projection). */
  get nextLevelFeatures(): ResolvedFeature[] {
    const nextLevel = this.level + 1;
    if (nextLevel > 5) {
      return [];
    }
    const classDef = (
      CLASS_REGISTRY as Record<
        string,
        {
          features: Record<
            string,
            {
              id: string;
              name: string;
              description: string;
              level: number;
              kind: string;
              activation?: ClassFeature['activation'];
            }[]
          >;
        }
      >
    )[this.classId];
    if (!classDef) {
      return [];
    }
    const levelFeatures = classDef.features[String(nextLevel)];
    if (!levelFeatures) {
      return [];
    }
    return levelFeatures.map(
      (feat: {
        id: string;
        name: string;
        description: string;
        level: number;
        kind: string;
        activation?: ClassFeature['activation'];
      }) => ({
        id: feat.id,
        name: feat.name,
        description: feat.description,
        level: feat.level,
        kind: feat.kind === 'passive' ? 'passive' : 'active',
        earned: false,
        activation: feat.activation,
      }),
    );
  }

  get isMaxLevel(): boolean {
    return this.level >= 5;
  }

  get hotbarSlots(): readonly string[] {
    return playerStateService.hotbarSlots;
  }

  setHotbarSlot(slotIndex: number, featureId: string): void {
    playerStateService.setHotbarSlot({ slotIndex, featureId });
  }

  clearHotbarSlot(slotIndex: number): void {
    playerStateService.clearHotbarSlot(slotIndex);
  }

  activateAbility(featureId: string): void {
    this.debug('activateAbility', { featureId });
    playerStateService.useAbility(featureId);
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
    const sheet: GameCharacterSheet = {
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
    const sheet: GameCharacterSheet = {
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
