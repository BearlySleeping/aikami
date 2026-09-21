// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.svelte.ts
//
// Character Sheet ViewModel. Combines game stats from GameStateService
// with D&D-style ability scores, skills proficiency grid, saving throws,
// personality traits, and narrative traits (Likes/Temptations/Keys).
// Replaces the minimal CharacterDashboardViewModel from C-153.
//
// Contract: C-232 Character Sheet & Traits System

import { CLASS_REGISTRY, EQUIPMENT_SLOT_ICONS, EQUIPMENT_SLOT_LABELS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ClassFeature, EquipmentSlot, ItemDefinition } from '@aikami/types';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type AbilityScores,
  type CharacterSavingThrow,
  type CharacterSkill,
  type CharacterTraits,
  type NarrativeTraits,
} from '@aikami/types';
import {
  computeProficiencyBonus,
  recomputeSavingThrows,
  recomputeSkills,
  serializeForAi,
  validateSheetJson,
} from '@aikami/utils';
import type { EquipmentServiceInterface, PlayerStateServiceInterface } from '$services';
import { getItemDefinition } from '$utils/inventory_utils';

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
  /** Slot-ordered equipped items with definitions (C-374). */
  readonly equippedItems: ReadonlyArray<{
    slot: EquipmentSlot;
    itemId: string;
    definition: ItemDefinition;
  }>;
  getSlotLabel(slot: EquipmentSlot): string;
  getSlotIcon(slot: EquipmentSlot): string;

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
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  closeSheet(): void;
};

/** Player-state reads and mutations the sheet consumes. */
export type CharacterSheetPlayerStateCapabilities = Pick<
  PlayerStateServiceInterface,
  | 'playerLevel'
  | 'playerXp'
  | 'playerXpToNext'
  | 'playerHp'
  | 'playerMaxHp'
  | 'playerBaseAttack'
  | 'playerBaseDefense'
  | 'abilities'
  | 'skills'
  | 'savingThrows'
  | 'traits'
  | 'narrativeTraits'
  | 'classId'
  | 'classFeatures'
  | 'hotbarSlots'
  | 'characterSheet'
  | 'setHotbarSlot'
  | 'clearHotbarSlot'
  | 'useAbility'
  | 'setAbilityScore'
  | 'toggleSkillProficiency'
  | 'toggleSkillExpertise'
  | 'toggleSaveProficiency'
  | 'setTrait'
  | 'addNarrativeTrait'
  | 'removeNarrativeTrait'
  | 'importCharacterSheet'
>;

/** Equipment reads the sheet displays. */
export type CharacterSheetEquipmentCapabilities = Pick<
  EquipmentServiceInterface,
  'totalAttack' | 'totalDefense' | 'equippedItems'
>;

export type CharacterSheetViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the sheet. */
  onClose: () => void;
  /** Player-state owner; dev sandboxes inject an isolated instance. */
  playerState: CharacterSheetPlayerStateCapabilities;
  /** Equipment owner; dev sandboxes inject an isolated instance. */
  equipment: CharacterSheetEquipmentCapabilities;
};

// ── Implementation ────────────────────────────────────────

