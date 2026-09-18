// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_live_session.ts
//
// Owns ONE isolated real combat session for the debug workspace: a private
// GameWorld, its ECS worker, the engine bridge and the loaded content pack.
// It boots runtime dependencies (PixiJS, worker bundle, content pack) through
// dynamic imports — the same heavy-module exception the production boot uses —
// and exposes an authoritative, typed read surface:
//
//   - live `CombatState` snapshots requested over the bridge (never scraped);
//   - committed event batches for the trace timeline;
//   - a monotonically increasing observed revision.
//
// The session is deliberately a plain class, not a ViewModel: it has no
// presentation state and must be testable without rune polyfills. The workspace
// ViewModel owns its lifecycle (boot, reset, dispose) and guards startup so a
// scenario switch or navigation-away cannot finish booting an obsolete session.
//
// Contract: combat debug workspace (execution prompt §2, §6, §7)

import { BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import type {
  EngineBridge,
  GameCommand,
  GameWorld,
  GameWorldOptions,
  TextureManager,
} from '@aikami/frontend/engine';
import type { CombatCommand, CombatState } from '@aikami/types';
import { logger } from '$logger';
import type { CombatDebugScenarioDefinition } from '../types/combat_debug_types.ts';
import {
  type CombatDebugCommandGate,
  createCombatDebugCommandGate,
} from './combat_debug_command_gate.ts';
import type { CombatDebugSessionObserver } from './combat_debug_session_contract.ts';

export type { CombatDebugSessionSnapshot } from './combat_debug_session_contract.ts';

/** The runtime capabilities the session needs, injected by composition. */
export type CombatDebugLiveSessionCapabilities = {
  /**
   * Resolves a content-pack-relative URL to a fetchable URL. Kept as a
   * capability so the session module never imports the client asset registry
   * directly and remains testable.
   */
  resolveTag: (url: string) => string | null;
  /** Releases a resolved URL after parsing (refcounted blob URLs). */
  releaseUrl: (url: string) => void;
  /**
   * Starts a bounded synthetic encounter for a synthetic battlefield scenario.
   * The roster is declarative scenario data — no authored content needed.
   */
  startSyntheticEncounter: (options: {
    encounterId: string;
    seed: number;
    roster: unknown;
    send: (command: unknown) => void;
  }) => boolean;
  /** Loads the Emberwatch content-pack loader (heavy, dynamic in production). */
  loadContentPack: () => Promise<unknown>;
  /**
   * Starts the authored encounter through the real production path. Injected
   * because it needs the client roster builder; keeping it a capability means
   * this module never imports `$services` or the engine's worker internals. The
   * `send` function is the session's own bridge, passed so this capability
   * never reaches for a global.
   */
  startAuthoredEncounter: (options: {
    contentPack: unknown;
    encounterId: string;
    seed: number;
    send: (command: unknown) => void;
  }) => boolean;
};

/** Callbacks the session raises; the ViewModel owns all reactive state. */
export type CombatDebugLiveSessionObserver = Omit<CombatDebugSessionObserver, 'onStatus'> & {
  onStatus(status: CombatDebugLiveSessionStatus): void;
};

/** Lifecycle status the session reports; mirrors the toolbar status set. */
export type CombatDebugLiveSessionStatus =
  | 'idle'
  | 'booting'
  | 'loading-pack'
  | 'loading-map'
  | 'starting-encounter'
  | 'ready'
  | 'ended'
  | 'error';

/** Options for {@link CombatDebugLiveSession}. */
export type CombatDebugLiveSessionOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly scenario: CombatDebugScenarioDefinition;
  readonly seed: number;
  readonly observer: CombatDebugLiveSessionObserver;
  readonly capabilities: CombatDebugLiveSessionCapabilities;
};

let _workerConstructor: (new () => Worker) | undefined;

/** Resolves the ECS worker constructor once per module load (Vite requires dyn). */
const resolveEcsWorker = async (): Promise<new () => Worker> => {
  const cached = _workerConstructor;
  if (cached) {
    return cached;
  }
  const module = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  const resolved = module.default as unknown as new () => Worker; // guard-ignore lint/type-safety/casting: Vite's ?worker&type=module default export is the Worker constructor; its emitted type is not the constructor signature
  _workerConstructor = resolved;
  return resolved;
};

/** djb2 hash — stable seed derivation matching the production seam. */
export const hashCombatDebugSeed = (value: string): number => {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
};

/**
 * Builds a minimal, deterministic synthetic roster for a synthetic scenario.
 * Declarative scenario data only — a player and one hostile on adjacent cells.
 * This is what makes the tiny scenarios runnable in the real kernel without an
 * authored content pack.
 */
