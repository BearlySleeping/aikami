// apps/frontend/client/src/lib/views/dev/save_load/save_load_view_model.svelte.ts
//
// Dev sandbox ViewModel for testing the cloud save/load pipeline.
// Exercises GameStateSyncService (Storage + local save metadata) without
// requiring a running game engine.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { SaveSlotEntry } from '@aikami/types';
import type { AuthServiceInterface, GameStateSyncServiceInterface } from '$services';

// ── Capability contracts ────────────────────────────────────────────────

/** The auth state + lifecycle the save/load sandbox gates on. */
export type SaveLoadAuthCapabilities = Pick<AuthServiceInterface, 'uid' | 'initialize'>;

/** The cloud save/load operations the sandbox exercises. */
export type GameStateSyncCapabilities = Pick<
  GameStateSyncServiceInterface,
  'listSlots' | 'saveGame' | 'loadGame' | 'deleteSlot'
>;

/** Sample ECS snapshot for dev sandbox pre-fill. */
const DEFAULT_SNAPSHOT = JSON.stringify(
  {
    version: '1.0.0',
    timestamp: Date.now(),
    entities: [1, 2],
    components: {
      position: {
        x: [400, 600],
        y: [300, 350],
      },
      appearance: {
        layerIds0: [101, 0],
        layerIds1: [201, 0],
        layerIds2: [301, 0],
        layerIds3: [401, 0],
        layerIds4: [501, 0],
      },
      combatStats: {
        hp: [100, 50],
        maxHp: [100, 50],
        attack: [15, 8],
        defense: [10, 5],
      },
    },
  },
  null,
  2,
);

export type SaveLoadViewModelInterface = BaseViewModelInterface & {
  /** Current user's UID, or undefined if not logged in. */
  readonly uid: string | undefined;

  /** Available save slots for the current user. */
  readonly slots: SaveSlotEntry[];

  /** Whether slots are currently being loaded. */
  readonly isLoadingSlots: boolean;

  /** The slot number to save to / load from (1-indexed). */
  readonly slotNumber: number;

  /** Free-form ECS payload for manual save testing. */
  readonly payload: string;

  /** Whether a save/load/delete operation is in progress. */
  readonly isBusy: boolean;

  /** Feedback message (success or error). */
  readonly message: string | undefined;

  /** Loaded payload from the last load operation. */
  readonly loadedPayload: string | undefined;

  /** Sets the slot number (1-3). */
  setSlotNumber(slot: number): void;

  /** Sets the manual payload text. */
  setPayload(text: string): void;

  /** Loads the save slots list from the local saves table. */
  loadSlots(): Promise<void>;

  /** Saves the current payload to the selected slot. */
  saveSlot(): Promise<void>;

  /** Loads the payload from the selected slot. */
  loadSlot(): Promise<void>;

  /** Deletes the selected slot. */
  deleteSlot(): Promise<void>;
};

export type SaveLoadViewModelOptions = BaseViewModelOptions & {
  /** Auth state + lifecycle. */
  auth: SaveLoadAuthCapabilities;
  /** Cloud save/load operations. */
  sync: GameStateSyncCapabilities;
};

class SaveLoadViewModel
  extends BaseViewModel<SaveLoadViewModelOptions>
  implements SaveLoadViewModelInterface
{
  slots: SaveSlotEntry[] = $state([]);
  isLoadingSlots = $state(true);
  slotNumber = $state(1);
  payload = $state('');
  isBusy = $state(false);
  message = $state<string | undefined>(undefined);
  loadedPayload = $state<string | undefined>(undefined);

  private readonly _auth: SaveLoadAuthCapabilities;
  private readonly _sync: GameStateSyncCapabilities;

  constructor(options: SaveLoadViewModelOptions) {
    super(options);
    this._auth = options.auth;
    this._sync = options.sync;
  }

  get uid(): string | undefined {
    return this._auth.uid;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Ensure auth is initialized so the session is resolved before loading
    // slots. Safe to call repeatedly — the auth capability guards with a
    // cached in-flight promise.
    await this._auth.initialize();

    this.payload = DEFAULT_SNAPSHOT;
    await this.loadSlots();
    await super.initialize();
  }

  /** @inheritdoc */
  setSlotNumber(slot: number): void {
    this.slotNumber = slot;
  }

  /** @inheritdoc */
  setPayload(text: string): void {
    this.payload = text;
  }

  /** @inheritdoc */
  async loadSlots(): Promise<void> {
    const uid = this.uid;
    if (!uid) {
      this.isLoadingSlots = false;
      this.slots = [];
      this.message = 'Not signed in — save/load requires authentication.';
      return;
    }

    this.isLoadingSlots = true;

    try {
      this.slots = await this._sync.listSlots({ uid });
    } catch (error) {
      this.debug('loadSlots:error', { error: String(error) });
      this.slots = [];
    } finally {
      this.isLoadingSlots = false;
    }
  }

  /** @inheritdoc */
  async saveSlot(): Promise<void> {
    const uid = this.uid;
    if (!uid) {
      this.message = 'Not signed in.';
      return;
    }

    if (!this.payload.trim()) {
      this.message = 'Payload is empty.';
      return;
    }

    this.isBusy = true;
    this.message = undefined;

    try {
      await this._sync.saveGame({
        uid,
        slot: this.slotNumber,
        payload: this.payload,
      });

      this.message = `Saved to slot ${this.slotNumber}.`;
      await this.loadSlots();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.message = `Save failed: ${msg}`;
      this.debug('saveSlot:error', { slot: this.slotNumber, error: msg });
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async loadSlot(): Promise<void> {
    const uid = this.uid;
    if (!uid) {
      this.message = 'Not signed in.';
      return;
    }

    this.isBusy = true;
    this.message = undefined;
    this.loadedPayload = undefined;

    try {
      const result = await this._sync.loadGame({
        uid,
        slot: this.slotNumber,
      });

      if (result) {
        this.loadedPayload = result;
        this.message = `Loaded slot ${this.slotNumber} (${result.length} bytes).`;
      } else {
        this.message = `Slot ${this.slotNumber} is empty.`;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.message = `Load failed: ${msg}`;
      this.debug('loadSlot:error', { slot: this.slotNumber, error: msg });
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async deleteSlot(): Promise<void> {
    const uid = this.uid;
    if (!uid) {
      this.message = 'Not signed in.';
      return;
    }

    this.isBusy = true;
    this.message = undefined;
    this.loadedPayload = undefined;

    try {
      await this._sync.deleteSlot({ uid, slot: this.slotNumber });
      this.message = `Deleted slot ${this.slotNumber}.`;
      await this.loadSlots();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.message = `Delete failed: ${msg}`;
      this.debug('deleteSlot:error', { slot: this.slotNumber, error: msg });
    } finally {
      this.isBusy = false;
    }
  }
}

/**
 * Builds a save/load ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSaveLoadViewModel` in ./save_load_composition.ts.
 */
export const createSaveLoadViewModel = (
  options: SaveLoadViewModelOptions,
): SaveLoadViewModelInterface => SaveLoadViewModel.create(options);
