// apps/frontend/client/src/lib/views/vendor/vendor_view_model.svelte.ts
//
// VendorViewModel — thin bridge between VendorService and the View.
// All business logic (AI haggling, buy flow, pricing) lives in VendorService.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ItemDefinition } from '@aikami/types';
import { vendorService } from '$lib/services/game/vendor_service.svelte.ts';
import type { VendorSessionOptions as _VendorSessionOptions } from '$services';

// Re-export for consumers
export type VendorSessionOptions = _VendorSessionOptions;

export type VendorViewModelInterface = BaseViewModelInterface & {
  readonly vendorName: string;
  readonly messages: ReadonlyArray<{ id: string; role: 'player' | 'vendor'; content: string }>;
  readonly items: ReadonlyArray<{ itemId: string; label: string; basePrice: number }>;
  readonly playerGold: number;
  readonly priceMultiplier: number;
  readonly refusesToSell: boolean;
  readonly isHaggling: boolean;
  readonly isBuying: boolean;
  readonly transactionMessage: string | undefined;
  readonly transactionSuccess: boolean;

  getFinalPrice(basePrice: number): number;
  haggle(message: string): Promise<void>;
  buyItem(itemId: string): Promise<void>;
  closeVendor(): void;
  getItemDef(itemId: string): ItemDefinition;
};

export type VendorViewModelOptions = BaseViewModelOptions & _VendorSessionOptions;

class VendorViewModel
  extends BaseViewModel<VendorViewModelOptions>
  implements VendorViewModelInterface
{
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

  getFinalPrice(basePrice: number): number {
    return vendorService.getFinalPrice(basePrice);
  }
  async haggle(message: string): Promise<void> {
    await vendorService.haggle(message);
  }
  async buyItem(itemId: string): Promise<void> {
    await vendorService.buyItem(itemId);
  }
  closeVendor(): void {
    vendorService.close();
  }
  getItemDef(itemId: string): ItemDefinition {
    return vendorService.getItemDef(itemId);
  }
}

export const getVendorViewModel = (options: VendorViewModelOptions): VendorViewModelInterface =>
  VendorViewModel.create(options);
