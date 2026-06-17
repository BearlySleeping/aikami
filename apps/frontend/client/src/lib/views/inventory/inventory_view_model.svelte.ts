// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameStateService } from '$services';

// ---------------------------------------------------------------------------
// InventoryViewModel — Svelte 5 ViewModel for the inventory overlay
//
// Contract C-142 Task 4: Reads from GameStateService.inventory and exposes
// the item list reactively to the InventoryView.
// ---------------------------------------------------------------------------

export type InventoryViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the inventory overlay. */
  onClose: () => void;
};

export type InventoryViewModelInterface = BaseViewModelInterface & {
  /** The current inventory items from the game state. */
  readonly items: Array<{ itemId: string; quantity: number }>;

  /** Closes the inventory overlay (delegates to parent callback). */
  closeInventory(): void;
};

class InventoryViewModel
  extends BaseViewModel<InventoryViewModelOptions>
  implements InventoryViewModelInterface
{
  private readonly _onClose: () => void;

  constructor(options: InventoryViewModelOptions) {
    super(options);
    this._onClose = options.onClose;
  }

  /** @inheritdoc */
  get items(): Array<{ itemId: string; quantity: number }> {
    return gameStateService.inventory;
  }

  /** @inheritdoc */
  closeInventory(): void {
    this._onClose();
  }
}

export { InventoryViewModel };
