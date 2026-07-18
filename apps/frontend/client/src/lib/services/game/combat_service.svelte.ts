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
  combatSeed?: number;
  encounterId?: string | null;
  lastCombatOptions?: CombatServiceInterface['lastCombatOptions'];
};

export type CombatServiceInterface = BaseFrontendClassInterface & {
  readonly enemyName: string;
  readonly enemyHp: number;
  readonly enemyMaxHp: number;
  readonly participantIds: readonly number[];
  readonly firstTurnEntityId: number;
  readonly combatSeed: number | undefined;
  readonly encounterId: string | null | undefined;
  /** Last combat initialization options for retry (C-330 AC-5). */
  readonly lastCombatOptions: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
    combatSeed?: number;
    encounterId?: string | null;
    allowNonCombatResolution?: boolean;
  } | null;

  startCombat(options: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
    setActive: (overlay: GameOverlayType) => void;
    combatSeed?: number;
    encounterId?: string | null;
    allowNonCombatResolution?: boolean;
  }): void;

  /** Retries the last encounter with the same seed (C-330 AC-5). */
  retryEncounter(options: { setActive: (overlay: GameOverlayType) => void }): void;
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
  private _combatSeed: number | undefined = $state(undefined);
  private _encounterId: string | null | undefined = $state(undefined);
  private _lastCombatOptions: CombatServiceInterface['lastCombatOptions'] = $state(null);

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

  get combatSeed(): number | undefined {
    return this._combatSeed;
  }

  get encounterId(): string | null | undefined {
    return this._encounterId;
  }

  constructor(options: BaseFrontendClassOptions) {
    super(options);
    registerSerializable('combat', this as unknown as SerializableService<unknown>);
  }

  get lastCombatOptions(): CombatServiceInterface['lastCombatOptions'] {
    return this._lastCombatOptions;
  }

  startCombat(options: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
    setActive: (overlay: GameOverlayType) => void;
    combatSeed?: number;
    encounterId?: string | null;
    allowNonCombatResolution?: boolean;
  }): void {
    this._enemyName = options.enemyName;
    this._enemyHp = options.enemyHp;
    this._enemyMaxHp = options.enemyMaxHp;
    this._participantIds = options.participantIds;
    this._firstTurnEntityId = options.firstTurnEntityId;
    this._combatSeed = options.combatSeed;
    this._encounterId = options.encounterId;
    // Store options for retry (C-330 AC-5)
    this._lastCombatOptions = {
      enemyName: options.enemyName,
      enemyHp: options.enemyHp,
      enemyMaxHp: options.enemyMaxHp,
      participantIds: options.participantIds,
      firstTurnEntityId: options.firstTurnEntityId,
      combatSeed: options.combatSeed,
      encounterId: options.encounterId,
      allowNonCombatResolution: options.allowNonCombatResolution,
    };
    options.setActive('COMBAT');
    gameEngineService.pauseEngine();
  }

  retryEncounter(options: { setActive: (overlay: GameOverlayType) => void }): void {
    const last = this._lastCombatOptions;
    if (!last) {
      this.warn('retryEncounter:no-previous-encounter');
      return;
    }
    this.debug('retryEncounter', { combatSeed: last.combatSeed, encounterId: last.encounterId });

    // Send engine-level retry command to reset ECS health, turn state, and RNG (CR finding)
    if (last.combatSeed !== undefined) {
      void import('@aikami/frontend/engine').then(({ createEngineBridge }) => {
        createEngineBridge().send({
          type: 'RETRY_ENCOUNTER',
          combatSeed: last.combatSeed ?? 0,
          encounterId: last.encounterId,
        });
      });
    }

    // Re-initialize with the same options and seed for deterministic replay (AC-5)
    this.startCombat({
      ...last,
      setActive: options.setActive,
    });
  }

  serialize(): CombatState {
    return {
      enemyName: this._enemyName,
      enemyHp: this._enemyHp,
      enemyMaxHp: this._enemyMaxHp,
      participantIds: [...this._participantIds],
      firstTurnEntityId: this._firstTurnEntityId,
      combatSeed: this._combatSeed,
      encounterId: this._encounterId,
      lastCombatOptions: this._lastCombatOptions ? { ...this._lastCombatOptions } : undefined,
    };
  }

  hydrate(data: CombatState): void {
    this._enemyName = data.enemyName;
    this._enemyHp = data.enemyHp;
    this._enemyMaxHp = data.enemyMaxHp;
    this._participantIds = [...data.participantIds];
    this._firstTurnEntityId = data.firstTurnEntityId;
    this._combatSeed = data.combatSeed;
    this._encounterId = data.encounterId;
    // Restore retry options for save/load support (CR finding)
    if (data.lastCombatOptions) {
      this._lastCombatOptions = { ...data.lastCombatOptions };
    }
  }
}

export const combatService: CombatServiceInterface = CombatService.create({
  className: 'CombatService',
}) as CombatServiceInterface;
