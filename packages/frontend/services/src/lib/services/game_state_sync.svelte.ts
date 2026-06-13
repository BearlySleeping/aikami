// packages/frontend/services/src/lib/services/game_state_sync.svelte.ts

import {
  dataConnect,
  listSaveSlots,
  type UpsertSaveSlotVariables,
  upsertSaveSlot,
} from '@aikami/frontend/dataconnect';
import { validateEcsSnapshot } from '@aikami/schemas';
import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import { firebaseStorageService } from '../firebase/firebase_storage.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata stored alongside the ECS blob in the SaveSlot row.
 */
export type SaveSlotMetadata = {
  /** Human-readable location name for the save thumbnail. */
  lastLocationName?: string;
  /** Accumulated play time in seconds. */
  playedTimeSeconds?: number;
};

/**
 * A hydrated save slot with its metadata and optional blob payload.
 */
export type SaveSlotEntry = {
  slotNumber: number;
  lastLocationName?: string | null;
  playedTimeSeconds?: number | null;
  storageRef: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type GameStateSyncServiceInterface = BaseClassInterface & {
  /**
   * Saves a game state (ECS snapshot) to Firebase Storage and updates the
   * SaveSlot metadata row via Data Connect.
   *
   * @returns The storage reference path where the blob was saved.
   */
  saveGame(options: {
    uid: string;
    slot: number;
    payload: string;
    metadata?: SaveSlotMetadata;
  }): Promise<string>;

  /**
   * Loads a game state from Firebase Storage for a given save slot.
   *
   * @returns The ECS snapshot string, or `undefined` if the blob doesn't exist.
   */
  loadGame(options: { uid: string; slot: number }): Promise<string | undefined>;

  /**
   * Lists all save slots for a user via Data Connect.
   *
   * @returns Array of save slot metadata entries, ordered by slot number.
   */
  listSlots(options: { uid: string }): Promise<SaveSlotEntry[]>;

  /**
   * Deletes a save slot's blob from Storage and its metadata row via Data Connect.
   * (Future: implement Data Connect delete mutation.)
   */
  deleteSlot(options: { uid: string; slot: number }): Promise<void>;
};

export type GameStateSyncServiceOptions = Record<string, never>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class GameStateSyncService extends BaseClass implements GameStateSyncServiceInterface {
  /**
   * Saves the ECS snapshot payload to Storage and upserts the SaveSlot row.
   */
  async saveGame(options: {
    uid: string;
    slot: number;
    payload: string;
    metadata?: SaveSlotMetadata;
  }): Promise<string> {
    const { uid, slot, payload, metadata } = options;

    // Validate payload shape and version before uploading.
    const validationError = validateEcsSnapshot(payload);
    if (validationError) {
      throw new Error(`saveGame: ${validationError}`);
    }

    const storageRef = `saves/${uid}/slot_${slot}.json`;

    // 1. Upload ECS snapshot blob to Firebase Cloud Storage
    await firebaseStorageService.uploadString(storageRef, payload);

    // 2. Upsert SaveSlot metadata row via Data Connect
    const vars: UpsertSaveSlotVariables = {
      id: `${uid}_${slot}`,
      uid,
      slotNumber: slot,
      lastLocationName: metadata?.lastLocationName,
      playedTimeSeconds: metadata?.playedTimeSeconds,
      storageRef,
    };
    await upsertSaveSlot(dataConnect, vars);

    this.log(`saveGame: saved slot ${slot} for user ${uid} to ${storageRef}`);
    return storageRef;
  }

  /**
   * Loads the ECS snapshot string from Firebase Storage.
   */
  async loadGame(options: { uid: string; slot: number }): Promise<string | undefined> {
    const { uid, slot } = options;
    const storageRef = `saves/${uid}/slot_${slot}.json`;

    try {
      const payload = await firebaseStorageService.downloadString(storageRef);
      this.log(`loadGame: loaded slot ${slot} for user ${uid}`);
      return payload;
    } catch (error) {
      this.debug('loadGame:not-found', { uid, slot, error: String(error) });
      return undefined;
    }
  }

  /**
   * Lists all save slots for a user via Data Connect.
   */
  async listSlots(options: { uid: string }): Promise<SaveSlotEntry[]> {
    const { uid } = options;

    const result = await listSaveSlots(dataConnect, { uid });

    const slots = result.data.saveSlots;
    if (!slots) {
      return [];
    }

    return slots.map((slot) => ({
      slotNumber: slot.slotNumber,
      lastLocationName: slot.lastLocationName,
      playedTimeSeconds: slot.playedTimeSeconds,
      storageRef: slot.storageRef,
      createdAt: slot.createdAt,
      updatedAt: slot.updatedAt,
    }));
  }

  /**
   * Deletes a save slot from Storage and its metadata row.
   *
   * TODO: Add a Data Connect `DeleteSaveSlot` mutation for the metadata row.
   * Currently only deletes the Storage blob.
   */
  async deleteSlot(options: { uid: string; slot: number }): Promise<void> {
    const { uid, slot } = options;
    const storageRef = `saves/${uid}/slot_${slot}.json`;

    await firebaseStorageService.deleteObject(storageRef);

    this.log(`deleteSlot: deleted slot ${slot} for user ${uid}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const gameStateSyncService: GameStateSyncServiceInterface = GameStateSyncService.create({
  className: 'GameStateSyncService',
});
