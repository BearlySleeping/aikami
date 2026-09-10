// apps/frontend/client/src/lib/views/vendor/vendor_view_model.svelte.ts
//
// VendorViewModel — thin bridge between VendorService and the View.
// All business logic (AI haggling, buy flow, pricing) lives in VendorService.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./vendor_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { LpcAnimationState } from '@aikami/lpc';
import type { ItemDefinition } from '@aikami/types';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import type { VendorSessionOptions as _VendorSessionOptions } from '$types';

// Re-export for consumers
export type VendorSessionOptions = _VendorSessionOptions;

// ── Capability contracts ────────────────────────────────────────────────

/** A vendor chat message as rendered in the haggle transcript. */
export type VendorChatMessage = { id: string; role: 'player' | 'vendor'; content: string };

/** A vendor stock entry with its resolved label and base price. */
export type VendorItemEntry = { itemId: string; label: string; basePrice: number };

/** A player-owned item the vendor will buy back. */
export type VendorSellEntry = {
  itemId: string;
  label: string;
  quantity: number;
  sellPrice: number;
};

/** The vendor domain operations and observable state the overlay consumes. */
export type VendorCapabilities = {
  readonly vendorName: string;
  readonly messages: readonly VendorChatMessage[];
  readonly items: readonly VendorItemEntry[];
  readonly sellableItems: readonly VendorSellEntry[];
  readonly playerGold: number;
  readonly priceMultiplier: number;
  readonly refusesToSell: boolean;
  readonly isHaggling: boolean;
  readonly isBuying: boolean;
  readonly transactionMessage: string | undefined;
  readonly transactionSuccess: boolean;

  startSession(options: VendorSessionOptions): void;
  getItemDef(itemId: string): ItemDefinition;
  getSellPrice(itemId: string): number;
  getFinalPrice(basePrice: number): number;
  haggle(message: string): Promise<void>;
  buyItem(itemId: string): Promise<void>;
  sellItem(itemId: string): void;
  close(): void;
};

/** The game-mode capability (for autofocus logic). */
export type VendorModeCapabilities = {
  readonly currentMode: string;
};

/** The overlay-navigation capability the vendor overlay invokes on close. */
export type VendorOverlayCapabilities = {
  closeVendor(): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type VendorViewModelInterface = BaseViewModelInterface & {
  readonly vendorName: string;
  readonly messages: ReadonlyArray<VendorChatMessage>;
  readonly items: ReadonlyArray<VendorItemEntry>;
  readonly sellableItems: ReadonlyArray<VendorSellEntry>;
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
  /** Current game mode (for autofocus logic). */
  readonly currentMode: string;
};

export type VendorViewModelOptions = BaseViewModelOptions &
  VendorSessionOptions & {
    /** Vendor domain operations and observable state. */
    vendor: VendorCapabilities;
    /** Current game-mode reader. */
    mode: VendorModeCapabilities;
    /** Overlay navigation. */
    overlays: VendorOverlayCapabilities;
  };

class VendorViewModel
  extends BaseViewModel<VendorViewModelOptions>
  implements VendorViewModelInterface
{
  private readonly _vendor: VendorCapabilities;
  private readonly _mode: VendorModeCapabilities;
  private readonly _overlays: VendorOverlayCapabilities;

  /** C-419 AC-3: UI flag — the haggle panel collapses until the player
   * explicitly expands it or a conversation starts. */
  hagglePanelExpanded = $state(false);

  /** Item ID awaiting sell confirmation (C-331 AC-3). */
  pendingSellItemId = $state<string | undefined>(undefined);

  constructor(options: VendorViewModelOptions) {
    super(options);
    this._vendor = options.vendor;
    this._mode = options.mode;
    this._overlays = options.overlays;
    this._vendor.startSession({
      vendorId: options.vendorId,
      vendorName: options.vendorName,
      vendorInventory: options.vendorInventory,
    });
  }

  get currentMode(): string {
    return this._mode.currentMode;
  }

  get vendorName(): string {
    return this._vendor.vendorName;
  }
  get messages() {
    return this._vendor.messages;
  }
  get items() {
    return this._vendor.items;
  }
  get sellableItems() {
    return this._vendor.sellableItems;
  }
  get playerGold(): number {
    return this._vendor.playerGold;
  }
  get priceMultiplier(): number {
    return this._vendor.priceMultiplier;
  }
  get refusesToSell(): boolean {
    return this._vendor.refusesToSell;
  }
  get isHaggling(): boolean {
    return this._vendor.isHaggling;
  }
  get isBuying(): boolean {
    return this._vendor.isBuying;
  }
  get transactionMessage(): string | undefined {
    return this._vendor.transactionMessage;
  }
  get transactionSuccess(): boolean {
    return this._vendor.transactionSuccess;
  }

  /** C-419 AC-3: collapsed until the player expands or a message exists. */
  get isHagglePanelCollapsed(): boolean {
    return !this.hagglePanelExpanded && this._vendor.messages.length === 0;
  }

  /** @inheritdoc */
  expandHagglePanel(): void {
    this.hagglePanelExpanded = true;
  }

  /** C-419 AC-4: resolves the item's LPC art URL (walk sheet) when the
   * content-pack catalog declares lpcAssetId. Falls back to undefined so
   * the view can render the emoji tier. */
  getItemArtUrl(itemId: string): string | undefined {
    const lpcAssetId = this._vendor.getItemDef(itemId).lpcAssetId;
    if (!lpcAssetId) {
      return undefined;
    }
    return getLpcAssetPath('', lpcAssetId, LpcAnimationState.Walk) ?? undefined;
  }

  get pendingSellLabel(): string {
    return this.pendingSellItemId ? this._vendor.getItemDef(this.pendingSellItemId).label : '';
  }

  get pendingSellPrice(): number {
    return this.pendingSellItemId ? this._vendor.getSellPrice(this.pendingSellItemId) : 0;
  }

  getFinalPrice(basePrice: number): number {
    return this._vendor.getFinalPrice(basePrice);
  }
  async haggle(message: string): Promise<void> {
    await this._vendor.haggle(message);
  }
  async buyItem(itemId: string): Promise<void> {
    await this._vendor.buyItem(itemId);
  }
  requestSell(itemId: string): void {
    this.pendingSellItemId = itemId;
  }
  confirmSell(): void {
    if (!this.pendingSellItemId) {
      return;
    }
    this._vendor.sellItem(this.pendingSellItemId);
    this.pendingSellItemId = undefined;
  }
  cancelSell(): void {
    this.pendingSellItemId = undefined;
  }
  closeVendor(): void {
    this._vendor.close();
    this._overlays.closeVendor();
  }
  getItemDef(itemId: string): ItemDefinition {
    return this._vendor.getItemDef(itemId);
  }
}

/**
 * Builds a vendor ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getVendorViewModel` in ./vendor_composition.ts.
 */
export const createVendorViewModel = (options: VendorViewModelOptions): VendorViewModelInterface =>
  VendorViewModel.create(options);
