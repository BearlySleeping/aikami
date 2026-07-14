// apps/frontend/client/src/lib/services/game/combat_service.svelte.ts
//
// Combat domain service — owns combat encounter state.
// UI reads reactive getters; only this service mutates state.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { gameEngineService } from './game_engine_service.svelte';
import type { GameOverlayType } from './game_overlay_service.svelte';
import { registerSerializable, type SerializableService } from './serializable_service';

/** Serialized shape for save/load. */
export type CombatState = {
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  participantIds: number[];
  firstTurnEntityId: number;
};

export type CombatServiceInterface = BaseFrontendClassInterface & {
  readonly enemyName: string;
  readonly enemyHp: number;
  readonly enemyMaxHp: number;
  readonly participantIds: readonly number[];
  readonly firstTurnEntityId: number;

  startCombat(options: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
    setActive: (overlay: GameOverlayType) => void;
  }): void;
};

class CombatService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CombatServiceInterface, SerializableService<CombatState>
{
  private _enemyName = $state('Unknown Enemy');
  private _enemyHp = $state(80);
  private _enemyMaxHp = $state(80);
  private _participantIds: number[] = $state([]);
  private _firstTurnEntityId = $state(1);

  get enemyName(): string {
    return this._enemyName;
  }

  get enemyHp(): number {
    return this._enemyHp;
  }

  get enemyMaxHp(): number {
    return this._enemyMaxHp;
  }

  get participantIds(): readonly number[] {
    return this._participantIds;
  }

  get firstTurnEntityId(): number {
    return this._firstTurnEntityId;
  }

  constructor(options: BaseFrontendClassOptions) {
    super(options);
    registerSerializable('combat', this as unknown as SerializableService<unknown>);
  }

  startCombat(options: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
    setActive: (overlay: GameOverlayType) => void;
  }): void {
    this._enemyName = options.enemyName;
    this._enemyHp = options.enemyHp;
    this._enemyMaxHp = options.enemyMaxHp;
    this._participantIds = options.participantIds;
    this._firstTurnEntityId = options.firstTurnEntityId;
    options.setActive('COMBAT');
    gameEngineService.pauseEngine();
  }

  serialize(): CombatState {
    return {
      enemyName: this._enemyName,
      enemyHp: this._enemyHp,
      enemyMaxHp: this._enemyMaxHp,
      participantIds: [...this._participantIds],
      firstTurnEntityId: this._firstTurnEntityId,
    };
  }

  hydrate(data: CombatState): void {
    this._enemyName = data.enemyName;
    this._enemyHp = data.enemyHp;
    this._enemyMaxHp = data.enemyMaxHp;
    this._participantIds = [...data.participantIds];
    this._firstTurnEntityId = data.firstTurnEntityId;
  }
}

export const combatService: CombatServiceInterface = CombatService.create({
  className: 'CombatService',
}) as CombatServiceInterface;
