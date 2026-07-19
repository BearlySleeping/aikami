// apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { createSeedableRng, type SeedableRng } from '@aikami/utils';

export type DiceServiceOptions = BaseFrontendClassOptions;

export type DiceServiceInterface = BaseFrontendClassInterface & {
  readonly history: {
    roll: number;
    sides: number;
    modifier: number;
    total: number;
    timestamp: Date;
  }[];

  /**
   * Sets the RNG seed for deterministic dice rolls.
   * When a seed is set, all future rolls use the seedable PRNG
   * instead of Math.random(). Call with `null` to revert to
   * non-deterministic mode.
   */
  setSeed(seed: number | null): void;

  roll(sides: number): number;

  rollD20(modifier?: number): {
    natural: number;
    total: number;
    isCriticalSuccess: boolean;
    isCriticalFailure: boolean;
  };

  rollCheck(modifier: number, dc: number): { success: boolean; total: number; difference: number };

  /**
   * Rolls `count` dice of `sides` each and returns the sum.
   * Pushes each individual die roll plus the combined total to history.
   *
   * @param options - Dice notation: how many dice, how many sides, optional label.
   * @returns The sum of all dice rolled.
   */
  rollNotation(options: { count: number; sides: number; label?: string }): number;
};

class DiceService extends BaseFrontendClass<DiceServiceOptions> implements DiceServiceInterface {
  history = $state<
    {
      roll: number;
      sides: number;
      modifier: number;
      total: number;
      timestamp: Date;
    }[]
  >([]);

  private _activeRng: SeedableRng | null = null;

  /**
   * Sets the RNG seed for deterministic dice rolls.
   *
   * When a seed is set, creates a new {@link SeedableRng} from the given seed.
   * All subsequent `roll()`, `rollD20()`, `rollCheck()`, and `rollNotation()`
   * calls will use this PRNG instead of non-deterministic {@link Math.random}.
   *
   * Call `setSeed(null)` to revert to non-deterministic mode for
   * non-mechanical rolls (particle effects, ambient animations, etc.).
   *
   * @param seed - A 32-bit integer seed, or null to clear.
   */
  setSeed(seed: number | null): void {
    if (seed === null) {
      this._activeRng = null;
      return;
    }
    this._activeRng = createSeedableRng(seed);
  }

  roll(sides: number): number {
    const result = this._rollInternal(sides);
    this.history.push({
      roll: result,
      sides,
      modifier: 0,
      total: result,
      timestamp: new Date(),
    });
    return result;
  }

  rollD20(modifier = 0): {
    natural: number;
    total: number;
    isCriticalSuccess: boolean;
    isCriticalFailure: boolean;
  } {
    const natural = this._rollInternal(20);
    const total = natural + modifier;
    const isCriticalSuccess = natural === 20;
    const isCriticalFailure = natural === 1;

    this.history.push({
      roll: natural,
      sides: 20,
      modifier,
      total,
      timestamp: new Date(),
    });

    return { natural, total, isCriticalSuccess, isCriticalFailure };
  }

  rollCheck(modifier: number, dc: number): { success: boolean; total: number; difference: number } {
    const { total } = this.rollD20(modifier);
    const success = total >= dc;
    const difference = total - dc;

    return { success, total, difference };
  }

  /** @inheritdoc */
  rollNotation(options: { count: number; sides: number; label?: string }): number {
    let total = 0;
    for (let i = 0; i < options.count; i++) {
      total += this._rollInternal(options.sides);
    }
    this.history.push({
      roll: total,
      sides: options.sides,
      modifier: 0,
      total,
      timestamp: new Date(),
    });
    return total;
  }

  /**
   * Internal dice roller — prefers the seeded RNG if active;
   * falls back to non-deterministic {@link Math.random} otherwise.
   */
  private _rollInternal(sides: number): number {
    if (sides < 1) {
      return 0;
    }
    if (this._activeRng) {
      return this._activeRng.dice(sides);
    }
    return Math.floor(Math.random() * sides) + 1;
  }
}

export const diceService: DiceServiceInterface = DiceService.create({
  className: 'DiceService',
});
