// packages/shared/types/src/lib/game/game_state_sync.ts
//
// Types for the cloud save/load sync service (GameStateSyncService).
// The ECS snapshot blob lives in the R2 saves bucket; only slot METADATA
// moves through the local database.

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
