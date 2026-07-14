// apps/frontend/client/src/lib/services/game/vendor_service.svelte.ts
//
// Vendor domain service — owns vendor visibility, AI haggling logic,
// buy flow, and item pricing. Singleton with per-vendor session state.

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
import { audioService, getItemDefinition, inventoryService } from '$services';

// ── Pricing ─────────────────────────────────────────────────────────────

const VENDOR_ITEM_BASE_PRICES: Record<string, number> = {
  rustySword: 15,
  ironSword: 50,
  steelSword: 150,
  woodenShield: 20,
  leatherArmor: 45,
  ironArmor: 120,
  healthPotion: 10,
  manaPotion: 15,
  goldCoin: 1,
} as const satisfies Record<string, number>;

const DEFAULT_BASE_PRICE = 10;

const getBasePrice = (itemId: string): number => {
  return VENDOR_ITEM_BASE_PRICES[itemId] ?? DEFAULT_BASE_PRICE;
};

// ── Types ───────────────────────────────────────────────────────────────

export type VendorChatMessage = { id: string; role: 'player' | 'vendor'; content: string };

export type VendorItemEntry = { itemId: string; label: string; basePrice: number };

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
  readonly playerGold: number;
  readonly priceMultiplier: number;
  readonly refusesToSell: boolean;
  readonly isHaggling: boolean;
  readonly isBuying: boolean;
  readonly transactionMessage: string | undefined;
  readonly transactionSuccess: boolean;

  open(): void;
  close(): void;
  toggle(): void;
  startSession(options: VendorSessionOptions): void;
  getFinalPrice(basePrice: number): number;
  haggle(message: string): Promise<void>;
  buyItem(itemId: string): Promise<void>;
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

  private _transactionMessageTimer: ReturnType<typeof setTimeout> | undefined;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get playerGold(): number {
    return inventoryService.gold;
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
    } catch {
      this.messages = [
        ...this.messages,
        { id: crypto.randomUUID(), role: 'vendor', content: '...' },
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
    if (inventoryService.gold < finalPrice) {
      this._showTransaction(
        `Not enough gold! Need ${finalPrice}, have ${inventoryService.gold}.`,
        false,
      );
      return;
    }
    this.isBuying = true;
    try {
      inventoryService.removeGold({ amount: finalPrice });
      const inventory = inventoryService.inventory;
      const idx = inventory.findIndex((i) => i.itemId === itemId);
      if (idx >= 0) {
        inventory[idx] = { itemId, quantity: inventory[idx].quantity + 1 };
      } else {
        inventory.push({ itemId, quantity: 1 });
      }
      inventoryService.inventory.length = 0;
      for (const item of inventory) {
        inventoryService.inventory.push(item);
      }
      void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
      this._showTransaction(
        `Purchased ${getItemDefinition(itemId).label} for ${finalPrice} gold!`,
        true,
      );
    } catch {
      this._showTransaction('Transaction failed.', false);
    } finally {
      this.isBuying = false;
    }
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
