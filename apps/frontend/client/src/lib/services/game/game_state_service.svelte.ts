// apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  ActiveSessionData,
  EquipmentSlot,
  GameCharacterSheet,
  NarrativeTraits,
  WorldEvent,
  WorldGenOutput,
  WorldLocation,
  WorldState,
} from '@aikami/types';
import { createDefaultSheet, serializeForAi } from '@aikami/utils';
import type { ActiveContextEntry, GameMode, GameStateEvent, GameStateListener } from '$types';
import { registerSerializable } from './serializable_service';

// C-314: ITEM_CATALOG and getItemDefinition moved to inventory_service.svelte.ts

import { getItemDefinition } from './inventory_service.svelte';

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
  /**
   * Spawn point IDs of defeated enemies.
   * Used to filter enemies out during map load so they don't respawn.
   *
   * Contract: C-147 Progression & Persistence
   */
  readonly defeatedEnemies: readonly string[];
  /**
   * Player's current gold balance.
   * Earned from quests, loot, and trading. Spent at vendors.
   *
   * Contract: C-154 AI Vendors Economy
   */
  readonly gold: number;
  /** Narrative traits (likes, temptations, keys) for AI context injection (C-232). */
  readonly narrativeTraits: NarrativeTraits;
  /** Compact AI-ready summary of the character sheet (C-232). */
  readonly characterSheetSummary: string;

  // ── World Generation (C-233) ──

  /** Generated world output, or a minimal default for legacy saves. */
  readonly worldGenOutput: WorldGenOutput;

  /** Sets the generated world output after wizard completion. */
  setWorldGenOutput(output: WorldGenOutput): void;

  /** Adds the given amount to the player's gold balance. */
  addGold(options: { amount: number }): void;
  /**
   * Removes the given amount from the player's gold balance.
   * Throws if the player doesn't have enough gold.
   */
  removeGold(options: { amount: number }): void;

  // ── Player stats (C-153 Character Dashboard) ──

  /** Player's base character level (from ECS CombatStats). */
  readonly playerLevel: number;
  /** Current XP (from ECS CombatStats). */
  readonly playerXp: number;
  /** XP needed to reach the next level. */
  readonly playerXpToNext: number;
  /** Current HP (from ECS CombatStats + combat state updates). */
  readonly playerHp: number;
  /** Maximum HP (from ECS CombatStats). */
  readonly playerMaxHp: number;
  /** Base attack from leveling (before equipment bonuses). */
  readonly playerBaseAttack: number;
  /** Base defense from leveling (before equipment bonuses). */
  readonly playerBaseDefense: number;
  /** Total attack = base + equipped weapon bonus. */
  readonly playerTotalAttack: number;
  /** Total defense = base + equipped armor bonus. */
  readonly playerTotalDefense: number;

  // ── Equipment (C-153 Equipping) ──

  /** Item ID of the currently equipped weapon, or undefined if none. */
  readonly equippedWeapon: string | undefined;
  /** Item ID of the currently equipped armor, or undefined if none. */
  readonly equippedArmor: string | undefined;

  /**
   * Equips an item from the inventory into its designated slot.
   *
   * Moves the item from the inventory to the equipment slot and updates
   * total attack/defense accordingly. If an item is already in that slot,
   * it is unequipped first (returned to inventory).
   */
  equipItem(options: { itemId: string }): void;
  /**
   * Unequips the item in the given slot and returns it to the inventory.
   */
  unequipItem(options: { slot: EquipmentSlot }): void;

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

  /** Serializes world-gen state for save persistence. */
  serializeWorldGen(): WorldGenOutput | undefined;

  /** Hydrates world-gen state from a saved payload. */
  hydrateWorldGen(data: WorldGenOutput | undefined): void;

  /**
   * Resets all mutable game state arrays (inventory, defeatedEnemies, quests,
   * equipment, player stats).
   *
   * Called when starting a New Game to prevent stale state from a previous
   * or aborted play session from leaking into the new session.
   */
  reset(): void;
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
  /** Spawn point IDs of defeated enemies (C-147). */
  defeatedEnemies = $state<string[]>([]);

  // ── Economy (C-154 AI Vendors Economy) ──
  gold = $state<number>(100);

  // ── Player stats (C-153 Character Dashboard) ──
  playerLevel = $state<number>(1);
  playerXp = $state<number>(0);
  playerXpToNext = $state<number>(100);
  playerHp = $state<number>(100);
  playerMaxHp = $state<number>(100);
  playerBaseAttack = $state<number>(5);
  playerBaseDefense = $state<number>(12);

  // ── Equipment slots (C-153 Equipping) ──
  equippedWeapon = $state<string | undefined>(undefined);
  equippedArmor = $state<string | undefined>(undefined);

  // ── Narrative traits (C-232 Character Sheet) ──
  narrativeTraits = $state<NarrativeTraits>({ likes: [], temptations: [], keys: [] });

  // ── World Generation (C-233) ──
  _worldGenOutput = $state<WorldGenOutput | undefined>(undefined);

  // ── Computed stat getters ──

  /** Total attack = base + weapon bonus. */
  get playerTotalAttack(): number {
    return this.playerBaseAttack + this._equipmentAttackBonus;
  }

  /** Total defense = base + armor bonus. */
  get playerTotalDefense(): number {
    return this.playerBaseDefense + this._equipmentDefenseBonus;
  }

  /** Compact AI-ready character sheet summary for prompt injection (C-232). */
  get characterSheetSummary(): string {
    const sheet: GameCharacterSheet = {
      ...createDefaultSheet(),
      level: this.playerLevel,
      xp: this.playerXp,
      hp: this.playerHp,
      maxHp: this.playerMaxHp,
      attack: this.playerTotalAttack,
      defense: this.playerTotalDefense,
      narrativeTraits: this.narrativeTraits,
    };
    return serializeForAi(sheet);
  }

  /** Attack bonus from currently equipped weapon. */
  private get _equipmentAttackBonus(): number {
    if (!this.equippedWeapon) {
      return 0;
    }
    return getItemDefinition(this.equippedWeapon).attackBonus;
  }

  /** Defense bonus from currently equipped armor. */
  private get _equipmentDefenseBonus(): number {
    if (!this.equippedArmor) {
      return 0;
    }
    return getItemDefinition(this.equippedArmor).defenseBonus;
  }

  get worldVariables(): Record<string, unknown> {
    return this.currentWorld?.variables ?? {};
  }

  /** @inheritdoc */
  get worldGenOutput(): WorldGenOutput {
    return this._worldGenOutput ?? this._getDefaultWorldGenOutput();
  }

  /** @inheritdoc */
  setWorldGenOutput(output: WorldGenOutput): void {
    this._worldGenOutput = output;
    this.debug('setWorldGenOutput', { worldName: output.worldName });
  }

  get isConnected(): boolean {
    return this.currentWorld !== undefined;
  }

  /**
   * Returns a minimal default WorldGenOutput for backward compatibility
   * with pre-wizard saves.
   */
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

  private readonly uid: string;
  private readonly listeners: Set<GameStateListener> = new Set();
  private unsubscribeWorld: (() => void) | undefined;

  constructor(options: GameStateServiceOptions) {
    super(options);
    this.uid = options.uid;

    // Register for save/load serialization (C-233)
    registerSerializable('gameState', {
      serialize: () => ({ worldGenOutput: this._worldGenOutput }),
      hydrate: (data: unknown) => {
        const payload = data as { worldGenOutput?: WorldGenOutput };
        if (payload.worldGenOutput) {
          this._worldGenOutput = payload.worldGenOutput;
        }
      },
    });

    void this._listenForQuestUpdates();
    void this._listenForCombatEnded();
    void this._listenForPlayerStats();
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

  /** @inheritdoc */
  reset(): void {
    this.inventory = [];
    this.defeatedEnemies = [];
    this.quests = [];
    this.equippedWeapon = undefined;
    this.equippedArmor = undefined;
    this.gold = 100;
    this.playerLevel = 1;
    this.playerXp = 0;
    this.playerXpToNext = 100;
    this.playerHp = 100;
    this.playerMaxHp = 100;
    this.playerBaseAttack = 5;
    this.playerBaseDefense = 12;
    this._worldGenOutput = undefined;
    this.debug('reset:cleared');
  }

  // ── Gold methods (C-154) ──

  /** @inheritdoc */
  addGold(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      this.debug('addGold:non-positive', { amount });
      return;
    }
    this.gold += amount;
    this.debug('addGold', { amount, newBalance: this.gold });
  }

  /** @inheritdoc */
  removeGold(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      this.debug('removeGold:non-positive', { amount });
      return;
    }
    if (this.gold < amount) {
      throw new Error(`Insufficient gold: have ${this.gold}, need ${amount}`);
    }
    this.gold -= amount;
    this.debug('removeGold', { amount, newBalance: this.gold });
  }

  // ── Equipment methods (C-153) ──

  /** @inheritdoc */
  equipItem(options: { itemId: string }): void {
    const { itemId } = options;
    const definition = getItemDefinition(itemId);

    if (!definition.equippable || !definition.slot) {
      this.debug('equipItem:not-equippable', { itemId });
      return;
    }

    // Find the item in inventory
    const index = this.inventory.findIndex((item) => item.itemId === itemId);
    if (index < 0) {
      this.debug('equipItem:not-in-inventory', { itemId });
      return;
    }

    const slot = definition.slot;

    // If there's already an item in this slot, unequip it first
    if (slot === 'weapon' && this.equippedWeapon) {
      this._unequipCurrent(slot);
    } else if (slot === 'armor' && this.equippedArmor) {
      this._unequipCurrent(slot);
    }

    // Remove from inventory (reduce quantity or remove entirely)
    const item = this.inventory[index];
    if (item.quantity > 1) {
      this.inventory[index] = { itemId, quantity: item.quantity - 1 };
    } else {
      this.inventory = this.inventory.filter((_, i) => i !== index);
    }

    // Equip into slot
    if (slot === 'weapon') {
      this.equippedWeapon = itemId;
    } else {
      this.equippedArmor = itemId;
    }

    this.debug('equipItem:equipped', { itemId, slot });
  }

  /** @inheritdoc */
  unequipItem(options: { slot: EquipmentSlot }): void {
    const { slot } = options;
    this._unequipCurrent(slot);
  }

  /**
   * Moves the currently equipped item in the given slot back to inventory.
   */
  private _unequipCurrent(slot: EquipmentSlot): void {
    const itemId = slot === 'weapon' ? this.equippedWeapon : this.equippedArmor;
    if (!itemId) {
      return;
    }

    // Return to inventory (stack if existing, otherwise new entry)
    const existingIndex = this.inventory.findIndex((item) => item.itemId === itemId);
    if (existingIndex >= 0) {
      this.inventory[existingIndex] = {
        itemId,
        quantity: this.inventory[existingIndex].quantity + 1,
      };
    } else {
      this.inventory = [...this.inventory, { itemId, quantity: 1 }];
    }

    // Clear the slot
    if (slot === 'weapon') {
      this.equippedWeapon = undefined;
    } else {
      this.equippedArmor = undefined;
    }

    this.debug('_unequipCurrent', { itemId, slot });
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
   * Listens for COMBAT_ENDED events from the ECS via the EngineBridge.
   *
   * When a combat victory is registered with a `defeatedEnemyId`, this
   * method pushes the spawn point ID into the {@link defeatedEnemies} array
   * so the enemy is permanently removed during future map loads.
   *
   * Contract: C-147 Progression & Persistence
   */
  private async _listenForCombatEnded(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

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
      this.debug('_listenForCombatEnded:failed', { error: String(error) });
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

  /**
   * Listens for player stat events from the ECS via the EngineBridge.
   *
   * Tracks:
   * - {@link PLAYER_LEVELED_UP} — updates level, base attack, base defense,
   *   max HP, and XP threshold.
   * - {@link COMBAT_STATE_UPDATE} — updates current HP from the entity HP map.
   *
   * Contract: C-153 Character Dashboard & Equipment
   */
  private async _listenForPlayerStats(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('PLAYER_LEVELED_UP', (event) => {
        this.playerLevel = event.newLevel;
        this.playerMaxHp = event.maxHp;
        this.playerBaseAttack = event.attack;
        this.playerBaseDefense = event.defense;
        this.playerXpToNext = event.xpToNextLevel;
        this.debug('_listenForPlayerStats:leveledUp', {
          level: event.newLevel,
          attack: event.attack,
          defense: event.defense,
        });
      });

      bridge.on('COMBAT_STATE_UPDATE', (event) => {
        // Player entity is always entity ID 1 in our ECS
        const playerHp = event.entityHpMap[1];
        if (playerHp !== undefined) {
          this.playerHp = playerHp;
        }
      });
    } catch (error) {
      this.debug('_listenForPlayerStats:failed', { error: String(error) });
    }
  }
}

// C-314: Module-level singleton removed. Use the five split services instead:
// PlayerStateService, WorldStateService, InventoryService, EquipmentService, GameModeService
//
// The GameStateService class is retained for backward-compatible test imports.
// Production code should use the composition root or individual service singletons.
