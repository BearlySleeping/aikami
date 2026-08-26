// apps/frontend/client/src/lib/views/vendor/vendor_view_model.svelte.ts
//
// VendorViewModel — thin bridge between VendorService and the View.
// All business logic (AI haggling, buy flow, pricing) lives in VendorService.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { LpcAnimationState } from '@aikami/lpc';
import type { ItemDefinition } from '@aikami/types';
import { createRegistryAssetResolver } from '$lib/services/assets/registry_asset_resolver';

const _registryResolver = createRegistryAssetResolver();
import { gameOverlayService, vendorService } from '$services';
import type { VendorSessionOptions as _VendorSessionOptions } from '$types';

// Re-export for consumers
export type VendorSessionOptions = _VendorSessionOptions;

export type VendorViewModelInterface = BaseViewModelInterface & {
  readonly vendorName: string;
  readonly messages: ReadonlyArray<{ id: string; role: 'player' | 'vendor'; content: string }>;
  readonly items: ReadonlyArray<{ itemId: string; label: string; basePrice: number }>;
  readonly sellableItems: ReadonlyArray<{
    itemId: string;
    label: string;
    quantity: number;
    sellPrice: number;
  }>;
  readonly playerGold: number;
  readonly priceMultiplier: number;
  readonly refusesToSell: boolean;
  readonly isHaggling: boolean;
  readonly isBuying: boolean;
  readonly transactionMessage: string | undefined;
  readonly transactionSuccess: boolean;
  /** Item ID awaiting sell confirmation, or undefined (C-331 AC-3). */
  readonly pendingSellItemId: string | undefined;
  readonly pendingSellLabel: string;
  readonly pendingSellPrice: number;
  /** Whether the haggle panel is collapsed until a conversation starts (C-419 AC-3). */
  readonly isHagglePanelCollapsed: boolean;

  getFinalPrice(basePrice: number): number;
  haggle(message: string): Promise<void>;
  buyItem(itemId: string): Promise<void>;
  /** Opens the sell confirmation for an owned item. */
  requestSell(itemId: string): void;
  /** Confirms and executes the pending sell. */
  confirmSell(): void;
  /** Cancels the pending sell confirmation. */
  cancelSell(): void;
  closeVendor(): void;
  getItemDef(itemId: string): ItemDefinition;
  /** Expands the collapsed haggle panel (C-419 AC-3). */
  expandHagglePanel(): void;
  /** Resolves content-pack art URL for an item, or undefined when none (C-419 AC-4). */
  getItemArtUrl(itemId: string): string | undefined;
};

export type VendorViewModelOptions = BaseViewModelOptions & _VendorSessionOptions;

class VendorViewModel
  extends BaseViewModel<VendorViewModelOptions>
  implements VendorViewModelInterface
{
  /** C-419 AC-3: UI flag — the haggle panel collapses until the player
   * explicitly expands it or a conversation starts. */
  hagglePanelExpanded = $state(false);

  constructor(options: VendorViewModelOptions) {
    super(options);
    vendorService.startSession({
      vendorId: options.vendorId,
      vendorName: options.vendorName,
      vendorInventory: options.vendorInventory,
    });
  }

  get vendorName(): string {
    return vendorService.vendorName;
  }
  get messages() {
    return vendorService.messages;
  }
  get items() {
    return vendorService.items;
  }
  get sellableItems() {
    return vendorService.sellableItems;
  }
  get playerGold(): number {
    return vendorService.playerGold;
  }
  get priceMultiplier(): number {
    return vendorService.priceMultiplier;
  }
  get refusesToSell(): boolean {
    return vendorService.refusesToSell;
  }
  get isHaggling(): boolean {
    return vendorService.isHaggling;
  }
  get isBuying(): boolean {
    return vendorService.isBuying;
  }
  get transactionMessage(): string | undefined {
    return vendorService.transactionMessage;
  }
  get transactionSuccess(): boolean {
    return vendorService.transactionSuccess;
  }

  /** C-419 AC-3: collapsed until the player expands or a message exists. */
  get isHagglePanelCollapsed(): boolean {
    return !this.hagglePanelExpanded && vendorService.messages.length === 0;
  }

  /** @inheritdoc */
  expandHagglePanel(): void {
    this.hagglePanelExpanded = true;
  }

  /** C-419 AC-4: resolves the item's LPC art URL (walk sheet) when the
   * content-pack catalog declares lpcAssetId. Falls back to undefined so
   * the view can render the emoji tier. */
  getItemArtUrl(itemId: string): string | undefined {
    const lpcAssetId = vendorService.getItemDef(itemId).lpcAssetId;
    if (!lpcAssetId) {
      return undefined;
    }
    return _registryResolver.resolve(lpcAssetId) ?? undefined;
  }

  /** Item ID awaiting sell confirmation (C-331 AC-3). */
  pendingSellItemId = $state<string | undefined>(undefined);

  get pendingSellLabel(): string {
    return this.pendingSellItemId ? vendorService.getItemDef(this.pendingSellItemId).label : '';
  }

  get pendingSellPrice(): number {
    return this.pendingSellItemId ? vendorService.getSellPrice(this.pendingSellItemId) : 0;
  }

  getFinalPrice(basePrice: number): number {
    return vendorService.getFinalPrice(basePrice);
  }
  async haggle(message: string): Promise<void> {
    await vendorService.haggle(message);
  }
  async buyItem(itemId: string): Promise<void> {
    await vendorService.buyItem(itemId);
  }
  requestSell(itemId: string): void {
    this.pendingSellItemId = itemId;
  }
  confirmSell(): void {
    if (!this.pendingSellItemId) {
      return;
    }
    vendorService.sellItem(this.pendingSellItemId);
    this.pendingSellItemId = undefined;
  }
  cancelSell(): void {
    this.pendingSellItemId = undefined;
  }
  closeVendor(): void {
    vendorService.close();
    gameOverlayService.closeVendor();
  }
  getItemDef(itemId: string): ItemDefinition {
    return vendorService.getItemDef(itemId);
  }
}

export const getVendorViewModel = (options: VendorViewModelOptions): VendorViewModelInterface =>
  VendorViewModel.create(options);
