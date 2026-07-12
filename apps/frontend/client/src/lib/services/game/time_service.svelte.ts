// apps/frontend/client/src/lib/services/game/time_service.svelte.ts
//
// Time & weather domain service — owns game clock and environment state.
// UI reads reactive getters; only this service mutates state.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { registerSerializable, type SerializableService } from './serializable_service';

/** Serialized shape for save/load. */
export type TimeState = {
  gameHour: number;
  gameMinute: number;
  windVelocity: number;
  rainIntensity: number;
};

export type TimeServiceInterface = BaseFrontendClassInterface & {
  readonly gameHour: number;
  readonly gameMinute: number;
  readonly windVelocity: number;
  readonly rainIntensity: number;

  updateEnvironment(options: {
    gameHour: number;
    gameMinute: number;
    windVelocity: number;
    rainIntensity: number;
  }): void;
};

class TimeService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements TimeServiceInterface, SerializableService<TimeState>
{
  private _gameHour = $state(12);
  private _gameMinute = $state(0);
  private _windVelocity = $state(0);
  private _rainIntensity = $state(0);

  get gameHour(): number {
    return this._gameHour;
  }

  get gameMinute(): number {
    return this._gameMinute;
  }

  get windVelocity(): number {
    return this._windVelocity;
  }

  get rainIntensity(): number {
    return this._rainIntensity;
  }

  constructor(options: BaseFrontendClassOptions) {
    super(options);
    registerSerializable('time', this as unknown as SerializableService<unknown>);
  }

  updateEnvironment(options: {
    gameHour: number;
    gameMinute: number;
    windVelocity: number;
    rainIntensity: number;
  }): void {
    this._gameHour = options.gameHour;
    this._gameMinute = options.gameMinute;
    this._windVelocity = options.windVelocity;
    this._rainIntensity = options.rainIntensity;
  }

  serialize(): TimeState {
    return {
      gameHour: this._gameHour,
      gameMinute: this._gameMinute,
      windVelocity: this._windVelocity,
      rainIntensity: this._rainIntensity,
    };
  }

  hydrate(data: TimeState): void {
    this._gameHour = data.gameHour;
    this._gameMinute = data.gameMinute;
    this._windVelocity = data.windVelocity;
    this._rainIntensity = data.rainIntensity;
  }
}

export const timeService: TimeServiceInterface = TimeService.create({
  className: 'TimeService',
  excludeAutoDebugMethods: ['updateEnvironment'],
} as BaseFrontendClassOptions) as TimeServiceInterface;
