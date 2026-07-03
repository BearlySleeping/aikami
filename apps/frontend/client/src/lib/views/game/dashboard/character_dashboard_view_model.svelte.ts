// apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view_model.svelte.ts
//
// Character Dashboard ViewModel. Reads player stats and equipment reactively
// from GameStateService, which syncs with the ECS engine via PLAYER_LEVELED_UP
// and COMBAT_STATE_UPDATE bridge events.
//
// Contract: C-153 Character Dashboard & Equipment

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import { gameStateService, getItemDefinition } from '$services';

export type { EquipmentSlot, ItemDefinition };

// ── Interface ──────────────────────────────────────────────────────────

export type CharacterDashboardViewModelInterface = BaseViewModelInterface & {
  /** Player's current level. */
  readonly level: number;
  /** Current XP. */
  readonly xp: number;
  /** XP needed to reach the next level. */
  readonly xpToNext: number;
  /** XP progress as a percentage (0–100). */
  readonly xpPercent: number;
  /** Current HP. */
  readonly hp: number;
  /** Maximum HP. */
  readonly maxHp: number;
  /** HP as a percentage (0–100). */
  readonly hpPercent: number;
  /** Base attack from leveling (without equipment). */
  readonly baseAttack: number;
  /** Base defense from leveling (without equipment). */
  readonly baseDefense: number;
  /** Total attack including equipment bonuses. */
  readonly totalAttack: number;
  /** Total defense including equipment bonuses. */
  readonly totalDefense: number;

  /** Currently equipped weapon definition, or undefined. */
  readonly equippedWeaponDef: ItemDefinition | undefined;
  /** Currently equipped armor definition, or undefined. */
  readonly equippedArmorDef: ItemDefinition | undefined;

  /** Closes the dashboard overlay. */
  closeDashboard(): void;
};

export type CharacterDashboardViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the dashboard. */
  onClose: () => void;
};

// ── Implementation ─────────────────────────────────────────────────────

class CharacterDashboardViewModel
  extends BaseViewModel<CharacterDashboardViewModelOptions>
  implements CharacterDashboardViewModelInterface
{
  private readonly _onClose: () => void;

  constructor(options: CharacterDashboardViewModelOptions) {
    super(options);
    this._onClose = options.onClose;
  }

  /** @inheritdoc */
  get level(): number {
    return gameStateService.playerLevel;
  }

  /** @inheritdoc */
  get xp(): number {
    return gameStateService.playerXp;
  }

  /** @inheritdoc */
  get xpToNext(): number {
    return gameStateService.playerXpToNext;
  }

  /** @inheritdoc */
  get xpPercent(): number {
    const threshold = this.xpToNext;
    if (threshold <= 0) {
      return 100;
    }
    return Math.min(100, Math.round((this.xp / threshold) * 100));
  }

  /** @inheritdoc */
  get hp(): number {
    return gameStateService.playerHp;
  }

  /** @inheritdoc */
  get maxHp(): number {
    return gameStateService.playerMaxHp;
  }

  /** @inheritdoc */
  get hpPercent(): number {
    const max = this.maxHp;
    if (max <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.hp / max) * 100));
  }

  /** @inheritdoc */
  get baseAttack(): number {
    return gameStateService.playerBaseAttack;
  }

  /** @inheritdoc */
  get baseDefense(): number {
    return gameStateService.playerBaseDefense;
  }

  /** @inheritdoc */
  get totalAttack(): number {
    return gameStateService.playerTotalAttack;
  }

  /** @inheritdoc */
  get totalDefense(): number {
    return gameStateService.playerTotalDefense;
  }

  /** @inheritdoc */
  get equippedWeaponDef(): ItemDefinition | undefined {
    const weaponId = gameStateService.equippedWeapon;
    if (!weaponId) {
      return undefined;
    }
    return getItemDefinition(weaponId);
  }

  /** @inheritdoc */
  get equippedArmorDef(): ItemDefinition | undefined {
    const armorId = gameStateService.equippedArmor;
    if (!armorId) {
      return undefined;
    }
    return getItemDefinition(armorId);
  }

  /** @inheritdoc */
  closeDashboard(): void {
    this._onClose();
  }
}

export { CharacterDashboardViewModel };

export const getCharacterDashboardViewModel = (
  options: CharacterDashboardViewModelOptions,
): CharacterDashboardViewModelInterface => new CharacterDashboardViewModel(options);
