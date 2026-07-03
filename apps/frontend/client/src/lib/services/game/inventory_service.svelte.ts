// apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts
//
// Inventory domain service — owns inventory visibility state.
// Public API for opening/closing the inventory from anywhere.
// Follows the same pattern as NpcDialogueService.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

export type InventoryServiceInterface = BaseFrontendClassInterface & {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
};

class InventoryService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements InventoryServiceInterface
{
  private _isOpen = $state(false);

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
  }

  toggle(): void {
    this._isOpen = !this._isOpen;
  }
}

export const inventoryService: InventoryServiceInterface = InventoryService.create({
  className: 'InventoryService',
}) as InventoryServiceInterface;
