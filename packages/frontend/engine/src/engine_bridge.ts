// apps/frontend/game/src/engine/engine_bridge.ts
import type { GameCommand, GameEvent } from './types.ts';

// ---------------------------------------------------------------------------
// EngineBridge — typed bidirectional message channel
// ---------------------------------------------------------------------------

/**
 * The sole communication boundary between the UI layer and the
 * PixiJS v8 + bitECS game engine.
 *
 * **UI → Game**: call {@link EngineBridge.send} with a {@link GameCommand}.
 * **Game → UI**: game systems call {@link EngineBridge.emit} with a
 *   {@link GameEvent}; UI listens via {@link EngineBridge.on}.
 *
 * All payloads crossing the bridge are plain serializable objects —
 * NO PixiJS objects, NO bitECS handles, NO class instances.
 */
export type EngineBridge = {
  /**
   * Sends a command from the UI layer to the game engine.
   *
   * The game engine processes commands asynchronously — do NOT assume
   * synchronous side effects.
   */
  send(command: GameCommand): void;

  /**
   * Registers a listener for game events of a specific type.
   *
   * @param eventType - The discriminated union key (e.g. `'NPC_DIALOG_START'`)
   * @param handler   - Callback receiving the type-narrowed event payload
   * @returns A function that removes this listener when called
   */
  on<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void;

  /**
   * Emits an event from the game engine to the UI layer.
   *
   * Called exclusively by game systems (movement, dialog trigger, scene
   * loader).
   */
  emit(event: GameEvent): void;

  /**
   * Returns `true` when the game engine (PixiJS + bitECS) is fully
   * initialized and the game loop is running.
   */
  isReady(): boolean;

  /**
   * Executes a parsed slash command from the chat parser.
   *
   * Slash commands like `/roll 1d20` or `/move 10 10` are intercepted
   * by the chat ViewModel and dispatched here instead of being sent
   * to the AI service.
   */
  executeCommand(cmd: string, args: string[]): void;

  /**
   * Triggers a parsed macro from an AI response.
   *
   * Macros like `{{trigger_anim:attack}}` are stripped from the
   * displayed chat text and dispatched to the game engine for
   * animation, sound, or other side effects.
   *
   * @param entityId - Optional entity ID of the character the macro applies to.
   */
  triggerMacro(macro: string, args: string[], entityId?: number): void;

  /**
   * Creates a serialized snapshot of the current ECS world state.
   *
   * Delegates to the worker which calls {@link import('./serialization/ecs_serializer.ts').serializeWorld}
   * on the active bitECS world. Returns the JSON payload string.
   *
   * @returns The serialized ECS world state as a JSON string.
   * @throws If the engine is not initialized or the worker is not running.
   */
  createSnapshot(): Promise<string>;

  /**
   * Restores the ECS world state from a previously-created snapshot.
   *
   * Clears all current entities and display objects, then hydrates the
   * world from the snapshot payload. The engine remains running during
   * the restore — no re-initialization is required.
   *
   * @param snapshot - A JSON string produced by {@link createSnapshot}.
   * @throws If the engine is not initialized or the payload is invalid.
   */
  restoreSnapshot(snapshot: string): Promise<void>;
};

// ===========================================================================
// EngineBridgeImpl — singleton production implementation
// ===========================================================================

type ListenerEntry = {
  /** The event type this listener is registered for. */
  eventType: GameEvent['type'];
  /** The user-provided handler function. */
  handler: (event: GameEvent) => void;
};

/** Unique incrementing ID for listener entries. */
let nextListenerId = 0;

class EngineBridgeImpl implements EngineBridge {
  /** Ordered map of listener entries keyed by incrementing ID. */
  private readonly listeners = new Map<number, ListenerEntry>();

  /** Lookup: command type → set of command handlers. */
  private readonly commandHandlers = new Map<
    GameCommand['type'],
    Set<(cmd: GameCommand) => void>
  >();

  /** Whether the game engine is initialized and running. */
  private ready = false;

  // ---- EngineBridge implementation ------------------------------------

