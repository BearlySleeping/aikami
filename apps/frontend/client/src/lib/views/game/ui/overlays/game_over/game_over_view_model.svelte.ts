// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/game_over_view_model.svelte.ts
//
// Game-over overlay ViewModel. Retries the last encounter, respawns the player,
// or loads the last save.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/game_over_fixtures.ts).
// Production wiring lives in ./game_over_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { GameOverlayType } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The combat-init options needed to retry the last encounter. */
export type GameOverEncounterOptions = {
  enemyName: string;
  enemyNpcId?: string;
  enemyHp: number;
  enemyMaxHp: number;
  participantIds: number[];
  firstTurnEntityId: number;
  combatSeed?: number;
  encounterId?: string | null;
  allowNonCombatResolution?: boolean;
};

/** Combat-state capability the game-over overlay reads and drives. */
export type GameOverCombatCapabilities = {
  readonly lastCombatOptions: GameOverEncounterOptions | null;
  retryEncounter(options: { setActive: (overlay: GameOverlayType) => void }): void;
};

/** Overlay capability the game-over overlay drives. */
export type GameOverOverlayCapabilities = {
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  setActive(overlay: GameOverlayType): void;
};

// ── Types ───────────────────────────────────────────────────────────────

/** Base configuration used to create the game-over overlay ViewModel. */
export type GameOverViewModelOptions = BaseViewModelOptions & {
  /** Combat capability. */
  combat: GameOverCombatCapabilities;
  /** Overlay capability. */
  overlay: GameOverOverlayCapabilities;
};

export type GameOverViewModelInterface = BaseViewModelInterface & {
  readonly canRetry: boolean;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  /** Retry the last encounter with the same seed (C-330 AC-5). */
  retryEncounter(): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class GameOverViewModel
  extends BaseViewModel<GameOverViewModelOptions>
  implements GameOverViewModelInterface
{
  private readonly _combat: GameOverCombatCapabilities;
  private readonly _overlay: GameOverOverlayCapabilities;

  constructor(options: GameOverViewModelOptions) {
    super(options);
    this._combat = options.combat;
    this._overlay = options.overlay;
  }

  get canRetry(): boolean {
    return this._combat.lastCombatOptions !== null;
  }

  async respawnPlayer(): Promise<void> {
    await this._overlay.respawnPlayer();
  }

  async loadLastSave(): Promise<void> {
    await this._overlay.loadLastSave();
  }

  retryEncounter(): void {
    this._combat.retryEncounter({
      setActive: (overlay) => {
        this._overlay.setActive(overlay);
      },
    });
  }
}

/**
 * Builds a game-over ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameOverViewModel` in ./game_over_composition.ts.
 */
export const createGameOverViewModel = (
  options: GameOverViewModelOptions,
): GameOverViewModelInterface => GameOverViewModel.create(options);
