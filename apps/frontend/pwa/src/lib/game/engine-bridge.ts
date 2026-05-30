// apps/frontend/pwa/src/lib/game/engine-bridge.ts
import type { GameCommand, GameEvent } from './types.ts';

// ---------------------------------------------------------------------------
// EngineBridge — typed bidirectional message channel
// ---------------------------------------------------------------------------

/**
 * The sole communication boundary between the SvelteKit UI layer and the
 * PixiJS v8 + bitECS game engine.
 *
 * **UI → Game**: call {@link EngineBridge.send} with a {@link GameCommand}.
 * **Game → UI**: game systems call {@link EngineBridge.emit} with a
 *   {@link GameEvent}; ViewModels listen via {@link EngineBridge.on}.
 *
 * This interface is the OOP contract that both the real bridge and the test
 * mock must satisfy. All payloads crossing the bridge are plain serializable
 * objects — NO PixiJS objects, NO bitECS handles, NO class instances.
 */
export interface EngineBridge {
  /**
   * Sends a command from the Svelte UI layer to the game engine.
   *
   * Called exclusively by ViewModels. The game engine processes commands
   * asynchronously — do NOT assume synchronous side effects.
   */
  send(command: GameCommand): void;

  /**
   * Registers a listener for game events of a specific type.
   *
   * Called by ViewModels to react to world-state changes. Returns an
   * unsubscribe function. Handlers must not perform synchronous heavy work
   * (offload via `requestIdleCallback` if needed).
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
   * Emits an event from the game engine to the Svelte UI layer.
   *
   * Called exclusively by game systems (movement, dialog trigger, scene
   * loader). NEVER called from ViewModels or Svelte components.
   */
  emit(event: GameEvent): void;

  /**
   * Returns `true` when the game engine (PixiJS + bitECS) is fully
   * initialized and the game loop is running.
   */
  isReady(): boolean;
}

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

  // ---- Internal methods (NOT part of EngineBridge interface) ----------

  /**
   * Registers a command handler on the game-engine side.
   *
   * Called by the GameWorld during initialization so systems can receive
   * UI commands. NOT part of the public EngineBridge interface — only
   * the GameWorld uses this internally.
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
    this.ready = false;
  }
}

// ===========================================================================
// Singleton factory
// ===========================================================================

let instance: EngineBridgeImpl | undefined;

/**
 * Returns the singleton {@link EngineBridge} instance.
 *
 * Lazily creates the underlying implementation on first call. Use this
 * factory instead of constructing the implementation directly — it
 * guarantees only ONE bridge exists per page lifetime.
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
 *
 * Uses the same internals as {@link EngineBridgeImpl} but exposes extra
 * methods (`setReady`, `onCommand`, `reset`, `listenerCount`) so tests can
 * inspect state without touching the production API surface.
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

  /** @see EngineBridgeImpl.reset */
  reset(): void {
    this.impl.reset();
  }

  /** Returns the number of registered event listeners. */
  listenerCount(): number {
    // Access private field via cast — acceptable in test double
    return (this.impl as unknown as { listeners: Map<number, unknown> }).listeners.size;
  }
}

export { createEngineBridge };
