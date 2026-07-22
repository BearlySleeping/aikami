// apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts
//
// World state service (C-314) — owns world state, locations, NPCs, active contexts,
// world gen output, quests, and defeated enemies.
//
// Extracted from game_state_service (C-314 service split).

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  ActiveSessionData,
  InteractableStateEntry,
  WorldEvent,
  WorldGenOutput,
  WorldLocation,
  WorldPickupState,
  WorldState,
} from '@aikami/types';
import type { ActiveContextEntry, GameStateEvent, GameStateListener } from '$types';
import { registerSerializable, type SerializableService } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorldStateServiceOptions = BaseFrontendClassOptions & {
  uid: string;
};

export type WorldStateServiceInterface = BaseFrontendClassInterface & {
  readonly currentWorld: WorldState | undefined;
  readonly currentLocation: WorldLocation | undefined;
  readonly worldVariables: Record<string, unknown>;
  readonly isConnected: boolean;
  readonly activeContexts: readonly ActiveContextEntry[];
  readonly worldGenOutput: WorldGenOutput;
  readonly quests: readonly QuestData[];
  readonly defeatedEnemies: readonly string[];
  /** Spawn-point IDs of already-collected map items (C-331 AC-2). */
  readonly collectedPickups: readonly string[];
  /** Encounter IDs whose loot was already granted (C-331 AC-5). */
  readonly lootGrantedEncounters: readonly string[];
  /** Per-spawnId interactable state for persistence (C-342). */
  readonly interactableStates: Record<string, InteractableStateEntry>;

  /** Returns the saved state for a given spawn ID, or undefined if not saved. */
  getInteractableState(spawnId: string): InteractableStateEntry | undefined;

  /** Updates the saved state for a given spawn ID (merges partial state). */
  markInteractableState(spawnId: string, changes: Partial<InteractableStateEntry>): void;

  /** Returns true when the given item spawn point was already collected. */
  isPickupCollected(spawnId: string): boolean;

  /** Records an item spawn point as collected (idempotent). */
  recordCollectedPickup(spawnId: string): void;

  /** Returns true when the given encounter's loot was already granted. */
  isLootGranted(encounterId: string): boolean;

  /** Records an encounter's loot as granted (idempotent). */
  recordLootGranted(encounterId: string): void;

  /** Serializes world persistence flags for the save envelope (C-331, C-342). */
  serialize(): WorldPickupState & { defeatedEnemies: string[] };

  /** Restores world persistence flags from a save envelope snapshot. */
  hydrate(
    data: WorldPickupState & {
      defeatedEnemies?: string[];
      interactableStates?: Record<string, InteractableStateEntry>;
    },
  ): void;

  subscribeToWorld(worldId: string): Promise<void>;
  unsubscribeFromWorld(): void;
  addLocation(location: { name: string; description?: string }): void;
  updateLocation(locationId: string): Promise<void>;
  setVariable(key: string, value: unknown): Promise<void>;
  addNpc(npcId: string): Promise<void>;
  removeNpc(npcId: string): Promise<void>;
  recordEvent(options: {
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

  setWorldGenOutput(output: WorldGenOutput): void;
  serializeWorldGen(): WorldGenOutput | undefined;
  hydrateWorldGen(data: WorldGenOutput | undefined): void;

  /** Starts ECS bridge listeners for quests and combat progression. */
  startListening(): Promise<void>;

  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class WorldStateService
  extends BaseFrontendClass<WorldStateServiceOptions>
  implements WorldStateServiceInterface
{
  currentWorld = $state<WorldState | undefined>(undefined);
  currentLocation = $state<WorldLocation | undefined>(undefined);
  activeSession = $state<ActiveSessionData | undefined>(undefined);
  activeContexts = $state<ActiveContextEntry[]>([]);
  quests = $state<QuestData[]>([]);
  defeatedEnemies = $state<string[]>([]);
  collectedPickups = $state<string[]>([]);
  lootGrantedEncounters = $state<string[]>([]);
  interactableStates: Record<string, InteractableStateEntry> = $state({});

  private _worldGenOutput = $state<WorldGenOutput | undefined>(undefined);

  private readonly _uid: string;
  private readonly _listeners: Set<GameStateListener> = new Set();
  private _unsubscribeWorld: (() => void) | undefined;
  private _listening = false;

  constructor(options: WorldStateServiceOptions) {
    super(options);
    this._uid = options.uid;
  }

  // ── World generation ──

  /** @inheritdoc */
  get worldGenOutput(): WorldGenOutput {
    return this._worldGenOutput ?? this._getDefaultWorldGenOutput();
  }

  /** @inheritdoc */
  setWorldGenOutput(output: WorldGenOutput): void {
    this._worldGenOutput = output;
    this.debug('setWorldGenOutput', { worldName: output.worldName });
  }

  /** @inheritdoc */
  serializeWorldGen(): WorldGenOutput | undefined {
    return this._worldGenOutput;
  }

  /** @inheritdoc */
  hydrateWorldGen(data: WorldGenOutput | undefined): void {
    if (data) {
      this._worldGenOutput = data;
      this.debug('hydrateWorldGen', { worldName: data.worldName });
    }
  }

  private _getDefaultWorldGenOutput(): WorldGenOutput {
    return {
      worldName: 'The Realm',
      worldDescription: 'A world of adventure awaits.',
      npcs: [],
      locations: ['Town Square'],
      partyArcs: [],
      hudWidgets: [],
    };
  }

  get worldVariables(): Record<string, unknown> {
    return this.currentWorld?.variables ?? {};
  }

  get isConnected(): boolean {
    return this.currentWorld !== undefined;
  }

  // ── Events ──

  private _emitEvent(event: GameStateEvent): void {
    for (const listener of this._listeners) {
      listener(event);
    }
  }

  // ── World subscription ──

  async subscribeToWorld(worldId: string): Promise<void> {
    this.currentWorld = {
      id: worldId,
      uid: this._uid,
      name: 'New World',
      description: '',
      locations: [],
      events: [],
      variables: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._unsubscribeWorld = () => {
      this.currentWorld = undefined;
      this.currentLocation = undefined;
    };

    this._emitEvent({
      type: 'location_changed',
      payload: { worldId },
      timestamp: new Date().toISOString(),
    });
  }

  unsubscribeFromWorld(): void {
    if (this._unsubscribeWorld) {
      this._unsubscribeWorld();
      this._unsubscribeWorld = undefined;
    }
  }

  /**
   * Creates a new location in the current world and sets it as active.
   * The first location added also becomes the initial currentLocation
   * so NPCs can be attached immediately.
   */
  addLocation(location: { name: string; description?: string }): void {
    const world = this.currentWorld;
    if (!world) {
      throw new Error('No world loaded');
    }

    const newLocation: WorldLocation = {
      id: crypto.randomUUID(),
      name: location.name,
      description: location.description ?? '',
      connections: [],
      npcIds: [],
    };

    this.currentWorld = {
      ...world,
      locations: [...world.locations, newLocation],
      updatedAt: new Date().toISOString(),
    };

    // Auto-select first location as current so NPC seeding works immediately
    if (!this.currentLocation) {
      this.currentLocation = newLocation;
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

    this._emitEvent({
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

    this._emitEvent({
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

      this._emitEvent({
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

    this._emitEvent({
      type: 'npc_removed',
      payload: { npcId, locationId: location.id },
      timestamp: new Date().toISOString(),
    });
  }

  async recordEvent(options: {
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
      title: options.title,
      description: options.description,
      participantIds: options.participantIds ?? [],
      locationId: options.locationId,
      timestamp: new Date().toISOString(),
      isMajor: options.isMajor,
    };

    this.currentWorld = {
      ...world,
      events: [...world.events, newEvent],
      updatedAt: new Date().toISOString(),
    };

    this._emitEvent({
      type: 'event_triggered',
      payload: newEvent,
      timestamp: new Date().toISOString(),
    });
  }

  addEventListener(listener: GameStateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
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

  // ── Sessions ──

  async createSession(characterIds: string[]): Promise<ActiveSessionData> {
    const session: ActiveSessionData = {
      id: crypto.randomUUID(),
      worldId: this.currentWorld?.id ?? '',
      uid: this._uid,
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

      this._emitEvent({
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

  // ── Pickup / loot persistence (C-331) ──

  /** @inheritdoc */
  isPickupCollected(spawnId: string): boolean {
    return this.collectedPickups.includes(spawnId);
  }

  /** @inheritdoc */
  recordCollectedPickup(spawnId: string): void {
    if (!spawnId || this.collectedPickups.includes(spawnId)) {
      return;
    }
    this.collectedPickups = [...this.collectedPickups, spawnId];
    this.debug('recordCollectedPickup', { spawnId });
  }

  /** @inheritdoc */
  isLootGranted(encounterId: string): boolean {
    return this.lootGrantedEncounters.includes(encounterId);
  }

  /** @inheritdoc */
  recordLootGranted(encounterId: string): void {
    if (!encounterId || this.lootGrantedEncounters.includes(encounterId)) {
      return;
    }
    this.lootGrantedEncounters = [...this.lootGrantedEncounters, encounterId];
    this.debug('recordLootGranted', { encounterId });
  }

  /** @inheritdoc */
  getInteractableState(spawnId: string): InteractableStateEntry | undefined {
    return this.interactableStates[spawnId];
  }

  /** @inheritdoc */
  markInteractableState(spawnId: string, changes: Partial<InteractableStateEntry>): void {
    const current = this.interactableStates[spawnId] ?? {};
    this.interactableStates = {
      ...this.interactableStates,
      [spawnId]: { ...current, ...changes },
    };
    this.debug('markInteractableState', { spawnId, changes });
  }

  /** @inheritdoc */
  serialize(): WorldPickupState & { defeatedEnemies: string[] } {
    return {
      defeatedEnemies: [...this.defeatedEnemies],
      collectedPickups: [...this.collectedPickups],
      lootGrantedEncounters: [...this.lootGrantedEncounters],
      interactableStates: { ...this.interactableStates },
    };
  }

  /** @inheritdoc */
  hydrate(data: WorldPickupState & { defeatedEnemies?: string[] }): void {
    if (!data) {
      return;
    }
    this.defeatedEnemies = [...(data.defeatedEnemies ?? [])];
    this.collectedPickups = [...(data.collectedPickups ?? [])];
    this.lootGrantedEncounters = [...(data.lootGrantedEncounters ?? [])];
    this.interactableStates = { ...(data.interactableStates ?? {}) };
    this.debug('hydrate', {
      defeated: this.defeatedEnemies.length,
      collected: this.collectedPickups.length,
      lootGranted: this.lootGrantedEncounters.length,
      interactableStates: Object.keys(this.interactableStates).length,
    });
  }

  /** @inheritdoc */
  reset(): void {
    this.quests = [];
    this.defeatedEnemies = [];
    this.collectedPickups = [];
    this.lootGrantedEncounters = [];
    this.interactableStates = {};
    this._worldGenOutput = undefined;
    this.debug('reset:cleared');
  }

  // ── ECS bridge listeners ──

  /**
   * Starts listening for QUESTS_UPDATED and COMBAT_ENDED events from the ECS
   * via the EngineBridge. Idempotent.
   */
  async startListening(): Promise<void> {
    if (this._listening) {
      return;
    }
    this._listening = true;

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('QUESTS_UPDATED', (event) => {
        this.quests = event.quests;
      });

      bridge.on('COMBAT_ENDED', (event) => {
        if (
          event.victory &&
          event.defeatedEnemyId &&
          !this.defeatedEnemies.includes(event.defeatedEnemyId)
        ) {
          this.defeatedEnemies = [...this.defeatedEnemies, event.defeatedEnemyId];
        }
      });
    } catch (error) {
      this.debug('startListening:failed', { error: String(error) });
    }
  }
}

export const worldStateService: WorldStateServiceInterface = WorldStateService.create({
  uid: 'singleton',
  className: 'WorldStateService',
});

// Register world pickup/loot/defeated-enemy flags for save/load (C-331 AC-2/AC-5)
registerSerializable('worldState', worldStateService as unknown as SerializableService<unknown>);
