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

  /**
   * Adds XP to the player. Does not handle level-up logic (ECS owns that).
   */
  addXp(options: { amount: number }): void;

  /**
   * Starts listening for ECS bridge events (PLAYER_LEVELED_UP, COMBAT_STATE_UPDATE).
   * Must be called after the game engine is ready.
   */
  startListening(): Promise<void>;

  /** Resets all player stats to defaults. */
  reset(): void;
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
    };
    return serializeForAi(sheet);
  }

  /** @inheritdoc */
  addXp(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      return;
    }
    this.playerXp += amount;
    this.debug('addXp', { amount, newXp: this.playerXp });
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
        this.debug('leveledUp', {
          level: event.newLevel,
          attack: event.attack,
          defense: event.defense,
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
