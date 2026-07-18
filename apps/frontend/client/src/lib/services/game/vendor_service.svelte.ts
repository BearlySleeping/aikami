// apps/frontend/client/src/lib/services/game/vendor_service.svelte.ts
//
// Vendor domain service — owns vendor visibility, AI haggling logic,
// buy/sell flows, and item pricing. Singleton with per-vendor session state.
//
// Contract C-331: prices come from the item catalog (content pack basePrice),
// sell flow at a fixed 50% floor of base price, validated atomic
// transactions, and authored offline fallback lines instead of '...'.

import { DEFAULT_VENDOR_BASE_PRICE, VENDOR_SELL_RATIO } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ItemDefinition } from '@aikami/types';
import {
  VENDOR_ACTION_SYSTEM_PROMPT,
  type VendorActionIntent,
  VendorActionSchema,
} from '$lib/data/ai_prompts/vendor_action_schema';
import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { audioService } from '$services';
import { getItemDefinition, inventoryService } from './inventory_service.svelte';

// ── Pricing ─────────────────────────────────────────────────────────────

/**
 * Resolves the deterministic base price for an item from the active catalog.
 * Items without an authored positive basePrice fall back to the default.
 */
const getBasePrice = (itemId: string): number => {
  const basePrice = getItemDefinition(itemId).basePrice;
  return basePrice > 0 ? basePrice : DEFAULT_VENDOR_BASE_PRICE;
};

// ── Types ───────────────────────────────────────────────────────────────

export type VendorChatMessage = { id: string; role: 'player' | 'vendor'; content: string };

export type VendorItemEntry = { itemId: string; label: string; basePrice: number };

export type VendorSellEntry = {
  itemId: string;
  label: string;
  quantity: number;
  sellPrice: number;
};

export type VendorSessionOptions = {
  vendorId: string;
  vendorName: string;
  vendorInventory: string;
};

export type VendorServiceInterface = BaseFrontendClassInterface & {
  readonly isOpen: boolean;
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

  /**
   * Wires the authored fallback line provider (content-pack dialogue).
   * Called by the composition root; dev sandboxes may omit it.
   */
  configureFallback(options: { getVendorLine(vendorId: string): string | undefined }): void;

  open(): void;
  close(): void;
  toggle(): void;
  startSession(options: VendorSessionOptions): void;
  getFinalPrice(basePrice: number): number;
  /** Sell price for an item — floor(basePrice × 0.5), haggle-independent. */
  getSellPrice(itemId: string): number;
  haggle(message: string): Promise<void>;
  buyItem(itemId: string): Promise<void>;
  /** Sells one unit of a player-owned item back to the vendor (C-331 AC-3). */
  sellItem(itemId: string): void;
  getItemDef(itemId: string): ItemDefinition;
};

class VendorService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements VendorServiceInterface
{
  private _isOpen = $state(false);
  vendorName = $state('');
  messages: VendorChatMessage[] = $state([]);
  items: VendorItemEntry[] = $state([]);
  priceMultiplier = $state(1.0);
  refusesToSell = $state(false);
  isHaggling = $state(false);
  isBuying = $state(false);
  transactionMessage = $state<string | undefined>(undefined);
  transactionSuccess = $state(false);

  private _vendorId = '';
  private _transactionMessageTimer: ReturnType<typeof setTimeout> | undefined;
  private _getVendorLine: ((vendorId: string) => string | undefined) | undefined;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get playerGold(): number {
    return inventoryService.gold;
  }

  /**
   * Player-owned items the vendor will buy back (computed sell price > 0).
   * Equipped items never appear — the equipment service removes them from
   * the inventory array on equip (C-331 AC-3 watch point).
   */
  get sellableItems(): readonly VendorSellEntry[] {
    return inventoryService.inventory
      .map((entry) => ({
        itemId: entry.itemId,
        label: getItemDefinition(entry.itemId).label,
        quantity: entry.quantity,
        sellPrice: this.getSellPrice(entry.itemId),
      }))
      .filter((entry) => entry.sellPrice > 0);
  }

  /** @inheritdoc */
  configureFallback(options: { getVendorLine(vendorId: string): string | undefined }): void {
    this._getVendorLine = (vendorId) => options.getVendorLine(vendorId);
  }

  open(): void {
    this._isOpen = true;
  }
  close(): void {
    this._isOpen = false;
    this.priceMultiplier = 1.0;
    this.refusesToSell = false;
  }
  toggle(): void {
    this._isOpen = !this._isOpen;
  }

  startSession(options: VendorSessionOptions): void {
    this._vendorId = options.vendorId;
    this.vendorName = options.vendorName;
    const itemIds = options.vendorInventory
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    this.items = itemIds.map((itemId) => {
      const def = getItemDefinition(itemId);
      return { itemId, label: def.label, basePrice: getBasePrice(itemId) };
    });
    this.messages = [];
    this.priceMultiplier = 1.0;
    this.refusesToSell = false;
  }

  getFinalPrice(basePrice: number): number {
    return Math.floor(basePrice * this.priceMultiplier);
  }

  /** @inheritdoc */
  getSellPrice(itemId: string): number {
    // Sell price derives from BASE price, never the haggled multiplier —
    // prevents haggle-then-sell arbitrage (C-331 edge case).
    return Math.floor(getItemDefinition(itemId).basePrice * VENDOR_SELL_RATIO);
  }

  getItemDef(itemId: string): ItemDefinition {
    return getItemDefinition(itemId);
  }

