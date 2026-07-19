// apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts
//
// Player stats service (C-314) — owns player level, XP, HP, base attack/defense,
// narrative traits, and character sheet summary. Listens for ECS stat events
// via the EngineBridge.
//
// Extracted from game_state_service (C-314 service split).

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { serializeForAi } from '$lib/data/character_sheet_helpers';
import type { NarrativeTraits } from '$lib/data/character_sheet_types';
import { type CharacterSheet, createDefaultSheet } from '$lib/data/character_sheet_types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlayerStateServiceOptions = BaseFrontendClassOptions;

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

  private _listening = false;

  /** Compact AI-ready character sheet summary for prompt injection (C-232). */
  get characterSheetSummary(): string {
    const sheet: CharacterSheet = {
      ...createDefaultSheet(),
      level: this.playerLevel,
      xp: this.playerXp,
      hp: this.playerHp,
      maxHp: this.playerMaxHp,
      attack: this.playerBaseAttack,
      defense: this.playerBaseDefense,
      narrativeTraits: this.narrativeTraits,
      classId: this.classId,
      classFeatures: this.classFeatures,
      hotbarSlots: this.hotbarSlots,
    };
    return serializeForAi(sheet);
  }

  /** Sets the class ID and retroactively grants features for the current level. */
  setClassId(classId: string): void {
    this.classId = classId;
    this.debug('setClassId', { classId });
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

export const playerStateService: PlayerStateServiceInterface = PlayerStateService.create({
  className: 'PlayerStateService',
});
