// apps/frontend/client/src/lib/views/dashboard/dashboard_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  type SaveSlotEntry,
} from '@aikami/frontend/services';
import { authService, gameStateSyncService, routerService, setPendingGameLoad } from '$services';

export type DashboardViewModelOptions = BaseViewModelOptions;

export type DashboardViewModelInterface = BaseViewModelInterface & {
  /** Available save slots for the current user. */
  readonly saveSlots: SaveSlotEntry[];

  /** Whether save slots are currently being loaded. */
  readonly isLoadingSlots: boolean;

  /** Navigates to the character creator page. */
  goToCharacterCreator(): Promise<void>;

  /** Loads the save slots list for the current user. */
  loadSlots(): Promise<void>;

  /**
   * Resumes a game from a save slot.
   * Downloads the blob, stores the payload for cross-route handoff,
   * and navigates to the game view.
   */
  resumeGame(slot: SaveSlotEntry): Promise<void>;
};

class DashboardViewModel
  extends BaseViewModel<DashboardViewModelOptions>
  implements DashboardViewModelInterface
{
  saveSlots = $state<SaveSlotEntry[]>([]);

  isLoadingSlots = $state<boolean>(true);

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await this.loadSlots();

    await super.initialize();
  }

  /** @inheritdoc */
  async goToCharacterCreator(): Promise<void> {
    await routerService.goToRoute('personas/create', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  /** @inheritdoc */
  async loadSlots(): Promise<void> {
    const uid = authService.uid;
    if (!uid) {
      this.isLoadingSlots = false;
      return;
    }

    this.isLoadingSlots = true;

    try {
      this.saveSlots = await gameStateSyncService.listSlots({ uid });
    } catch (error) {
      this.debug('loadSlots:error', { error: String(error) });
      this.saveSlots = [];
    } finally {
      this.isLoadingSlots = false;
    }
  }

  /** @inheritdoc */
  async resumeGame(slot: SaveSlotEntry): Promise<void> {
    const uid = authService.uid;
    if (!uid) {
      return;
    }

    try {
      const payload = await gameStateSyncService.loadGame({ uid, slot: slot.slotNumber });
      if (!payload) {
        this.debug('resumeGame:no-payload', { slot: slot.slotNumber });
        return;
      }

      setPendingGameLoad(payload);
      await routerService.goToRoute('game', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.debug('resumeGame:error', { slot: slot.slotNumber, error: String(error) });
    }
  }
}

export const getDashboardViewModel = (
  options: DashboardViewModelOptions,
): DashboardViewModelInterface => new DashboardViewModel(options);