  async haggle(message: string): Promise<void> {
    if (this.isHaggling || this.refusesToSell || !message.trim()) {
      return;
    }
    this.isHaggling = true;
    this.messages = [
      ...this.messages,
      { id: crypto.randomUUID(), role: 'player', content: message },
    ];
    try {
      const prompt = this._buildHagglePrompt(message);
      const raw = await textGenerationService.extractStructure({
        schema: VendorActionSchema as unknown as Record<string, unknown>,
        schemaName: 'VendorActionIntent',
        prompt,
        systemPrompt: VENDOR_ACTION_SYSTEM_PROMPT,
      });
      const intent = raw as VendorActionIntent;
      const clamped = Math.max(0.5, Math.min(1.5, intent.priceMultiplier));
      this.priceMultiplier = clamped;
      this.refusesToSell = intent.refusesToSell;
      this.messages = [
        ...this.messages,
        { id: crypto.randomUUID(), role: 'vendor', content: intent.narrative },
      ];
      if (intent.itemToBuy && !this.refusesToSell) {
        const valid = this.items.find((i) => i.itemId === intent.itemToBuy);
        if (valid) {
          await this.buyItem(intent.itemToBuy);
        }
      }
    } catch (error) {
      // AI unavailable — degrade to the vendor's authored content-pack line
      // at unchanged base prices (C-331 AC-3). Never the bare '...'.
      this.debug('haggle:fallback-authored', { error: String(error) });
      this.priceMultiplier = 1.0;
      this.messages = [
        ...this.messages,
        { id: crypto.randomUUID(), role: 'vendor', content: this._authoredFallbackLine() },
      ];
    } finally {
      this.isHaggling = false;
    }
  }

  async buyItem(itemId: string): Promise<void> {
    if (this.isBuying || this.refusesToSell) {
      return;
    }
    const entry = this.items.find((i) => i.itemId === itemId);
    if (!entry) {
      return;
    }
    const finalPrice = this.getFinalPrice(entry.basePrice);
    this.isBuying = true;
    try {
      const committed = this._executeTransaction({
        kind: 'buy',
        itemId,
        price: finalPrice,
      });
      if (!committed) {
        return;
      }
      void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
      this._showTransaction(
        `Purchased ${getItemDefinition(itemId).label} for ${finalPrice} gold!`,
        true,
      );
    } finally {
      this.isBuying = false;
    }
  }

  /** @inheritdoc */
  sellItem(itemId: string): void {
    const sellPrice = this.getSellPrice(itemId);
    if (sellPrice <= 0) {
      this._showTransaction(`${this.vendorName || 'The vendor'} won't buy that.`, false);
      return;
    }
    const committed = this._executeTransaction({ kind: 'sell', itemId, price: sellPrice });
    if (!committed) {
      return;
    }
    void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
    this._showTransaction(`Sold ${getItemDefinition(itemId).label} for ${sellPrice} gold!`, true);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Shared validate-then-commit transaction helper (C-331 AC-3).
   *
   * Validates gold/ownership/capacity first, then commits both sides of the
   * exchange in one synchronous block — no partial gold/item states.
   *
   * @returns `true` when the transaction committed.
   */
  private _executeTransaction(options: {
    kind: 'buy' | 'sell';
    itemId: string;
    price: number;
  }): boolean {
    const { kind, itemId, price } = options;

    // Integer, positive price invariant
    if (!Number.isInteger(price) || price <= 0) {
      this.debug('_executeTransaction:invalid-price', { kind, itemId, price });
      this._showTransaction('Transaction failed.', false);
      return false;
    }

    if (kind === 'buy') {
      if (inventoryService.gold < price) {
        this._showTransaction(
          `Not enough gold! Need ${price}, have ${inventoryService.gold}.`,
          false,
        );
        return false;
      }
      // Validate capacity BEFORE deducting gold — atomic reject, no refund path
      const added = inventoryService.addItem({ itemId, quantity: 1, enforceCapacity: true });
      if (!added) {
        this._showTransaction('Your inventory is full!', false);
        return false;
      }
      inventoryService.removeGold({ amount: price });
      return true;
    }

    // sell — validate ownership first (quantity-aware)
    const removed = inventoryService.removeItem({ itemId, quantity: 1 });
    if (!removed) {
      this.debug('_executeTransaction:sell-not-owned', { itemId });
      this._showTransaction("You don't have that item.", false);
      return false;
    }
    inventoryService.addGold({ amount: price });
    return true;
  }

  /**
   * Resolves the authored vendor fallback line from the content pack.
   * Falls back to a generic in-fiction line when no dialogue is authored.
   */
  private _authoredFallbackLine(): string {
    const authored = this._getVendorLine?.(this._vendorId);
    if (authored) {
      return authored;
    }
    return `${this.vendorName || 'The vendor'} shrugs. "Prices are as marked, friend."`;
  }

  private _showTransaction(message: string, success: boolean): void {
    if (this._transactionMessageTimer) {
      clearTimeout(this._transactionMessageTimer);
    }
    this.transactionMessage = message;
    this.transactionSuccess = success;
    this._transactionMessageTimer = setTimeout(() => {
      this.transactionMessage = undefined;
    }, 3000);
  }

  private _buildHagglePrompt(playerMessage: string): string {
    const summary = this.items.map((i) => `${i.label} (${i.basePrice} gold)`).join(', ');
    return `Vendor: ${this.vendorName}\nItems for sale: ${summary}\nCurrent price multiplier: ${this.priceMultiplier.toFixed(2)}x\nPlayer's gold: ${this.playerGold}\n\nPlayer says: "${playerMessage}"\n\nRespond as the vendor.`;
  }
}

export const vendorService: VendorServiceInterface = VendorService.create({
  className: 'VendorService',
}) as VendorServiceInterface;
