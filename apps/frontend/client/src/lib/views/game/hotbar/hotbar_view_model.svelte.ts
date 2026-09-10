// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view_model.svelte.ts
//
// Hotbar ViewModel — manages the 6-slot ability bar at the bottom of the HUD.
// Derives display data from the injected player-state capability and the class
// registry.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/hotbar_fixtures.ts). Production
// wiring lives in ./hotbar_composition.ts.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import { CLASS_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ClassFeature } from '@aikami/types';

// ── Capability contracts ────────────────────────────────────────────────

/** The player-state fields and operations the hotbar reads. */
export type HotbarPlayerStateCapabilities = {
  readonly hotbarSlots: readonly string[];
  readonly abilityUses: Record<string, number | undefined>;
  useAbility(featureId: string): void;
};

// ── Hotbar Slot ──

export type HotbarSlot = {
  /** Slot index 0-5 */
  index: number;
  /** Feature ID, or empty string if empty */
  featureId: string;
  /** Display name, or empty string if empty */
  label: string;
  /** Keyboard shortcut label (1-6) */
  keybind: string;
  /** Whether this slot is filled */
  filled: boolean;
  /** Remaining uses (null for unlimited/passive) */
  usesRemaining: number | null;
  /** Whether this ability can be used (has uses remaining or is unlimited) */
  canUse: boolean;
  /** Presentation classes for the slot button. */
  className: string;
  /** Accessible hover title for the slot button. */
  title: string;
};

// ── Interface ──

export type HotbarViewModelInterface = BaseViewModelInterface & {
  readonly slots: readonly HotbarSlot[];
  /** Only the assigned (filled) slots — empty slots are hidden from the HUD. */
  readonly assignedSlots: readonly HotbarSlot[];
  readonly visible: boolean;

  /** Activate the ability in a slot by its index. */
  activateSlot(slotIndex: number): void;
  /** Show/hide the hotbar. */
  setVisible(visible: boolean): void;
};

export type HotbarViewModelOptions = BaseViewModelOptions & {
  /** Player-state capability. */
  playerState: HotbarPlayerStateCapabilities;
};

// ── Implementation ──

class HotbarViewModel
  extends BaseViewModel<HotbarViewModelOptions>
  implements HotbarViewModelInterface
{
  private readonly _playerState: HotbarPlayerStateCapabilities;

  visible = $state<boolean>(true);

  constructor(options: HotbarViewModelOptions) {
    super(options);
    this._playerState = options.playerState;
  }

  /**
   * Resolves a feature ID to its display name from the class registry.
   */
  private _resolveFeatureName(featureId: string): string {
    if (!featureId) {
      return '';
    }
    // Search all class registries for this feature
    const registry = CLASS_REGISTRY as Record<string, { features: Record<string, ClassFeature[]> }>;
    for (const classDef of Object.values(registry)) {
      for (const levelFeatures of Object.values(classDef.features)) {
        const found = levelFeatures.find((f: ClassFeature) => f.id === featureId);
        if (found) {
          return found.name;
        }
      }
    }
    return featureId;
  }

  get slots(): HotbarSlot[] {
    const hotbarSlots = this._playerState.hotbarSlots;
    const abilityUses = this._playerState.abilityUses;
    const result: HotbarSlot[] = [];

    for (let i = 0; i < 6; i++) {
      const featureId = hotbarSlots[i] || '';
      const filled = featureId.length > 0;
      const usesRemaining = abilityUses[featureId] ?? null;
      const label = filled ? this._resolveFeatureName(featureId) : '';
      const filledClassName = filled
        ? 'border-purple-500/60 bg-purple-500/10 hover:border-purple-500/90 hover:bg-purple-500/20'
        : 'opacity-50 hover:opacity-70';
      const availabilityClassName =
        filled && (usesRemaining === null || usesRemaining > 0)
          ? ''
          : 'opacity-40 cursor-not-allowed';

      result.push({
        index: i,
        featureId,
        label,
        keybind: String(i + 1),
        filled,
        usesRemaining,
        canUse: filled && (usesRemaining === null || usesRemaining > 0),
        className: `w-16 h-16 rounded-lg border-2 border-white/20 bg-white/5 flex flex-col items-center justify-center cursor-pointer relative transition-colors duration-200 hover:border-white/50 hover:bg-white/10 ${filledClassName} ${availabilityClassName}`,
        title: filled ? label : `Slot ${i + 1} (empty)`,
      });
    }

    return result;
  }

  /**
   * Projects only the assigned (filled) slots.
   *
   * C-497 AC-3: the HUD renders only assigned slots — empty slots produce no
   * button, no `+` glyph and no keybind label. The projected slots retain
   * their true keybind/index so activating a non-first ability still maps to
   * the correct slot. Reactive: assigning or clearing an ability re-derives
   * the projection without a reload.
   */
  get assignedSlots(): HotbarSlot[] {
    return this.slots.filter((slot) => slot.filled);
  }

  activateSlot(slotIndex: number): void {
    const featureId = this._playerState.hotbarSlots[slotIndex];
    if (!featureId) {
      return;
    }
    this._playerState.useAbility(featureId);
    this.debug('activateSlot', { slotIndex, featureId });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.debug('setVisible', { visible });
  }
}

/**
 * Builds a hotbar ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getHotbarViewModel` in ./hotbar_composition.ts.
 */
export const createHotbarViewModel = (options: HotbarViewModelOptions): HotbarViewModelInterface =>
  HotbarViewModel.create(options);