export const buildSyntheticRoster = (
  scenario: CombatDebugScenarioDefinition,
): {
  participants: ReadonlyArray<{
    combatantId: string;
    team: 'player' | 'enemy';
    cell: { x: number; y: number };
    stats: {
      hitPoints: number;
      armorClass: number;
      attackBonus: number;
      initiative: number;
      movementPerTurn: number;
    };
    displayName: string;
    classIds: readonly string[];
  }>;
} => ({
  participants: [
    {
      combatantId: 'player',
      team: 'player',
      cell: { x: 2, y: 2 },
      stats: {
        hitPoints: 30,
        armorClass: 13,
        attackBonus: 4,
        initiative: 10,
        movementPerTurn: 6,
      },
      displayName: 'Adventurer',
      classIds: ['fighter'],
    },
    {
      combatantId: 'debug_hostile',
      team: 'enemy',
      cell: { x: 4, y: 2 },
      stats: {
        hitPoints: 18,
        armorClass: 11,
        attackBonus: 3,
        initiative: 8,
        movementPerTurn: 6,
      },
      displayName: `Hostile (${scenario.id})`,
      classIds: ['fighter'],
    },
  ],
});

type ReplayableCombatBridgeCommand = Extract<
  GameCommand,
  {
    type:
      | 'COMBAT_ACTION'
      | 'COMBAT_MOVE'
      | 'COMBAT_END_TURN'
      | 'COMBAT_INTERACT'
      | 'COMBAT_REACTION_SELECTED';
  }
>;

/** Projects a replay-safe kernel command only when the bridge carried every required fact. */
export const projectCombatDebugReplayCommand = (
  command: ReplayableCombatBridgeCommand,
): CombatCommand | undefined => {
  if (command.type === 'COMBAT_REACTION_SELECTED') {
    return {
      kind: 'resolveReaction',
      combatantId: command.reactorId,
      encounterRunId: command.encounterRunId,
      windowId: command.windowId,
      windowVersion: command.windowVersion,
      choice: command.choice,
      source: command.source,
    };
  }

  const combatantId = command.combatantId;
  if (combatantId === undefined) {
    return undefined;
  }
  if (command.type === 'COMBAT_END_TURN') {
    return { kind: 'endTurn', combatantId };
  }
  if (command.type === 'COMBAT_MOVE') {
    if (command.path === undefined) {
      return undefined;
    }
    return { kind: 'move', combatantId, path: command.path.map((cell) => ({ ...cell })) };
  }
  if (command.type === 'COMBAT_INTERACT') {
    return {
      kind: 'interactWithObject',
      combatantId,
      objectId: command.objectId,
      affordanceId: command.affordanceId,
      targetObjectId: command.targetObjectId ?? null,
    };
  }
  if (command.action === 'DEFEND') {
    return { kind: 'defend', combatantId };
  }
  if (command.action !== 'ATTACK' && command.action !== 'ABILITY') {
    return undefined;
  }
  const abilityId = command.action === 'ATTACK' ? BASIC_MELEE_ABILITY_ID : command.abilityId;
  if (abilityId === undefined) {
    return undefined;
  }
  const rawTargetIds =
    command.targetIds ?? (command.targetId === undefined ? [] : [command.targetId]);
  if (!rawTargetIds.every((targetId) => typeof targetId === 'string')) {
    return undefined;
  }
  return { kind: 'useAbility', combatantId, abilityId, targetIds: rawTargetIds };
};

/**
 * A single isolated real combat session. Create one per live workspace; call
 * {@link boot} once and {@link dispose} exactly once. It never reads private
 * kernel state or scrapes the DOM.
 */
export class CombatDebugLiveSession {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _scenario: CombatDebugScenarioDefinition;
  private readonly _seed: number;
  private readonly _observer: CombatDebugLiveSessionObserver;
  private readonly _capabilities: CombatDebugLiveSessionCapabilities;

  private _gameWorld: GameWorld | undefined;
  private _rawBridge: EngineBridge | undefined;
  private _bridge: EngineBridge | undefined;
  private _textureManager: TextureManager | undefined;
  private _disposed = false;
  private _unsubscribers: Array<() => void> = [];
  private _requestCounter = 0;
  private readonly _pendingSnapshotRequests = new Map<
    string,
    {
      resolve(state: CombatState): void;
      reject(error: Error): void;
    }
  >();
  private readonly _commandGate: CombatDebugCommandGate = createCombatDebugCommandGate();

  constructor(options: CombatDebugLiveSessionOptions) {
    this._canvas = options.canvas;
    this._scenario = options.scenario;
    this._seed = options.seed;
    this._observer = options.observer;
    this._capabilities = options.capabilities;
  }

  /** Whether this session has been disposed; guards late async completion. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * The session's engine bridge, so the workspace can drive the PRODUCTION
   * combat ViewModel against this isolated world instead of reimplementing the
   * combat UI. Undefined until {@link boot} has created it.
   */
  get bridge(): EngineBridge | undefined {
    return this._bridge;
  }

