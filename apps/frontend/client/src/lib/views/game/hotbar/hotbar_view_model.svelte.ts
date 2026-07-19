// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view_model.svelte.ts
//
// Hotbar ViewModel — manages the 6-slot ability bar at the bottom of the HUD.
// Reads class features from playerStateService and resolves display data.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import { CLASS_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ClassFeature } from '@aikami/types';
import { playerStateService } from '$services';

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
};

// ── Interface ──

export type HotbarViewModelInterface = BaseViewModelInterface & {
  readonly slots: readonly HotbarSlot[];
  readonly visible: boolean;

  /** Activate the ability in a slot by its index. */
  activateSlot(slotIndex: number): void;
  /** Show/hide the hotbar. */
  setVisible(visible: boolean): void;
};

export type HotbarViewModelOptions = BaseViewModelOptions;

// ── Implementation ──

class HotbarViewModel
  extends BaseViewModel<HotbarViewModelOptions>
  implements HotbarViewModelInterface
{
  visible = $state<boolean>(true);

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
    const hotbarSlots = playerStateService.hotbarSlots;
    const abilityUses = playerStateService.abilityUses;
    const result: HotbarSlot[] = [];

    for (let i = 0; i < 6; i++) {
      const featureId = hotbarSlots[i] || '';
      const filled = featureId.length > 0;
      const usesRemaining = abilityUses[featureId] ?? null;

      result.push({
        index: i,
        featureId,
        label: filled ? this._resolveFeatureName(featureId) : '',
        keybind: String(i + 1),
        filled,
        usesRemaining,
        canUse: filled && (usesRemaining === null || usesRemaining > 0),
      });
    }

    return result;
  }

  activateSlot(slotIndex: number): void {
    const featureId = playerStateService.hotbarSlots[slotIndex];
    if (!featureId) {
      return;
    }
    playerStateService.useAbility(featureId);
    this.debug('activateSlot', { slotIndex, featureId });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.debug('setVisible', { visible });
  }
}

export const getHotbarViewModel = (options: HotbarViewModelOptions): HotbarViewModelInterface =>
  HotbarViewModel.create(options);
