// apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ActiveSessionData, WorldEvent, WorldLocation, WorldState } from '@aikami/types';
import type {
  ActiveContextEntry,
  GameMode,
  GameStateEvent,
  GameStateListener,
} from '$types/game.ts';

export type GameStateServiceOptions = BaseFrontendClassOptions & {
  uid: string;
};

export type GameStateServiceInterface = BaseFrontendClassInterface & {
  readonly currentWorld: WorldState | undefined;
  readonly currentLocation: WorldLocation | undefined;
  readonly worldVariables: Record<string, unknown>;
  readonly isConnected: boolean;
  readonly activeContexts: readonly ActiveContextEntry[];
  readonly currentMode: GameMode;
  inventory: Array<{ itemId: string; quantity: number }>;
  /** Quest data synced from the ECS engine via QUESTS_UPDATED events. */
  readonly quests: readonly QuestData[];

  subscribeToWorld(worldId: string): Promise<void>;
  unsubscribeFromWorld(): void;
  updateLocation(locationId: string): Promise<void>;
  setVariable(key: string, value: unknown): Promise<void>;
  addNpc(npcId: string): Promise<void>;
  removeNpc(npcId: string): Promise<void>;
  recordEvent(event: {
    title: string;
    description: string;
    participantIds?: string[];
    locationId?: string;
    isMajor: boolean;
  }): Promise<void>;
  addEventListener(listener: GameStateListener): () => void;
  addActiveContext(entry: ActiveContextEntry): void;
  removeActiveContext(entityId: string): void;
  createSession(characterIds: string[]): Promise<ActiveSessionData>;
  endSession(): Promise<void>;
  getActiveSession(): ActiveSessionData | undefined;
  setMode(mode: GameMode): void;
};

