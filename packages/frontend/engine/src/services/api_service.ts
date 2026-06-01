// apps/frontend/game/src/engine/services/api_service.ts

import type { GameApiClientInterface } from '@aikami/frontend/api-core';

/**
 * Data that the game engine needs about an NPC from the backend.
 */
export type NpcData = {
  id: string;
  name: string;
  description: string;
  dialog: string;
  textureKey: string;
  interactionRadius: number;
};

/**
 * A player action submitted to the backend for persistence.
 */
export type PlayerAction = {
  type: string;
  npcId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
};

/**
 * Result of submitting a player action.
 */
export type ActionResult = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

/**
 * Serialized game state for checkpoint save/load.
 */
export type GameState = {
  sceneId: string;
  playerPosition: { x: number; y: number };
  inventory: string[];
  completedQuests: string[];
  timestamp: number;
};

/**
 * Game-specific high-level API service.
 *
 * Wraps the generic {@link GameApiClientInterface} with methods that the
 * game engine systems call directly. Handles request formatting, error
 * mapping, and data transformation for game domain concepts.
 *
 * This service is optional — the game engine works in offline mode without it.
 */
class GameApiService {
  private client: GameApiClientInterface;

  /**
   * @param client - The underlying HTTP client.
   */
  constructor(client: GameApiClientInterface) {
    this.client = client;
  }

  /**
   * Fetches NPC data from the backend.
   *
   * @param npcId - Unique identifier for the NPC.
   * @returns NPC data including description, dialog, and texture key.
   */
  async fetchNpcData(npcId: string): Promise<NpcData> {
    return this.client.get<NpcData>(`/api/npc/${encodeURIComponent(npcId)}`);
  }

  /**
   * Submits a player action to the backend (quest progress, dialog choice, etc.).
   *
   * @param action - The action to submit.
   * @returns Result indicating success or failure.
   */
  async submitPlayerAction(action: PlayerAction): Promise<ActionResult> {
    return this.client.post<ActionResult, PlayerAction>('/api/game/action', action);
  }

  /**
   * Saves a game state checkpoint to the backend.
   *
   * @param state - The game state to persist.
   */
  async saveCheckpoint(state: GameState): Promise<void> {
    await this.client.post<void, GameState>('/api/game/checkpoint', state);
  }

  /**
   * Loads a game state checkpoint from the backend.
   *
   * @param slotId - Identifier for the save slot.
   * @returns The saved game state, or null if no save exists.
   */
  async loadCheckpoint(slotId: string): Promise<GameState | null> {
    try {
      return await this.client.get<GameState>(`/api/game/checkpoint/${encodeURIComponent(slotId)}`);
    } catch {
      return null;
    }
  }

  /**
   * Cleanup: releases any pending requests.
   */
  destroy(): void {
    // Currently a no-op — the GameApiClient handles its own lifecycle.
    // Future: abort pending requests on destroy.
  }
}

export { GameApiService };
