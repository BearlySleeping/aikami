import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/index.ts';

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
}

export const diceService: DiceServiceInterface = new DiceService({
  className: 'DiceService',
});
