import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

export type DiceServiceOptions = BaseFrontendClassOptions;

export type DiceServiceInterface = BaseFrontendClassInterface & {
  readonly history: {
    roll: number;
    sides: number;
    modifier: number;
    total: number;
    timestamp: Date;
  }[];

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

  roll(sides: number): number {
    const result = Math.floor(Math.random() * sides) + 1;
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
    const natural = Math.floor(Math.random() * 20) + 1;
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
      total += Math.floor(Math.random() * options.sides) + 1;
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
}

export const diceService: DiceServiceInterface = DiceService.create({
  className: 'DiceService',
});
