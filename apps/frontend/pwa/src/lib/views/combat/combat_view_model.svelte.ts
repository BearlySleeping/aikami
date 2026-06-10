// apps/frontend/pwa/src/lib/views/combat/combat_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// CombatViewModel — Svelte 5 ViewModel for the combat / turn-based battle UI
// ---------------------------------------------------------------------------

export type CombatViewModelOptions = BaseViewModelOptions;

export type CombatViewModelInterface = BaseViewModelInterface & {
  /**
   * All entity IDs currently alive and participating in the combat encounter.
   * Updated reactively via TURN_CHANGED and COMBAT_STARTED bridge events.
   * Dead entities are removed from this list automatically.
   */
  readonly activeEntities: number[];

  /**
   * The entity ID that currently has the active turn.
   * `null` when no combat encounter is in progress.
   */
  readonly currentTurnEntity: number | null;

  /**
   * Total number of entities participating in combat (alive + dead).
   * Only available after COMBAT_STARTED. Resets on COMBAT_ENDED.
   */
  readonly totalParticipants: number;

  /**
   * Number of entities still alive (health > 0).
   * Derived from activeEntities.length.
   */
  readonly aliveCount: number;

  /** Current player hit points. */
  readonly playerHp: number;

  /** Maximum player hit points. */
  readonly playerMaxHp: number;

  /** Current enemy hit points. */
  readonly enemyHp: number;

  /** Maximum enemy hit points. */
  readonly enemyMaxHp: number;

  /** Ordered combat log entries — most recent first. */
  readonly combatLog: readonly string[];

  /**
   * Battle outcome.
   * `null` while combat is ongoing; `'victory'` or `'defeat'` when ended.
   */
  readonly combatResult: 'victory' | 'defeat' | null;

  /** CSS class string for the battle result banner. */
  readonly combatResultBannerClass: string;

  /** Whether a combat encounter is currently in progress. */
  readonly inCombat: boolean;
};

/**
 * ViewModel for the combat UI route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 *
 * **Critical boundary rule**: This ViewModel NEVER imports PixiJS, bitECS,
 * or any game-internal types. All communication with the game engine goes
 * through the typed EngineBridge — specifically listening for TURN_CHANGED,
 * COMBAT_STARTED, and COMBAT_ENDED events.
 */
export class CombatViewModel
  extends BaseViewModel<CombatViewModelOptions>
  implements CombatViewModelInterface
{
  activeEntities: number[] = $state([]);

  currentTurnEntity: number | null = $state(null);

  /** Cached total from COMBAT_STARTED, reset on COMBAT_ENDED. */
  totalParticipants = $state(0);

  playerHp = $state(100);

  playerMaxHp = $state(100);

  enemyHp = $state(80);

  enemyMaxHp = $state(80);

  combatLog: string[] = $state([]);

  combatResult: 'victory' | 'defeat' | null = $state(null);

  /** Derived count of alive entities. */
  get aliveCount(): number {
    return this.activeEntities.length;
  }

  /** Whether a combat encounter is currently in progress. */
  get inCombat(): boolean {
    return this.currentTurnEntity !== null;
  }

  /** CSS class string for the battle result banner. */
  get combatResultBannerClass(): string {
    if (this.combatResult === 'victory') {
      return 'bg-success/20 text-success';
    }
    if (this.combatResult === 'defeat') {
      return 'bg-error/20 text-error';
    }
    return '';
  }

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: import('@aikami/frontend/engine').EngineBridge | undefined;

  /** Cleanup functions for bridge event listeners. */
  private _disposeListeners: Array<() => void> = [];

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');

      this._bridge = createEngineBridge();
      this._registerListeners();
    } catch (error) {
      this.debug('Failed to initialize combat bridge', error);
    }
  }

  /**
   * Registers bridge event listeners for combat-related events.
   *
   * All listeners are stored in _disposeListeners so they can be
   * cleanly removed in dispose() — satisfying AC-3 cleanup requirements.
   */
  private _registerListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    const removeTurnChanged = bridge.on('TURN_CHANGED', (event) => {
      this.activeEntities = event.activeEntities;
      this.currentTurnEntity = event.currentEntityId;
    });

    const removeCombatStarted = bridge.on('COMBAT_STARTED', (event) => {
      this.activeEntities = event.participantIds;
      this.currentTurnEntity = event.firstTurnEntityId;
      this.totalParticipants = event.participantIds.length;
    });

    const removeCombatEnded = bridge.on('COMBAT_ENDED', () => {
      this.activeEntities = [];
      this.currentTurnEntity = null;
      this.totalParticipants = 0;
      this.combatResult = null;
    });

    this._disposeListeners.push(removeTurnChanged, removeCombatStarted, removeCombatEnded);
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    // Unregister all bridge listeners (AC-3: cleanup)
    for (const cleanup of this._disposeListeners) {
      cleanup();
    }
    this._disposeListeners = [];

    this._bridge = undefined;
    this.activeEntities = [];
    this.currentTurnEntity = null;
    this.totalParticipants = 0;
    this.playerHp = 100;
    this.playerMaxHp = 100;
    this.enemyHp = 80;
    this.enemyMaxHp = 80;
    this.combatLog = [];
    this.combatResult = null;

    await super.dispose();
  }
}

/**
 * Factory function for creating CombatViewModel instances.
 *
 * @param options - ViewModel options (standard BaseViewModelOptions).
 * @returns A fully initialized CombatViewModel instance.
 */
export const getCombatViewModel = (options: CombatViewModelOptions): CombatViewModel => {
  return new CombatViewModel(options);
};