  /** @inheritdoc */
  send(command: GameCommand): void {
    const handlers = this.commandHandlers.get(command.type);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(command);
    }
  }

  /** @inheritdoc */
  on<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    const id = nextListenerId++;
    const entry: ListenerEntry = {
      eventType,
      handler: handler as (event: GameEvent) => void,
    };
    this.listeners.set(id, entry);

    return (): void => {
      this.listeners.delete(id);
    };
  }

  /** @inheritdoc */
  emit(event: GameEvent): void {
    for (const entry of this.listeners.values()) {
      if (entry.eventType === event.type) {
        entry.handler(event);
      }
    }
  }

  /** @inheritdoc */
  isReady(): boolean {
    return this.ready;
  }

  /** @inheritdoc */
  executeCommand(cmd: string, args: string[]): void {
    // ── Stub implementations ──
    switch (cmd) {
      case 'roll': {
        // TODO: implement dice rolling via slash commands
        void (args[0] ?? '1d20');
        break;
      }
      case 'move': {
        const x = Number(args[0]) || 0;
        const y = Number(args[1]) || 0;
        // Emit a MOVE_PLAYER event that the bitECS movement_system can listen to
        this.emit({
          type: 'PLAYER_POSITION_CHANGED',
          x,
          y,
          scene: 'command',
        });
        break;
      }
      default: {
        break;
      }
    }

    // Also dispatch as a generic EXECUTE_COMMAND for registered handlers
    const command: GameCommand = {
      type: 'EXECUTE_COMMAND',
      command: cmd,
      args,
    };
    this.send(command);
  }

  /** @inheritdoc */
  triggerMacro(macro: string, args: string[], entityId?: number): void {
    // Dispatch as a TRIGGER_MACRO for game systems that register handlers
    const command: GameCommand = {
      type: 'TRIGGER_MACRO',
      macro,
      args,
      entityId,
    };
    this.send(command);
  }

  // ---- Internal methods (NOT part of EngineBridge interface) ----------

  /**
   * Registers a command handler on the game-engine side.
   *
   * Called by the GameWorld during initialization so systems can receive
   * UI commands.
   */
  onCommand<T extends GameCommand['type']>(
    commandType: T,
    handler: (command: Extract<GameCommand, { type: T }>) => void,
  ): () => void {
    const existing = this.commandHandlers.get(commandType);
    if (existing) {
      existing.add(handler as (cmd: GameCommand) => void);
    } else {
      this.commandHandlers.set(commandType, new Set([handler as (cmd: GameCommand) => void]));
    }

    return (): void => {
      const set = this.commandHandlers.get(commandType);
      if (set) {
        set.delete(handler as (cmd: GameCommand) => void);
        if (set.size === 0) {
          this.commandHandlers.delete(commandType);
        }
      }
    };
  }

  /** Snapshot handler registered by the GameWorld. */
  private _snapshotHandler: (() => Promise<string>) | undefined;

  /** Restore handler registered by the GameWorld. */
  private _restoreHandler: ((snapshot: string) => Promise<void>) | undefined;

  /**
   * Sets the engine ready state. Called by GameWorld after PixiJS
   * initialization completes.
   */
  setReady(value: boolean): void {
    this.ready = value;
  }

  /**
   * Removes all listeners and command handlers. Called on GameWorld destroy.
   */
  reset(): void {
    this.listeners.clear();
    this.commandHandlers.clear();
    this._snapshotHandler = undefined;
    this._restoreHandler = undefined;
    this.ready = false;
  }

  /**
   * Registers the snapshot handler callback. Called by GameWorld during
   * initialization so {@link createSnapshot} delegates to the worker.
   */
  setSnapshotHandler(handler: () => Promise<string>): void {
    this._snapshotHandler = handler;
  }

  /**
   * Registers the restore handler callback. Called by GameWorld during
   * initialization so {@link restoreSnapshot} delegates to the worker.
   */
  setRestoreHandler(handler: (snapshot: string) => Promise<void>): void {
    this._restoreHandler = handler;
  }

  /** @inheritdoc */
  async createSnapshot(): Promise<string> {
    if (!this._snapshotHandler) {
      throw new Error('EngineBridge: no snapshot handler registered (engine not initialized)');
    }
    return this._snapshotHandler();
  }

  /** @inheritdoc */
  async restoreSnapshot(snapshot: string): Promise<void> {
    if (!this._restoreHandler) {
      throw new Error('EngineBridge: no restore handler registered (engine not initialized)');
    }
    return this._restoreHandler(snapshot);
  }
}

// ===========================================================================
// Singleton factory
// ===========================================================================

let instance: EngineBridgeImpl | undefined;

/**
 * Returns the singleton {@link EngineBridge} instance.
 *
 * Lazily creates the underlying implementation on first call.
 */
const createEngineBridge = (): EngineBridgeImpl => {
  if (!instance) {
    instance = new EngineBridgeImpl();
  }
  return instance;
};

// ===========================================================================
// MockEngineBridge — test double
// ===========================================================================

/**
 * A fully in-memory {@link EngineBridge} implementation for unit tests.
 */
export class MockEngineBridge implements EngineBridge {
  private readonly impl = new EngineBridgeImpl();

  send(command: GameCommand): void {
    this.impl.send(command);
  }

  on<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    return this.impl.on(eventType, handler);
  }

  emit(event: GameEvent): void {
    this.impl.emit(event);
  }

  isReady(): boolean {
    return this.impl.isReady();
  }

  executeCommand(cmd: string, args: string[]): void {
    this.impl.executeCommand(cmd, args);
  }

  triggerMacro(macro: string, args: string[], entityId?: number): void {
    this.impl.triggerMacro(macro, args, entityId);
  }

  /** @see EngineBridgeImpl.onCommand */
  onCommand<T extends GameCommand['type']>(
    commandType: T,
    handler: (command: Extract<GameCommand, { type: T }>) => void,
  ): () => void {
    return this.impl.onCommand(commandType, handler);
  }

  /** @see EngineBridgeImpl.setReady */
  setReady(value: boolean): void {
    this.impl.setReady(value);
  }

  /** @see EngineBridgeImpl.setSnapshotHandler */
  setSnapshotHandler(handler: () => Promise<string>): void {
    this.impl.setSnapshotHandler(handler);
  }

  /** @see EngineBridgeImpl.setRestoreHandler */
  setRestoreHandler(handler: (snapshot: string) => Promise<void>): void {
    this.impl.setRestoreHandler(handler);
  }

  /** @inheritdoc */
  async createSnapshot(): Promise<string> {
    return this.impl.createSnapshot();
  }

  /** @inheritdoc */
  async restoreSnapshot(snapshot: string): Promise<void> {
    return this.impl.restoreSnapshot(snapshot);
  }

  /** @see EngineBridgeImpl.reset */
  reset(): void {
    this.impl.reset();
  }

  /** Returns the number of registered event listeners. */
  listenerCount(): number {
    return (this.impl as unknown as { listeners: Map<number, unknown> }).listeners.size;
  }
}

export { createEngineBridge };