  // ── Debugger command boundary ──────────────────────────────
  //
  // The engine has no pause primitive, so the debugger owns the only boundary
  // it can honestly own: client → engine command dispatch. See
  // ./combat_debug_command_gate.ts for the exact semantics and limits.

  /** Holds (pause) or releases (resume) the client → engine boundary. */
  setCommandGateHeld(held: boolean): void {
    this._commandGate.setHeld(held);
  }

  /** Commands waiting at the boundary. */
  get queuedCommandCount(): number {
    return this._commandGate.queuedCount;
  }

  /**
   * Releases exactly one queued command at the boundary. Returns false when
   * nothing was waiting — the debugger never invents a transition.
   */
  stepCommandGate(): boolean {
    return this._commandGate.step();
  }

  /**
   * Boots the real engine, loads the scenario battlefield and starts the
   * encounter. Every `await` is followed by a dispose check so a superseded
   * session never finishes booting.
   */
  async boot(): Promise<void> {
    this._observer.onStatus('booting');
    try {
      const engine = await import('@aikami/frontend/engine');
      if (this._disposed) {
        return;
      }
      const bridge: EngineBridge = engine.createEngineBridge();
      // The production consumer drives commands through the gated view of the
      // bridge so the debugger can hold the client → engine boundary. While the
      // gate is open this is a transparent pass-through; the raw bridge is used
      // for listener registration so event delivery is never gated.
      this._rawBridge = bridge;
      this._bridge = this._commandGate.wrap(bridge);
      const workerConstructor = await resolveEcsWorker();
      if (this._disposed) {
        return;
      }
      this._textureManager = new engine.TextureManager({});

      const { sandboxRecipeResolver } = await import('../../sandbox/shared/lpc_sandbox_resolver');
      if (this._disposed) {
        return;
      }

      const worldOptions: GameWorldOptions = {
        className: 'CombatDebugGameWorld',
        bridge,
        workerFactory: () => new workerConstructor(),
        recipeResolver: sandboxRecipeResolver,
        textureManager: this._textureManager,
        resolveTag: this._capabilities.resolveTag,
        releaseUrl: this._capabilities.releaseUrl,
      };
      const gameWorld = engine.GameWorld.create(worldOptions);
      this._gameWorld = gameWorld;

      await gameWorld.initialize({
        canvas: this._canvas,
        playerData: { name: 'Adventurer' },
      });
      if (this._disposed) {
        return;
      }

      this._subscribeToBridge(bridge);

      if (this._scenario.battlefield.kind === 'authored') {
        const contentPack = await this._loadAuthoredBattlefield(gameWorld);
        if (this._disposed) {
          return;
        }
        if (contentPack !== undefined) {
          this._observer.onStatus('starting-encounter');
          const started = this._capabilities.startAuthoredEncounter({
            contentPack,
            encounterId: this._scenario.battlefield.encounterId,
            seed: this._seed,
            send: (command) => bridge.send(command as never),
          });
          if (!started) {
            this._observer.onError('Unable to start the authored combat encounter.');
            this._observer.onStatus('error');
            return;
          }
        }
      } else {
        this._observer.onStatus('starting-encounter');
        const started = this._capabilities.startSyntheticEncounter({
          encounterId: this._scenario.id,
          seed: this._seed,
          roster: buildSyntheticRoster(this._scenario),
          send: (command) => bridge.send(command as never),
        });
        if (!started) {
          this._observer.onError('Unable to start the synthetic combat encounter.');
          this._observer.onStatus('error');
          return;
        }
      }

      this._observer.onStatus('ready');
    } catch (error: unknown) {
      if (this._disposed) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._observer.onError(message);
      this._observer.onStatus('error');
    }
  }

