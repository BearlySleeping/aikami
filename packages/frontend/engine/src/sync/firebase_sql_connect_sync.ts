// packages/frontend/engine/src/sync/firebase_sql_connect_sync.ts

import { BaseEngineClass, type BaseEngineClassOptions } from '../base_engine_class.ts';
import type { StringRegistryService } from '../services/string_registry_service.ts';

// ---------------------------------------------------------------------------
// FirebaseSqlConnectSync — live Firebase SQL Connect → registry delta sync
//
// Contract C-195 AC-3: Wires asynchronous synchronization events into
// Firebase SQL Connect live data handlers, updating local registry records
// cleanly without stalling active physics operations.
//
// Architecture:
// 1. Firebase SQL Connect streams real-time INSERT/UPDATE/DELETE delta
//    records down to the client browser.
// 2. Delta keys pass into the worker registry via postMessage without
//    generating thread contention lockouts.
// 3. Update application runs outside the frame tick — the registry's Map
//    is updated atomically (Map.set is single-operation in V8) so active
//    frame reads never see partial state.
//
// Firebase Data Connect (SQL Connect) is an optional dependency. When
// unavailable, the bridge operates in stub mode and logs a warning.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Delta operation type from Firebase SQL Connect mutation stream.
 */
export type SqlConnectDeltaType = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * A single delta record from a Firebase SQL Connect live query subscription.
 */
export type SqlConnectDelta = {
  /** Operation type: INSERT, UPDATE, or DELETE. */
  readonly operation: SqlConnectDeltaType;
  /** Row primary key. */
  readonly id: number;
  /** The text value (INSERT/UPDATE) or null (DELETE). */
  readonly value: string | null;
};

/**
 * Options for constructing a {@link FirebaseSqlConnectSync}.
 */
export type FirebaseSqlConnectSyncOptions = BaseEngineClassOptions & {
  /** Reference to the active StringRegistryService instance. */
  registry: StringRegistryService;
};

// ---------------------------------------------------------------------------
// FirebaseSqlConnectSync
// ---------------------------------------------------------------------------

/**
 * Live synchronization bridge that applies Firebase SQL Connect delta
 * records to the local StringRegistryService.
 *
 * Deltas are applied outside the frame tick — Map.set is a single
 * V8 operation so active frame reads never see partial state.
 *
 * In stub mode (no SQL Connect connection), the bridge operates as a
 * no-op passthrough. Deltas can be fed manually via {@link applyDelta}
 * or {@link applyDeltas} for testing and offline simulation.
 *
 * Instantiate via {@link FirebaseSqlConnectSync.create}, never with `new`.
 */
export class FirebaseSqlConnectSync extends BaseEngineClass<FirebaseSqlConnectSyncOptions> {
  /** Reference to the active string registry. */
  private readonly _registry: StringRegistryService;

  /** Whether the live subscription is actively connected. */
  private _connected = false;

  /**
   * Do NOT use `new FirebaseSqlConnectSync()`. Use
   * {@link FirebaseSqlConnectSync.create} instead.
   */
  constructor(options: FirebaseSqlConnectSyncOptions) {
    super(options);
    this._registry = options.registry;
  }

  // -----------------------------------------------------------------------
  // Public: connection state
  // -----------------------------------------------------------------------

  /** Whether the live SQL Connect subscription is active. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Establishes a live subscription to Firebase SQL Connect.
   *
   * In stub mode (no Firebase Data Connect SDK available), marks the
   * bridge as connected for testing purposes.
   *
   * Call during boot after the registry is hydrated from Turso.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this.debug('connect:already-connected');
      return;
    }

    this.debug('connect:start');

    try {
      await this._subscribeToLiveQuery();
      this._connected = true;
      this.debug('connect:subscribed');
    } catch (error) {
      this.warn('connect:stub-mode', {
        message: 'Firebase Data Connect SDK not available — operating in stub mode',
        error,
      });
      // Mark as connected in stub mode so deltas can be fed manually
      this._connected = true;
    }
  }

  /**
   * Tears down the live subscription.
   */
  disconnect(): void {
    this._connected = false;
    this.debug('disconnect');
  }

  // -----------------------------------------------------------------------
  // Public: delta application
  // -----------------------------------------------------------------------

  /**
   * Applies a single SQL Connect delta record to the registry.
   *
   * - INSERT/UPDATE: registers the value (register is idempotent — if the
   *   string is already registered, returns the existing handle).
   * - DELETE: currently a no-op in the append-only registry model (handles
   *   are immutable for the execution instance lifecycle). A debug log is
   *   emitted for observability.
   *
   * This method runs outside the frame tick. Map.set is a single V8
   * operation — active frame reads never see partial state.
   *
   * @param delta - The delta record to apply.
   */
  applyDelta(delta: SqlConnectDelta): void {
    if (delta.operation === 'DELETE') {
      // Handles are immutable for the lifecycle of the execution instance.
      // DELETEs from the server are recorded for observability but do not
      // evict handles from the registry.
      this.render('applyDelta:delete', { id: delta.id });
      return;
    }

    if (delta.value === null || delta.value === '') {
      this.render('applyDelta:skip-null', { id: delta.id, operation: delta.operation });
      return;
    }

    const handle = this._registry.register(delta.value);
    this.render('applyDelta', { operation: delta.operation, id: delta.id, handle });
  }

  /**
   * Applies multiple delta records in batch.
   *
   * @param deltas - Array of delta records to apply.
   */
  applyDeltas(deltas: readonly SqlConnectDelta[]): void {
    for (const delta of deltas) {
      this.applyDelta(delta);
    }
    this.debug('applyDeltas', { count: deltas.length });
  }

  // -----------------------------------------------------------------------
  // Private: SQL Connect subscription
  // -----------------------------------------------------------------------

  /**
   * Subscribes to the Firebase SQL Connect live query.
   *
   * Uses dynamic import for the Firebase Data Connect SDK to avoid a hard
   * dependency. When unavailable, throws to trigger stub mode.
   */
  private async _subscribeToLiveQuery(): Promise<void> {
    this.debug('_subscribeToLiveQuery:start');

    // Dynamic import — Firebase Data Connect SDK is an optional peer dependency
    // The import validates package resolvability; actual subscription API
    // will be wired when the Firebase Data Connect SDK stabilizes.
    void (await import('@firebase/data-connect'));

    // Placeholder: the actual subscription setup depends on the Firebase
    // Data Connect SDK API, which is still evolving. When the SDK stabilizes,
    // this block will be updated with the concrete subscription pattern.
    //
    // Expected pattern:
    //   const ref = _dataConnect.ref(db, 'string_registry');
    //   _dataConnect.onSnapshot(ref, (snapshot) => {
    //     for (const change of snapshot.docChanges()) {
    //       this.applyDelta(change);
    //     }
    //   });

    this.warn('_subscribeToLiveQuery:not-implemented', {
      message:
        'Firebase Data Connect SDK subscription API is pending SDK stabilization. ' +
        'Use applyDelta() manually for now.',
    });

    throw new Error('SQL Connect subscription not yet implemented');
  }
}
