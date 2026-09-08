// apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts
//
// Player stats service (C-314) — owns player level, XP, HP, base attack/defense,
// narrative traits, and character sheet summary. Listens for ECS stat events
// via the EngineBridge.
//
// Extracted from game_state_service (C-314 service split).

import { CLASS_REGISTRY } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AbilityKey,
  AbilityScores,
  CharacterSavingThrow,
  CharacterSkill,
  CharacterTraits,
  GameCharacterSheet,
  NarrativeTraits,
} from '@aikami/types';
import { ABILITY_KEYS, DEFAULT_TRAITS } from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  createDefaultAbilities,
  createDefaultSavingThrows,
  createDefaultSkills,
  recomputeSavingThrows,
  recomputeSkills,
  serializeForAi,
} from '@aikami/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlayerStateServiceOptions = BaseFrontendClassOptions;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return true;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isAbilityKey = (value: unknown): value is AbilityKey =>
  typeof value === 'string' && ABILITY_KEYS.some((key) => key === value);

const isValidCharacterSheet = (value: unknown): value is GameCharacterSheet => {
  if (!isRecord(value) || !isRecord(value.abilities)) {
    return false;
  }

  for (const key of ABILITY_KEYS) {
    const ability = value.abilities[key];
    if (
      !isRecord(ability) ||
      !isFiniteNumber(ability.value) ||
      ability.value < 3 ||
      ability.value > 20 ||
      !isFiniteNumber(ability.modifier)
    ) {
      return false;
    }
  }

  if (
    !Array.isArray(value.skills) ||
    !value.skills.every(
      (skill) =>
        isRecord(skill) &&
        typeof skill.name === 'string' &&
        skill.name.length > 0 &&
        isAbilityKey(skill.ability) &&
        typeof skill.isProficient === 'boolean' &&
        typeof skill.isExpertise === 'boolean' &&
        isFiniteNumber(skill.modifier),
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(value.savingThrows) ||
    !value.savingThrows.every(
      (savingThrow) =>
        isRecord(savingThrow) &&
        isAbilityKey(savingThrow.ability) &&
        typeof savingThrow.isProficient === 'boolean' &&
        typeof savingThrow.isExpertise === 'boolean' &&
        isFiniteNumber(savingThrow.modifier),
    )
  ) {
    return false;
  }

  if (
    !isRecord(value.traits) ||
    typeof value.traits.personalityTraits !== 'string' ||
    typeof value.traits.ideals !== 'string' ||
    typeof value.traits.bonds !== 'string' ||
    typeof value.traits.flaws !== 'string' ||
    !isRecord(value.narrativeTraits) ||
    !isStringArray(value.narrativeTraits.likes) ||
    !isStringArray(value.narrativeTraits.temptations) ||
    !isStringArray(value.narrativeTraits.keys)
  ) {
    return false;
  }

  if (
    !isFiniteNumber(value.proficiencyBonus) ||
    !isFiniteNumber(value.level) ||
    !isFiniteNumber(value.xp) ||
    !isFiniteNumber(value.hp) ||
    !isFiniteNumber(value.maxHp) ||
    !isFiniteNumber(value.attack) ||
    !isFiniteNumber(value.defense)
  ) {
    return false;
  }
  if (value.level < 1 || value.maxHp < 1) {
    return false;
  }
  if (value.classId !== undefined && typeof value.classId !== 'string') {
    return false;
  }
  if (value.classFeatures !== undefined && !isStringArray(value.classFeatures)) {
    return false;
  }
  if (
    value.hotbarSlots !== undefined &&
    (!isStringArray(value.hotbarSlots) || value.hotbarSlots.length > 6)
  ) {
    return false;
  }

  return true;
};

export type PlayerStateServiceInterface = BaseFrontendClassInterface & {
  readonly playerLevel: number;
  readonly playerXp: number;
  readonly playerXpToNext: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly playerBaseAttack: number;
  readonly playerBaseDefense: number;
  readonly narrativeTraits: NarrativeTraits;
  readonly characterSheetSummary: string;

  /** Class definition ID — "fighter", "wizard", etc. (C-337) */
  readonly classId: string;
  /** Feature IDs the character has unlocked (C-337) */
  readonly classFeatures: readonly string[];
  /** Feature IDs currently slotted on the hotbar, max 6 (C-337) */
  readonly hotbarSlots: readonly string[];
  /** Usage tracking: featureId → uses remaining (C-337) */
  readonly abilityUses: Record<string, number>;

  // ── Character sheet source of truth (C-487) ──

  /** The real authored ability scores (neutral defaults until authored). */
  readonly abilities: AbilityScores;
  /** The real authored skill proficiency flags. */
  readonly skills: CharacterSkill[];
  /** The real authored saving throw flags. */
  readonly savingThrows: CharacterSavingThrow[];
  /** The real authored personality traits. */
  readonly traits: CharacterTraits;
  /** The assembled character sheet — the single source the dialogue path reads. */
  readonly characterSheet: GameCharacterSheet;
  /** True once the player has authored/edited the sheet; false while neutral. */
  readonly isCharacterSheetAuthored: boolean;

  /** Sets an ability score, recomputing its modifier (C-487). */
  setAbilityScore(options: { key: AbilityKey; value: number }): void;
  /** Toggles proficiency for a skill by name (C-487). */
  toggleSkillProficiency(options: { name: string }): void;
  /** Toggles expertise for a skill by name (C-487). */
  toggleSkillExpertise(options: { name: string }): void;
  /** Toggles proficiency for a saving throw (C-487). */
  toggleSaveProficiency(options: { ability: AbilityKey }): void;
  /** Sets a personality trait field (C-487). */
  setTrait(options: { field: keyof CharacterTraits; text: string }): void;
  /** Adds a narrative trait entry (C-487). */
  addNarrativeTrait(options: { category: keyof NarrativeTraits; value: string }): void;
  /** Removes a narrative trait entry (C-487). */
  removeNarrativeTrait(options: { category: keyof NarrativeTraits; value: string }): void;
  /** Imports a full authored sheet (JSON edit path, C-487). */
  importCharacterSheet(options: { sheet: GameCharacterSheet }): void;

  /**
   * Adds XP to the player. Does not handle level-up logic (ECS owns that).
   */
  addXp(options: { amount: number }): void;

  /**
   * Heals the player's HP mirror by the given amount, clamped at max HP.
   * Used by out-of-combat consumables (C-331 AC-4); the ECS receives the
   * authoritative HEAL_PLAYER command separately.
   *
   * @returns The player's HP after healing.
   */
  heal(options: { amount: number }): number;

  /**
   * Starts listening for ECS bridge events (PLAYER_LEVELED_UP, COMBAT_STATE_UPDATE).
   * Must be called after the game engine is ready.
   */
  startListening(): Promise<void>;

  /** Resets all player stats to defaults. */
  reset(): void;

  /** Sets the class ID for class-aware progression (C-337). */
  setClassId(classId: string): void;
  /** Sets a hotbar slot to a feature ID (C-337). */
  setHotbarSlot(options: { slotIndex: number; featureId: string }): void;
  /** Clears a hotbar slot (C-337). */
  clearHotbarSlot(slotIndex: number): void;
  /** Resets ability uses (called on rest/encounter end) (C-337). */
  resetAbilityUses(uses: Record<string, number>): void;
  /** Decrements an ability use (C-337). */
  useAbility(featureId: string): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PlayerStateService
  extends BaseFrontendClass<PlayerStateServiceOptions>
  implements PlayerStateServiceInterface
{
  playerLevel = $state<number>(1);
  playerXp = $state<number>(0);
  playerXpToNext = $state<number>(100);
  playerHp = $state<number>(100);
  playerMaxHp = $state<number>(100);
  playerBaseAttack = $state<number>(5);
  playerBaseDefense = $state<number>(12);
  narrativeTraits = $state<NarrativeTraits>({ likes: [], temptations: [], keys: [] });

  // ── Class Progression (C-337) ──
  classId = $state<string>('fighter');
  classFeatures = $state<string[]>([]);
  hotbarSlots = $state<string[]>([]);
  abilityUses = $state<Record<string, number>>({});

  // ── Character sheet source of truth (C-487) ──
  //
  // The real authored sheet lives here, not in CharacterSheetViewModel. The
  // dialogue overlay reads this service; a ViewModel is never imported into
  // the dialogue path. Fields default to a neutral sheet (all 10s → +0).

  abilities = $state<AbilityScores>(createDefaultAbilities());
  skills = $state<CharacterSkill[]>(createDefaultSkills());
  savingThrows = $state<CharacterSavingThrow[]>(createDefaultSavingThrows());
  traits = $state<CharacterTraits>({ ...DEFAULT_TRAITS });

  private _characterSheetAuthored = false;

  private _listening = false;

  constructor(options: PlayerStateServiceOptions) {
    super(options);

    // E2E seeding hook (C-487): lets the Playwright harness author a real
    // sheet before the production boot reads it. Absent during normal play —
    // the neutral sheet is the only fallback. Keyed on a window global so the
    // route/overlay/ViewModel stay the production ones in the /game E2E.
    const seed = (globalThis as Record<string, unknown>).__AIKAMI_E2E_SHEET__;
    if (isValidCharacterSheet(seed)) {
      this.importCharacterSheet({ sheet: seed });
    }
  }

  /** Compact AI-ready character sheet summary for prompt injection (C-232). */
  get characterSheetSummary(): string {
    return serializeForAi(this.characterSheet);
  }

  /** The assembled character sheet — the single source the dialogue path reads (C-487). */
  get characterSheet(): GameCharacterSheet {
    const proficiencyBonus = computeProficiencyBonus(this.playerLevel);
    const skills = Array.isArray(this.skills) ? this.skills : createDefaultSkills();
    return {
      abilities: this.abilities,
      skills: recomputeSkills(skills, this.abilities, proficiencyBonus),
      savingThrows: recomputeSavingThrows(this.savingThrows, this.abilities, proficiencyBonus),
      traits: this.traits,
      narrativeTraits: this.narrativeTraits,
      proficiencyBonus,
      level: this.playerLevel,
      xp: this.playerXp,
      hp: this.playerHp,
      maxHp: this.playerMaxHp,
      attack: this.playerBaseAttack,
      defense: this.playerBaseDefense,
      classId: this.classId,
      classFeatures: this.classFeatures,
      hotbarSlots: this.hotbarSlots,
    };
  }

  /** True once the player has authored/edited the sheet; false while neutral (C-487). */
  get isCharacterSheetAuthored(): boolean {
    return this._characterSheetAuthored;
  }

  /** Sets an ability score, recomputing its modifier (C-487). */
  setAbilityScore(options: { key: AbilityKey; value: number }): void {
    const { key, value } = options;
    const clamped = Math.max(3, Math.min(20, Math.round(value)));
    const current = this.abilities[key];
    if (current.value === clamped) {
      return;
    }
    this.abilities = {
      ...this.abilities,
      [key]: { value: clamped, modifier: computeModifier(clamped) },
    };
    this._characterSheetAuthored = true;
  }

  /** Toggles proficiency for a skill by name (C-487). */
  toggleSkillProficiency(options: { name: string }): void {
    this.skills = this.skills.map((s) =>
      s.name === options.name ? { ...s, isProficient: !s.isProficient } : s,
    );
    this._characterSheetAuthored = true;
  }

  /** Toggles expertise for a skill by name (C-487). */
  toggleSkillExpertise(options: { name: string }): void {
    this.skills = this.skills.map((s) =>
      s.name === options.name ? { ...s, isExpertise: !s.isExpertise, isProficient: true } : s,
    );
    this._characterSheetAuthored = true;
  }

  /** Toggles proficiency for a saving throw (C-487). */
  toggleSaveProficiency(options: { ability: AbilityKey }): void {
    this.savingThrows = this.savingThrows.map((s) =>
      s.ability === options.ability ? { ...s, isProficient: !s.isProficient } : s,
    );
    this._characterSheetAuthored = true;
  }

  /** Sets a personality trait field (C-487). */
  setTrait(options: { field: keyof CharacterTraits; text: string }): void {
    this.traits = { ...this.traits, [options.field]: options.text };
    this._characterSheetAuthored = true;
  }

  /** Adds a narrative trait entry (C-487). */
  addNarrativeTrait(options: { category: keyof NarrativeTraits; value: string }): void {
    const trimmed = options.value.trim();
    if (!trimmed) {
      return;
    }
    const current = this.narrativeTraits[options.category];
    if (current.includes(trimmed)) {
      return;
    }
    this.narrativeTraits = {
      ...this.narrativeTraits,
      [options.category]: [...current, trimmed],
    };
    this._characterSheetAuthored = true;
  }

  /** Removes a narrative trait entry (C-487). */
  removeNarrativeTrait(options: { category: keyof NarrativeTraits; value: string }): void {
    this.narrativeTraits = {
      ...this.narrativeTraits,
      [options.category]: this.narrativeTraits[options.category].filter((v) => v !== options.value),
    };
    this._characterSheetAuthored = true;
  }

  /** Imports a full authored sheet (JSON edit path, C-487). */
  importCharacterSheet(options: { sheet: GameCharacterSheet }): void {
    const { sheet } = options;
    const proficiencyBonus = computeProficiencyBonus(sheet.level);
    const skills = Array.isArray(sheet.skills) ? sheet.skills : createDefaultSkills();
    this.playerLevel = sheet.level;
    this.playerXp = sheet.xp;
    this.playerHp = sheet.hp;
    this.playerMaxHp = sheet.maxHp;
    this.playerBaseAttack = sheet.attack;
    this.playerBaseDefense = sheet.defense;
    this.classId = sheet.classId ?? 'fighter';
    this.classFeatures = [...(sheet.classFeatures ?? [])];
    this.hotbarSlots = [...(sheet.hotbarSlots ?? [])];
    this.abilities = sheet.abilities;
    this.skills = recomputeSkills(skills, sheet.abilities, proficiencyBonus);
    this.savingThrows = recomputeSavingThrows(
      sheet.savingThrows,
      sheet.abilities,
      proficiencyBonus,
    );
    this.traits = sheet.traits;
    this.narrativeTraits = sheet.narrativeTraits;
    this._characterSheetAuthored = true;
  }

  /** Sets the class ID and retroactively grants features for the current level. */
  setClassId(classId: string): void {
    this.classId = classId;

    // Retroactively grant all features from level 1 through current level
    const existingFeatures = new Set(this.classFeatures);
    const classDef = (
      CLASS_REGISTRY as Record<string, { features: Record<string, { id: string }[]> }>
    )[classId];

    if (classDef) {
      for (let level = 1; level <= this.playerLevel; level++) {
        const levelFeatures = classDef.features[String(level)];
        if (levelFeatures) {
          for (const feature of levelFeatures) {
            existingFeatures.add(feature.id);
          }
        }
      }
      this.classFeatures = [...existingFeatures];
    }

    this.debug('setClassId', { classId, featuresGranted: this.classFeatures.length });
  }

  /** Sets a hotbar slot to a feature ID. Auto-clears the slot if it was already assigned elsewhere. */
  setHotbarSlot(options: { slotIndex: number; featureId: string }): void {
    const { slotIndex, featureId } = options;
    if (slotIndex < 0 || slotIndex >= 6) {
      return;
    }
    const slots = [...this.hotbarSlots];
    // Remove featureId from any other slot
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === featureId) {
        slots[i] = '';
      }
    }
    slots[slotIndex] = featureId;
    this.hotbarSlots = slots;
    this.debug('setHotbarSlot', { slotIndex, featureId });
  }

  /** Clears a hotbar slot. */
  clearHotbarSlot(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= 6) {
      return;
    }
    const slots = [...this.hotbarSlots];
    slots[slotIndex] = '';
    this.hotbarSlots = slots;
    this.debug('clearHotbarSlot', { slotIndex });
  }

  /** Resets ability uses to maxUses (called on rest/encounter end). */
  resetAbilityUses(uses: Record<string, number>): void {
    this.abilityUses = { ...uses };
    this.debug('resetAbilityUses', { count: Object.keys(uses).length });
  }

  /** Decrements a single ability use. */
  useAbility(featureId: string): void {
    const current = this.abilityUses[featureId] ?? 0;
    if (current > 0) {
      this.abilityUses = { ...this.abilityUses, [featureId]: current - 1 };
    }
    this.debug('useAbility', { featureId, remaining: this.abilityUses[featureId] });
  }

  /** @inheritdoc */
  addXp(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      return;
    }
    this.playerXp += amount;
    this.debug('addXp', { amount, newXp: this.playerXp });

    // TODO(C-339): Route XP through ECS-owned progression system.
    // Currently this only mutates the frontend mirror — level-up, stat boosts,
    // and threshold checks should be handled by the ECS worker via a
    // PLAYER_XP_GAINED bridge event → ECS processes level-up → PLAYER_LEVELED_UP
    // emitted back. This is tracked as part of the quest/progression system (C-339).
  }

  /** @inheritdoc */
  heal(options: { amount: number }): number {
    const { amount } = options;
    if (amount <= 0) {
      return this.playerHp;
    }
    this.playerHp = Math.min(this.playerMaxHp, this.playerHp + amount);
    this.debug('heal', { amount, newHp: this.playerHp });
    return this.playerHp;
  }

  /** @inheritdoc */
  reset(): void {
    this.playerLevel = 1;
    this.playerXp = 0;
    this.playerXpToNext = 100;
    this.playerHp = 100;
    this.playerMaxHp = 100;
    this.playerBaseAttack = 5;
    this.playerBaseDefense = 12;
    this.classId = 'fighter';
    this.classFeatures = [];
    this.hotbarSlots = [];
    this.abilityUses = {};
    this.abilities = createDefaultAbilities();
    this.skills = createDefaultSkills();
    this.savingThrows = createDefaultSavingThrows();
    this.traits = { ...DEFAULT_TRAITS };
    this.narrativeTraits = { likes: [], temptations: [], keys: [] };
    this._characterSheetAuthored = false;
    this.debug('reset:cleared');
  }

  /**
   * Starts listening for player stat events from the ECS via the EngineBridge.
   * Idempotent — only starts once per lifecycle.
   */
  async startListening(): Promise<void> {
    if (this._listening) {
      return;
    }
    this._listening = true;

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('PLAYER_LEVELED_UP', (event) => {
        this.playerLevel = event.newLevel;
        this.playerMaxHp = event.maxHp;
        this.playerBaseAttack = event.attack;
        this.playerBaseDefense = event.defense;
        this.playerXpToNext = event.xpToNextLevel;
        // Add unlocked features (C-337)
        if (event.featuresUnlocked && event.featuresUnlocked.length > 0) {
          const existing = new Set(this.classFeatures);
          for (const featureId of event.featuresUnlocked) {
            existing.add(featureId);
          }
          this.classFeatures = [...existing];
        }
        this.debug('leveledUp', {
          level: event.newLevel,
          attack: event.attack,
          defense: event.defense,
          featuresUnlocked: event.featuresUnlocked,
        });
      });

      bridge.on('COMBAT_STATE_UPDATE', (event) => {
        // Player entity is always entity ID 1 in our ECS
        const playerHp = event.entityHpMap[1];
        if (playerHp !== undefined) {
          this.playerHp = playerHp;
        }
      });
    } catch (error) {
      this.debug('startListening:failed', { error: String(error) });
    }
  }
}

/** Creates an isolated player-state owner for dev sandboxes and focused tests. */
export const createPlayerStateService = (
  options: PlayerStateServiceOptions,
): PlayerStateServiceInterface => PlayerStateService.create(options);

export const playerStateService: PlayerStateServiceInterface = PlayerStateService.create({
  className: 'PlayerStateService',
});
