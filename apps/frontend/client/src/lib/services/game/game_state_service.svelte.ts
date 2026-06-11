// apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ActiveSessionData, WorldEvent, WorldLocation, WorldState } from '@aikami/types';
import type { ActiveContextEntry, GameStateEvent, GameStateListener } from '$types/game.ts';

export type GameStateServiceOptions = BaseFrontendClassOptions & {
  uid: string;
};

export type GameStateServiceInterface = BaseFrontendClassInterface & {
  readonly currentWorld: WorldState | undefined;
  readonly currentLocation: WorldLocation | undefined;
  readonly worldVariables: Record<string, unknown>;
  readonly isConnected: boolean;
  readonly activeContexts: readonly ActiveContextEntry[];

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
};

export class GameStateService
  extends BaseFrontendClass<GameStateServiceOptions>
  implements GameStateServiceInterface
{
  currentWorld = $state<WorldState | undefined>(undefined);
  currentLocation = $state<WorldLocation | undefined>(undefined);
  activeSession = $state<ActiveSessionData | undefined>(undefined);
  activeContexts = $state<ActiveContextEntry[]>([]);

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
}

export const gameStateService: GameStateServiceInterface = GameStateService.create({
  uid: 'singleton',
  className: 'GameStateService',
});
