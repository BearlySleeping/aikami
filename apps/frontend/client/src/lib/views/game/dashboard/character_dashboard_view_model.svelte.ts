// apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view_model.svelte.ts
//
// Character Dashboard ViewModel. Reads player stats and equipment through
// typed capability contracts; the production services (which sync with the ECS
// engine via PLAYER_LEVELED_UP and COMBAT_STATE_UPDATE bridge events) are wired
// in ./character_dashboard_composition.ts.
//
// Contract: C-153 Character Dashboard & Equipment

import { EQUIPMENT_SLOT_ICONS, EQUIPMENT_SLOT_LABELS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import { getItemDefinition } from '$utils/inventory_utils';

export type { EquipmentSlot, ItemDefinition };

// ── Capability contracts ────────────────────────────────────────────────

/** The player-stat fields the dashboard displays. */
export type PlayerStateCapabilities = {
  readonly playerLevel: number;
  readonly playerXp: number;
  readonly playerXpToNext: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly playerBaseAttack: number;
  readonly playerBaseDefense: number;
};

/** The equipment fields the dashboard reads. */
export type EquipmentCapabilities = {
  readonly totalAttack: number;
  readonly totalDefense: number;
  readonly equippedItems: ReadonlyArray<{ slot: EquipmentSlot; itemId: string }>;
};

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

  /** Slot-ordered equipped items with definitions (C-374). */
  readonly equippedItems: ReadonlyArray<{
    slot: EquipmentSlot;
    itemId: string;
    definition: ItemDefinition;
  }>;
  getSlotLabel(slot: EquipmentSlot): string;
  getSlotIcon(slot: EquipmentSlot): string;

  /** Closes the dashboard overlay. */
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  closeDashboard(): void;
};

export type CharacterDashboardViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the dashboard. */
  onClose: () => void;
  /** Player-stat capability. */
  playerState: PlayerStateCapabilities;
  /** Equipment capability. */
  equipment: EquipmentCapabilities;
};

// ── Implementation ─────────────────────────────────────────────────────

class CharacterDashboardViewModel
  extends BaseViewModel<CharacterDashboardViewModelOptions>
  implements CharacterDashboardViewModelInterface
{
  private readonly _onClose: () => void;
  private readonly _playerState: PlayerStateCapabilities;
  private readonly _equipment: EquipmentCapabilities;

  constructor(options: CharacterDashboardViewModelOptions) {
    super(options);
    this._onClose = options.onClose;
    this._playerState = options.playerState;
    this._equipment = options.equipment;
  }

  /** @inheritdoc */
  get level(): number {
    return this._playerState.playerLevel;
  }

  /** @inheritdoc */
  get xp(): number {
    return this._playerState.playerXp;
  }

  /** @inheritdoc */
  get xpToNext(): number {
    return this._playerState.playerXpToNext;
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
    return this._playerState.playerHp;
  }

  /** @inheritdoc */
  get maxHp(): number {
    return this._playerState.playerMaxHp;
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
    return this._playerState.playerBaseAttack;
  }

  /** @inheritdoc */
  get baseDefense(): number {
    return this._playerState.playerBaseDefense;
  }

  /** @inheritdoc */
  get totalAttack(): number {
    return this._equipment.totalAttack;
  }

  /** @inheritdoc */
  get totalDefense(): number {
    return this._equipment.totalDefense;
  }

  /** @inheritdoc */
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

  /** Closes the dashboard when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeDashboard();
    }
  }

  /** Closes the dashboard when Escape is pressed. */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeDashboard();
    }
  }

  /** @inheritdoc */
  closeDashboard(): void {
    this._onClose();
  }
}

export { CharacterDashboardViewModel };

/**
 * Builds a character-dashboard ViewModel from explicit capabilities.
 *
 * Tests and sandboxes call this directly; production code goes through
 * `getCharacterDashboardViewModel` in ./character_dashboard_composition.ts.
 */
export const createCharacterDashboardViewModel = (
  options: CharacterDashboardViewModelOptions,
): CharacterDashboardViewModelInterface => CharacterDashboardViewModel.create(options);