class CharacterSheetViewModel
  extends BaseViewModel<CharacterSheetViewModelOptions>
  implements CharacterSheetViewModelInterface
{
  private readonly _onClose: () => void;
  private readonly _playerState: CharacterSheetPlayerStateCapabilities;
  private readonly _equipment: CharacterSheetEquipmentCapabilities;

  // ── Game stats proxied from GameStateService ──

  get level(): number {
    return this._playerState.playerLevel;
  }

  get xp(): number {
    return this._playerState.playerXp;
  }

  get xpToNext(): number {
    return this._playerState.playerXpToNext;
  }

  get xpPercent(): number {
    const threshold = this.xpToNext;
    if (threshold <= 0) {
      return 100;
    }
    return Math.min(100, Math.round((this.xp / threshold) * 100));
  }

  get hp(): number {
    return this._playerState.playerHp;
  }

  get maxHp(): number {
    return this._playerState.playerMaxHp;
  }

  get hpPercent(): number {
    const max = this.maxHp;
    if (max <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.hp / max) * 100));
  }

  get baseAttack(): number {
    return this._playerState.playerBaseAttack;
  }

  get baseDefense(): number {
    return this._playerState.playerBaseDefense;
  }

  get totalAttack(): number {
    return this._equipment.totalAttack;
  }

  get totalDefense(): number {
    return this._equipment.totalDefense;
  }

  get equippedItems(): ReadonlyArray<{
    slot: EquipmentSlot;
    itemId: string;
    definition: ItemDefinition;
  }> {
    return this._equipment.equippedItems.map((entry) => ({
      slot: entry.slot,
      itemId: entry.itemId,
      definition: getItemDefinition(entry.itemId),
    }));
  }

  getSlotLabel(slot: EquipmentSlot): string {
    return EQUIPMENT_SLOT_LABELS[slot];
  }

  getSlotIcon(slot: EquipmentSlot): string {
    return EQUIPMENT_SLOT_ICONS[slot];
  }

  // ── Character sheet data (delegated to playerStateService — C-487) ──

  get abilities(): AbilityScores {
    return this._playerState.abilities;
  }

  get skills(): CharacterSkill[] {
    return recomputeSkills(
      this._playerState.skills,
      this._playerState.abilities,
      this.proficiencyBonus,
    );
  }

  get savingThrows(): CharacterSavingThrow[] {
    return recomputeSavingThrows(
      this._playerState.savingThrows,
      this._playerState.abilities,
      this.proficiencyBonus,
    );
  }

  get traits(): CharacterTraits {
    return this._playerState.traits;
  }

  get narrativeTraits(): NarrativeTraits {
    return this._playerState.narrativeTraits;
  }

  activeTab = $state<CharacterSheetTab>('abilities');
  isProMode = $state<boolean>(false);
  isJsonEditing = $state<boolean>(false);
  jsonText = $state<string>('');
  jsonError = $state<string | undefined>(undefined);
  showAiPreview = $state<boolean>(false);

  constructor(options: CharacterSheetViewModelOptions) {
    super(options);
    this._onClose = options.onClose;
    this._playerState = options.playerState;
    this._equipment = options.equipment;

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

  get proficiencyBonus(): number {
    return computeProficiencyBonus(this.level);
  }

  get aiPreviewText(): string {
    return this.getAiContext();
  }

  /** Labels for ability keys. */
  readonly abilityLabels: Record<AbilityKey, string> = { ...ABILITY_LABELS };

  /** Aikami UI color class for modifier. */
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
  readonly modifierSign = (modifier: number): string =>
    modifier >= 0 ? `+${modifier}` : `${modifier}`;

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
    return this._playerState.classId;
  }

  get className(): string {
    const def = (CLASS_REGISTRY as Record<string, { name?: string }>)[this.classId];
    return def?.name ?? this.classId;
  }

  /** Resolved features for the current class: all known features with earned status. */
  get classFeatures(): ResolvedFeature[] {
    const earnedIds = new Set(this._playerState.classFeatures);
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
    return this._playerState.hotbarSlots;
  }

  setHotbarSlot(slotIndex: number, featureId: string): void {
    this._playerState.setHotbarSlot({ slotIndex, featureId });
  }

  clearHotbarSlot(slotIndex: number): void {
    this._playerState.clearHotbarSlot(slotIndex);
  }

  activateAbility(featureId: string): void {
    this.debug('activateAbility', { featureId });
    this._playerState.useAbility(featureId);
  }

  // ── Mutations ──

  setActiveTab(tab: CharacterSheetTab): void {
    this.activeTab = tab;
  }

  setAbilityScore(key: AbilityKey, value: number): void {
    this._playerState.setAbilityScore({ key, value });
  }

  toggleSkillProficiency(name: string): void {
    this._playerState.toggleSkillProficiency({ name });
  }

  toggleSkillExpertise(name: string): void {
    this._playerState.toggleSkillExpertise({ name });
  }

  toggleSaveProficiency(ability: AbilityKey): void {
    this._playerState.toggleSaveProficiency({ ability });
  }

  setTrait(field: keyof CharacterTraits, text: string): void {
    this._playerState.setTrait({ field, text });
  }

  addNarrativeTrait(category: keyof NarrativeTraits, value: string): void {
    this._playerState.addNarrativeTrait({ category, value });
  }

  removeNarrativeTrait(category: keyof NarrativeTraits, value: string): void {
    this._playerState.removeNarrativeTrait({ category, value });
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
    this._playerState.importCharacterSheet({ sheet: result.data });
    this.jsonError = undefined;
    this.isJsonEditing = false;
    this._refreshJsonText();
  }

  /** Refresh the JSON display from current state. */
  private _refreshJsonText(): void {
    this.jsonText = JSON.stringify(this._playerState.characterSheet, null, 2);
  }

  // ── AI Context ──

  getAiContext(): string {
    return serializeForAi(this._playerState.characterSheet);
  }

  toggleAiPreview(): void {
    this.showAiPreview = !this.showAiPreview;
  }

  /** Closes the sheet when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeSheet();
    }
  }

  /** Handles dismissal and focus trapping for the sheet dialog. */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeSheet();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    const dialog = event.currentTarget as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), [href]',
    );
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  }

  /** Closes the sheet overlay. */
  closeSheet(): void {
    this._onClose();
  }
}

export { CharacterSheetViewModel };

/**
 * Builds a character-sheet ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getCharacterSheetViewModel` in
 * ./character_sheet_composition.ts.
 */
export const createCharacterSheetViewModel = (
  options: CharacterSheetViewModelOptions,
): CharacterSheetViewModelInterface => CharacterSheetViewModel.create(options);
