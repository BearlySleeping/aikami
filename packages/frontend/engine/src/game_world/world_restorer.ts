// packages/frontend/engine/src/game_world/world_restorer.ts
//
// Snapshot/restore boundary for the simulation worker.
//
// Two callers, two very different contracts:
//
// - `restore()` is the PUBLIC restore (load game / bridge handler). Loading a
//   save is a genuine discontinuity: it teleports the player, so it must
//   supersede any in-flight map transition and drop interpolation history.
// - `rehydrate()` is the INTERNAL restore used by scene-transition recovery.
//   It also teleports entities, but it runs *inside* a live transition, so it
//   must NOT supersede that transition — doing so would abandon the recovery
//   halfway and leave a half-restored world behind.
//
// Collapsing the two (i.e. recovery calling the public `restoreWorld`) is the
// bug this module exists to prevent: `restoreWorld` bumps the transition
// generation, so the in-flight recovery would immediately consider itself
// superseded and hand back control mid-restore.
//
// Ordering matters too. The worker processes messages in order and both
// operations are correlated requests, so issuing `LOAD_MAP` (the replayed
// scene) before this `LOAD_GAME` (the authoritative checkpoint) guarantees the
// checkpoint lands last and wins.

/** Snapshot scope understood by the worker. */
export type SnapshotScope = 'player' | 'world';

/** Injection points — the restorer owns sequencing, not transport. */
export type WorldRestorerDeps = {
  /** Correlated full snapshot request; rejects on timeout/crash/disposal. */
  requestSnapshot: (scope: SnapshotScope) => Promise<string>;
  /** Correlated LOAD_GAME request; resolves on the worker's ready reply. */
  requestRestore: (payload: string) => Promise<void>;
  /** Drops every live display object so the restored world rebuilds cleanly. */
  clearRenderEntries: () => void;
  /** Clears the E2E/debug NPC bookkeeping tied to the old entity set. */
  resetNpcDiagnostics: () => void;
  /** Drops cross-scene interpolation history (entities teleport). */
  resetInterpolationHistory: () => void;
  /** Supersedes any in-flight transition. PUBLIC restores only. */
  invalidateInFlight: () => void;
  log: {
    debug: (message: string, detail?: unknown) => void;
    warn: (message: string, detail?: unknown) => void;
    error: (message: string, detail?: unknown) => void;
  };
};

export class WorldRestorer {
  private readonly _deps: WorldRestorerDeps;

  constructor(deps: WorldRestorerDeps) {
    this._deps = deps;
  }

  /**
   * Captures the authoritative runtime state of the live world.
   *
   * Used as the pre-teardown checkpoint of a map switch: everything only the
   * worker knows (player position, health, equipment, NPC state) as of RIGHT
   * NOW. Returns `undefined` when no snapshot could be produced — the caller
   * must then refuse to destroy the world it cannot save.
   */
  async captureCheckpoint(): Promise<string | undefined> {
    try {
      const payload = await this._deps.requestSnapshot('world');
      if (!payload) {
        this._deps.log.warn('[WorldRestorer] checkpoint:empty-payload');
        return undefined;
      }
      return payload;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this._deps.log.warn('[WorldRestorer] checkpoint:failed', { error: detail });
      return undefined;
    }
  }

  /**
   * Rehydrates the world from `payload` WITHOUT touching the transition
   * generation. For use inside a recovery that is still running.
   */
  async rehydrate(payload: string): Promise<void> {
    this._deps.log.debug('[WorldRestorer] rehydrate', { bytes: payload.length });
    await this._applyPayload(payload);
  }

  /**
   * Restores the world from a save as a genuine discontinuity.
   *
   * Supersedes in-flight transitions first, so a map load that is mid-flight
   * cannot install its scene on top of the restored world.
   */
  async restore(payload: string): Promise<void> {
    this._deps.log.debug('[WorldRestorer] restore', { bytes: payload.length });
    this._deps.invalidateInFlight();
    await this._applyPayload(payload);
  }

  /** Shared body: clear the old entity set, then rehydrate it in the worker. */
  private async _applyPayload(payload: string): Promise<void> {
    this._deps.clearRenderEntries();
    this._deps.resetNpcDiagnostics();
    // Restored entities appear at their saved positions, so the previous
    // interpolation history belongs to a world that no longer exists.
    this._deps.resetInterpolationHistory();
    await this._deps.requestRestore(payload);
  }
}
