// apps/frontend/client/src/lib/views/combat/status_effects_service.svelte.ts
//
// Sub-service owning the status-effect and death-save concern for the combat
// UI (C-338). Extracted from combat_view_model.svelte.ts (C-425).
//
// Owns the player/enemy status effect lists, the death-save state, and the
// "any entity downed" flag, plus the apply/expire/downed/revive transitions.
// It does NOT reach back into its parent ViewModel — bridge events are
// translated into method calls by the parent.
//
// Contract: C-425 ViewModel Decomposition
import { STATUS_EFFECT_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { DeathSaveState, StatusEffectDisplay } from './types/combat_enhancements.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type StatusEffectsServiceOptions = BaseViewModelOptions & {};

export type StatusEffectsServiceInterface = BaseViewModelInterface & {
  /** Active status effects on the player entity, keyed by effect ID. */
  readonly playerStatusEffects: StatusEffectDisplay[];
  /** Active status effects on enemy entities, keyed by entity ID. */
  readonly enemyStatusEffects: Record<number, StatusEffectDisplay[]>;
  /** Death save state for the player (null when not downed). */
  readonly deathSaveState: DeathSaveState | null;
  /** Whether any entity is currently downed. */
  readonly isAnyEntityDowned: boolean;
  /** Clears all status effect and death-save state (e.g. on combat start). */
  reset(): void;
  /** Applies a status effect to a target entity. */
  applyStatus(input: {
    effectId: string;
    targetId: number;
    duration: number;
    sourceId: number;
  }): void;
  /** Removes a status effect from a target entity. */
  expireStatus(effectId: string, targetId: number): void;
  /** Marks an entity as downed (initialises death saves for the player). */
  setEntityDowned(entityId: number): void;
  /** Records a death-save roll outcome. */
  setDeathSave(successes: number, failures: number): void;
  /** Clears the downed/death-save state (entity revived). */
  revive(): void;
};

// ── Implementation ───────────────────────────────────────────────────────

export class StatusEffectsService
  extends BaseViewModel<StatusEffectsServiceOptions>
  implements StatusEffectsServiceInterface
{
  playerStatusEffects: StatusEffectDisplay[] = $state([]);
  enemyStatusEffects: Record<number, StatusEffectDisplay[]> = $state({});
  deathSaveState: DeathSaveState | null = $state(null);
  isAnyEntityDowned: boolean = $state(false);

  /** @inheritdoc */
  reset(): void {
    this.playerStatusEffects = [];
    this.enemyStatusEffects = {};
    this.deathSaveState = null;
    this.isAnyEntityDowned = false;
  }

  /** @inheritdoc */
  applyStatus(input: {
    effectId: string;
    targetId: number;
    duration: number;
    sourceId: number;
  }): void {
    const effectDef = STATUS_EFFECT_REGISTRY[input.effectId];
    const effectName = effectDef?.name ?? input.effectId;
    const effectTag = effectDef?.tag ?? 'neutral';

    const display: StatusEffectDisplay = {
      effectId: input.effectId,
      name: effectName,
      tag: effectTag,
      remainingDuration: input.duration,
      sourceEntityId: input.sourceId,
    };

    if (input.targetId === 1) {
      this.playerStatusEffects = [...this.playerStatusEffects, display];
    } else {
      const existing = this.enemyStatusEffects[input.targetId] ?? [];
      this.enemyStatusEffects = {
        ...this.enemyStatusEffects,
        [input.targetId]: [...existing, display],
      };
    }
  }

  /** @inheritdoc */
  expireStatus(effectId: string, targetId: number): void {
    if (targetId === 1) {
      this.playerStatusEffects = this.playerStatusEffects.filter((e) => e.effectId !== effectId);
    } else {
      const existing = this.enemyStatusEffects[targetId] ?? [];
      this.enemyStatusEffects = {
        ...this.enemyStatusEffects,
        [targetId]: existing.filter((e) => e.effectId !== effectId),
      };
    }
  }

  /** @inheritdoc */
  setEntityDowned(entityId: number): void {
    this.isAnyEntityDowned = true;
    if (entityId === 1) {
      this.deathSaveState = { successes: 0, failures: 0 };
    }
  }

  /** @inheritdoc */
  setDeathSave(successes: number, failures: number): void {
    this.deathSaveState = { successes, failures };
  }

  /** @inheritdoc */
  revive(): void {
    this.isAnyEntityDowned = false;
    this.deathSaveState = null;
  }
}

export const getStatusEffectsService = (
  options: StatusEffectsServiceOptions,
): StatusEffectsServiceInterface => StatusEffectsService.create(options);