  /** Requests an authoritative snapshot of the live v2 state. */
  requestSnapshot(encounterId: string): Promise<CombatState> {
    const bridge = this._rawBridge;
    if (!bridge) {
      return Promise.reject(new Error('Live session is not booted.'));
    }
    const requestId = `snap-${this._requestCounter++}`;
    return new Promise<CombatState>((resolve, reject) => {
      this._pendingSnapshotRequests.set(requestId, { resolve, reject });
      try {
        bridge.send({ type: 'COMBAT_STATE_SNAPSHOT_REQUESTED', requestId, encounterId });
      } catch (error: unknown) {
        this._pendingSnapshotRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Disposes every listener, worker and texture handle exactly once. */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    // Drop anything waiting at the debugger boundary — a disposed session must
    // never dispatch a stale queued command into a dead worker.
    this._commandGate.clear();
    this._commandGate.setHeld(false);

    for (const unsubscribe of this._unsubscribers) {
      try {
        unsubscribe();
      } catch (error: unknown) {
        logger.warn('combatDebugLiveSession:unsubscribe-failed', { error: String(error) });
      }
    }
    this._unsubscribers = [];

    const textureManager = this._textureManager;
    textureManager?.destroy();
    this._textureManager = undefined;

    const gameWorld = this._gameWorld;
    gameWorld?.destroy();
    this._gameWorld = undefined;
    this._rawBridge = undefined;
    this._bridge = undefined;
    const disposalError = new Error('Combat debug session was disposed.');
    for (const pending of this._pendingSnapshotRequests.values()) {
      pending.reject(disposalError);
    }
    this._pendingSnapshotRequests.clear();
  }

  // ── Internals ──────────────────────────────────────────────

  private async _loadAuthoredBattlefield(gameWorld: GameWorld): Promise<unknown | undefined> {
    if (this._scenario.battlefield.kind !== 'authored') {
      return undefined;
    }
    this._observer.onStatus('loading-pack');
    const pack = (await this._capabilities.loadContentPack()) as {
      resolveMapUrl(mapId: string): string;
      manifest: { maps: Record<string, { defaultX?: number; defaultY?: number }> };
    };
    if (this._disposed) {
      return undefined;
    }
    const mapId = this._scenario.battlefield.mapId;
    const map = pack.manifest.maps[mapId];
    this._observer.onStatus('loading-map');

    await gameWorld.loadMap({
      mapUrl: pack.resolveMapUrl(mapId),
      targetX: map?.defaultX ?? 0,
      targetY: map?.defaultY ?? 0,
    });
    return pack;
  }

  private _subscribeToBridge(bridge: EngineBridge): void {
    // Outgoing requests: `onCommand` fires when the controller dispatches, so
    // the timeline can show "requested" before the engine's acknowledgement.
    const requestedCommands = [
      'COMBAT_ACTION',
      'COMBAT_MOVE',
      'COMBAT_END_TURN',
      'COMBAT_INTERACT',
      'COMBAT_REACTION_SELECTED',
    ] as const;
    for (const commandType of requestedCommands) {
      this._unsubscribers.push(
        bridge.onCommand(commandType, (command) => {
          const identity = command as {
            commandId?: string;
            basedOnRevision?: number;
          };
          this._observer.onCommandRequested({
            commandType,
            commandId: identity.commandId,
            basedOnRevision: identity.basedOnRevision,
            replayCommand: projectCombatDebugReplayCommand(command),
          });
        }),
      );
    }

    this._unsubscribers.push(
      bridge.on('COMBAT_STATE_SNAPSHOT', (event) => {
        const pending = this._pendingSnapshotRequests.get(event.requestId);
        if (pending) {
          this._pendingSnapshotRequests.delete(event.requestId);
          pending.resolve(event.state);
        }
        this._emitSnapshot(event.state);
      }),
    );
    this._unsubscribers.push(
      bridge.on('COMBAT_STATE_SNAPSHOT_REJECTED', (event) => {
        const pending = this._pendingSnapshotRequests.get(event.requestId);
        if (pending) {
          this._pendingSnapshotRequests.delete(event.requestId);
          pending.reject(new Error(`Snapshot rejected: ${event.messageKey}`));
        }
        this._observer.onError(`Snapshot rejected: ${event.messageKey}`);
      }),
    );
    this._unsubscribers.push(
      bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
        this._observer.onEvents(event.events);
      }),
    );
    this._unsubscribers.push(
      bridge.on('COMBAT_COMMAND_ACCEPTED', (event) => {
        this._observer.onCommandAccepted({
          commandId: event.commandId,
          stateRevision: event.stateRevision,
          duplicate: event.duplicate === true,
        });
      }),
    );
    this._unsubscribers.push(
      bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
        this._observer.onCommandRejected({
          commandType: event.commandType,
          reasonCode: event.reasonCode,
          messageKey: event.messageKey,
          detail: event.detail,
        });
      }),
    );
    this._unsubscribers.push(
      bridge.on('COMBAT_ENDED', () => {
        this._observer.onStatus('ended');
      }),
    );
  }

  private _emitSnapshot(state: CombatState): void {
    this._observer.onSnapshot({
      state,
      revision: state.stateRevision,
      round: state.round,
      phase: state.phase,
      activeCombatantId: parseActiveCombatantId(state.turnId),
    });
  }
}

/**
 * Extracts the acting combatant id from a turn id. Turn ids are
 * `r{round}:{combatantId}`; a null turn id means no one owns the turn.
 */
export const parseActiveCombatantId = (turnId: string | null): string | undefined => {
  if (turnId === null) {
    return undefined;
  }
  const separator = turnId.indexOf(':');
  if (separator === -1 || separator === turnId.length - 1) {
    return turnId;
  }
  return turnId.slice(separator + 1);
};