export class GameStateService
  extends BaseFrontendClass<GameStateServiceOptions>
  implements GameStateServiceInterface
{
  currentWorld = $state<WorldState | undefined>(undefined);
  currentLocation = $state<WorldLocation | undefined>(undefined);
  activeSession = $state<ActiveSessionData | undefined>(undefined);
  activeContexts = $state<ActiveContextEntry[]>([]);
  currentMode = $state<GameMode>('EXPLORE');
  inventory = $state<Array<{ itemId: string; quantity: number }>>([]);
  quests = $state<QuestData[]>([]);

  get worldVariables(): Record<string, unknown> {
    return this.currentWorld?.variables ?? {};
  }

  get isConnected(): boolean {
    return this.currentWorld !== undefined;
  }

  private readonly uid: string;
  private readonly listeners: Set<GameStateListener> = new Set();
  private unsubscribeWorld: (() => void) | undefined;

  constructor(options: GameStateServiceOptions) {
    super(options);
    this.uid = options.uid;
    void this._listenForInventoryUpdates();
    void this._listenForQuestUpdates();
  }

  private emitEvent(event: GameStateEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async subscribeToWorld(worldId: string): Promise<void> {
    this.currentWorld = {
      id: worldId,
      uid: this.uid,
      name: 'New World',
      description: '',
      locations: [],
      events: [],
      variables: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.unsubscribeWorld = () => {
      this.currentWorld = undefined;
      this.currentLocation = undefined;
    };

    this.emitEvent({
      type: 'location_changed',
      payload: { worldId },
      timestamp: new Date().toISOString(),
    });
  }

  unsubscribeFromWorld(): void {
    if (this.unsubscribeWorld) {
      this.unsubscribeWorld();
      this.unsubscribeWorld = undefined;
    }
  }

  async updateLocation(locationId: string): Promise<void> {
    const world = this.currentWorld;
    if (!world) {
      throw new Error('No world loaded');
    }

    const location = world.locations.find((l: WorldLocation) => l.id === locationId);
    if (!location) {
      throw new Error(`Location not found: ${locationId}`);
    }

    const updated = { ...location, lastVisited: new Date().toISOString() };
    this.currentLocation = updated;
    this.currentWorld = {
      ...world,
      updatedAt: new Date().toISOString(),
      locations: world.locations.map((l: WorldLocation) => (l.id === locationId ? updated : l)),
    };

    this.emitEvent({
      type: 'location_changed',
      payload: { locationId, location: updated },
      timestamp: new Date().toISOString(),
    });
  }

  async setVariable(key: string, value: unknown): Promise<void> {
    const world = this.currentWorld;
    if (!world) {
      throw new Error('No world loaded');
    }

    this.currentWorld = {
      ...world,
      variables: { ...world.variables, [key]: value },
      updatedAt: new Date().toISOString(),
    };

    this.emitEvent({
      type: 'variable_updated',
      payload: { key, value },
      timestamp: new Date().toISOString(),
    });
  }

  async addNpc(npcId: string): Promise<void> {
    const location = this.currentLocation;
    if (!location) {
      throw new Error('No location loaded');
    }

    if (!location.npcIds.includes(npcId)) {
      this.currentLocation = {
        ...location,
        npcIds: [...location.npcIds, npcId],
      };

      this.emitEvent({
        type: 'npc_added',
        payload: { npcId, locationId: location.id },
        timestamp: new Date().toISOString(),
      });
    }
  }

  async removeNpc(npcId: string): Promise<void> {
    const location = this.currentLocation;
    if (!location) {
      throw new Error('No location loaded');
    }

    this.currentLocation = {
      ...location,
      npcIds: location.npcIds.filter((id: string) => id !== npcId),
    };

    this.emitEvent({
      type: 'npc_removed',
      payload: { npcId, locationId: location.id },
      timestamp: new Date().toISOString(),
    });
  }

  async recordEvent(event: {
    title: string;
    description: string;
    participantIds?: string[];
    locationId?: string;
    isMajor: boolean;
  }): Promise<void> {
    const world = this.currentWorld;
    if (!world) {
      throw new Error('No world loaded');
    }

    const newEvent: WorldEvent = {
      id: crypto.randomUUID(),
      title: event.title,
      description: event.description,
      participantIds: event.participantIds ?? [],
      locationId: event.locationId,
      timestamp: new Date().toISOString(),
      isMajor: event.isMajor,
    };

    this.currentWorld = {
      ...world,
      events: [...world.events, newEvent],
      updatedAt: new Date().toISOString(),
    };

    this.emitEvent({
      type: 'event_triggered',
      payload: newEvent,
      timestamp: new Date().toISOString(),
    });
  }

  addEventListener(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addActiveContext(entry: ActiveContextEntry): void {
    const existingIdx = this.activeContexts.findIndex((e) => e.entityId === entry.entityId);
    if (existingIdx >= 0) {
      this.activeContexts[existingIdx] = entry;
    } else {
      this.activeContexts = [...this.activeContexts, entry];
    }
  }

  removeActiveContext(entityId: string): void {
    this.activeContexts = this.activeContexts.filter((e) => e.entityId !== entityId);
  }

  async createSession(characterIds: string[]): Promise<ActiveSessionData> {
    const session: ActiveSessionData = {
      id: crypto.randomUUID(),
      worldId: this.currentWorld?.id ?? '',
      uid: this.uid,
      characterIds,
      npcIds: [],
      startedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isActive: true,
    };

    this.activeSession = session;
    return session;
  }

  async endSession(): Promise<void> {
    if (this.activeSession) {
      this.activeSession = {
        ...this.activeSession,
        isActive: false,
        lastActiveAt: new Date().toISOString(),
      };

      this.emitEvent({
        type: 'session_ended',
        payload: { sessionId: this.activeSession.id },
        timestamp: new Date().toISOString(),
      });
    }

    this.unsubscribeFromWorld();
  }

  getActiveSession(): ActiveSessionData | undefined {
    return this.activeSession;
  }

  /**
   * Sets the current game mode and broadcasts the change to the ECS worker
   * via the EngineBridge.
   *
   * The worker uses this to gate movement (only EXPLORE allows player movement).
   * The UI uses this to toggle overlay visibility (DIALOGUE → dialogue overlay).
   */
  setMode(mode: GameMode): void {
    if (this.currentMode === mode) {
      return;
    }

    this.currentMode = mode;

    // Broadcast to the ECS worker via the EngineBridge so the movement
    // system can gate player input.
    void this._broadcastModeToEngine(mode);
  }

  /**
   * Lazily imports the EngineBridge singleton and sends a SET_GAME_MODE
   * command to the ECS worker.
   */
  private async _broadcastModeToEngine(mode: GameMode): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();
      bridge.send({ type: 'SET_GAME_MODE' as never, mode } as never);
    } catch (error) {
      this.debug('_broadcastModeToEngine:failed', { mode, error: String(error) });
    }
  }

  /**
   * Listens for INVENTORY_UPDATED events from the ECS via the EngineBridge.
   *
   * When the player picks up or drops an item, the ECS emits the full
   * inventory array. This method updates the reactive `inventory` state
   * so the Inventory UI overlay renders the latest contents.
   */
  private async _listenForInventoryUpdates(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('INVENTORY_UPDATED', (event) => {
        this.inventory = event.inventory;
      });
    } catch (error) {
      this.debug('_listenForInventoryUpdates:failed', { error: String(error) });
    }
  }

  /**
   * Listens for QUESTS_UPDATED events from the ECS via the EngineBridge.
   *
   * When quests are added, progressed, or completed in the ECS, the engine
   * emits the full quest list. This method updates the reactive `quests`
   * state so the Quest Log UI overlay renders the latest quest data.
   *
   * Contract: C-143 Quest Log Sync
   */
  private async _listenForQuestUpdates(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('QUESTS_UPDATED', (event) => {
        this.quests = event.quests;
      });
    } catch (error) {
      this.debug('_listenForQuestUpdates:failed', { error: String(error) });
    }
  }
}

export const gameStateService: GameStateServiceInterface = GameStateService.create({
  uid: 'singleton',
  className: 'GameStateService',
});
