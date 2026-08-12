// packages/frontend/services/src/lib/services/game_state_sync.svelte.ts
//
// Cloud save/load sync service — rehomed from Firebase Data Connect to the
// local SQLite `saves` table (C-385 AC-2).
//
// The ECS snapshot blob stays in Firebase Storage (`saves/{uid}/slot_{n}.json`)
// unchanged; only the slot METADATA moves. The local database is single-tenant
// by construction (the user's own device), so no `uid` column is added —
// `uid` remains a parameter only for the Storage blob paths.
//
// Metadata mapping onto the existing `saves` table:
//   slot_id    ← slot number ("slot_{n}")
//   campaign_id← null (sync slots have no campaign)
//   timestamp  ← updatedAt (ms epoch)
//   map_name   ← lastLocationName
//   payload    ← JSON envelope carrying { playedTimeSeconds, storageRef }
//
// Contract: C-385 AC-2, C-321

import { getLocalDatabase } from '@aikami/frontend/storage';
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

/**
 * JSON envelope stored in the local `saves.payload` column for sync slots.
 * Carries the fields the `saves` table has no dedicated columns for.
 */
type SaveSlotLocalPayload = {
  /** Accumulated play time in seconds, if tracked. */
  playedTimeSeconds?: number;
  /** Firebase Storage path of the ECS blob (e.g. `saves/{uid}/slot_1.json`). */
  storageRef: string;
};

export type GameStateSyncServiceInterface = BaseClassInterface & {
  /**
   * Saves a game state (ECS snapshot) to Firebase Storage and upserts the
   * slot metadata row in the local `saves` table.
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
   * Lists all save slots from the local `saves` table.
   *
   * The local database is single-tenant, so the `uid` parameter only exists
   * to keep the signature uniform with the Storage paths; rows are not
   * filtered by user.
   *
   * @returns Array of save slot metadata entries, ordered by slot number.
   */
  listSlots(options: { uid: string }): Promise<SaveSlotEntry[]>;

  /**
   * Deletes a save slot's blob from Storage and its metadata row from the
   * local `saves` table.
   */
  deleteSlot(options: { uid: string; slot: number }): Promise<void>;
};

export type GameStateSyncServiceOptions = Record<string, never>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class GameStateSyncService extends BaseClass implements GameStateSyncServiceInterface {
  /**
   * Saves the ECS snapshot payload to Storage and upserts the local
   * `saves` row carrying the slot metadata.
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

    // 1. Upload ECS snapshot blob to Firebase Cloud Storage (unchanged)
    await firebaseStorageService.uploadString(storageRef, payload);

    // 2. Upsert the slot metadata row in the local saves table
    const localPayload: SaveSlotLocalPayload = {
      playedTimeSeconds: metadata?.playedTimeSeconds,
      storageRef,
    };
    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        `sync_slot_${slot}`,
        `slot_${slot}`,
        null,
        Date.now(),
        metadata?.lastLocationName ?? '',
        JSON.stringify(localPayload),
      ],
    });

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
   * Lists all save slots from the local `saves` table.
   */
  async listSlots(options: { uid: string }): Promise<SaveSlotEntry[]> {
    // uid is intentionally unused — the local database is single-tenant.
    void options;

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT slot_id, timestamp, map_name, payload FROM saves WHERE slot_id LIKE ? ORDER BY slot_id ASC',
      args: ['slot_%'],
    });

    const slots: SaveSlotEntry[] = [];
    for (const row of result.rows) {
      const slotId = row.slot_id as string;
      const slotNumber = Number.parseInt(slotId.replace('slot_', ''), 10);
      if (Number.isNaN(slotNumber)) {
        continue;
      }

      const localPayload = this._parseLocalPayload(row.payload);
      const timestamp = row.timestamp as number;
      slots.push({
        slotNumber,
        lastLocationName: (row.map_name as string) || null,
        playedTimeSeconds: localPayload?.playedTimeSeconds ?? null,
        storageRef: localPayload?.storageRef ?? '',
        updatedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      });
    }

    this.debug('listSlots', { count: slots.length });
    return slots;
  }

  /**
   * Deletes a save slot from Storage and its local metadata row.
   */
  async deleteSlot(options: { uid: string; slot: number }): Promise<void> {
    const { uid, slot } = options;
    const storageRef = `saves/${uid}/slot_${slot}.json`;

    await firebaseStorageService.deleteObject(storageRef);

    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM saves WHERE id = ?',
      args: [`sync_slot_${slot}`],
    });

    this.log(`deleteSlot: deleted slot ${slot} for user ${uid}`);
  }

  /**
   * Parses the local `saves.payload` envelope, tolerating legacy rows whose
   * payload is not a sync envelope (e.g. game save envelopes).
   *
   * @param raw - Raw payload column value.
   * @returns The parsed envelope, or undefined when unparsable.
   */
  private _parseLocalPayload(raw: unknown): SaveSlotLocalPayload | undefined {
    if (typeof raw !== 'string') {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'storageRef' in parsed) {
        return parsed as SaveSlotLocalPayload;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const gameStateSyncService: GameStateSyncServiceInterface = GameStateSyncService.create({
  className: 'GameStateSyncService',
});
