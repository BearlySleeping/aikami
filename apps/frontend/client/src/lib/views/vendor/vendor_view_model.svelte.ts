// apps/frontend/client/src/lib/views/vendor/vendor_view_model.svelte.ts
//
// VendorViewModel — orchestrates the trading/haggling UI overlay.
//
// Manages vendor inventory display, freeform AI haggling via structured
// LLM extraction, price multiplier tracking, gold-aware purchase flow,
// and chat history rendering. Follows the CombatViewModel pattern for
// AI extraction and the DialogueOverlayViewModel pattern for chat history.
//
// Contract: C-154 AI Vendors Economy

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { audioService, gameStateService, getItemDefinition, type ItemDefinition } from '$services';
import {
  VENDOR_ACTION_SYSTEM_PROMPT,
  type VendorActionIntent,
  VendorActionSchema,
} from '../../game/core/ai/prompts/vendor_action_schema.ts';

// ---------------------------------------------------------------------------
// Vendor item pricing
// ---------------------------------------------------------------------------

/**
 * Base gold prices for items purchasable from vendors.
 *
 * Items not listed default to 10 gold.
 * Prices are balanced around the player starting with 100 gold.
 */
const VENDOR_ITEM_BASE_PRICES: Record<string, number> = {
  rusty_sword: 15,
  iron_sword: 50,
  steel_sword: 150,
  wooden_shield: 20,
  leather_armor: 45,
  iron_armor: 120,
  health_potion: 10,
  mana_potion: 15,
  gold_coin: 1,
} as const satisfies Record<string, number>;

/** Default base price for unknown item IDs. */
const DEFAULT_BASE_PRICE = 10;

/**
 * Looks up the base price for a vendor item ID.
 */
const getBasePrice = (itemId: string): number => {
  return VENDOR_ITEM_BASE_PRICES[itemId] ?? DEFAULT_BASE_PRICE;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single chat message in the vendor haggling history. */
export type VendorChatMessage = {
  id: string;
  role: 'player' | 'vendor';
  content: string;
};

/** A purchasable item displayed in the vendor's inventory grid. */
export type VendorItemEntry = {
  /** Item ID (e.g. 'iron_sword'). */
  itemId: string;
  /** Display label for the item. */
  label: string;
  /** Base gold price (before multiplier). */
  basePrice: number;
};

export type VendorViewModelOptions = BaseViewModelOptions & {
  /** NPC ID of the vendor entity. */
  vendorId: string;
  /** Display name of the vendor (e.g. "Grimbold's Forge"). */
  vendorName: string;
  /** Comma-separated list of item IDs sold by this vendor. */
  vendorInventory: string;
  /** Called when the player closes the vendor UI. */
  onClose: () => void;
};

export type VendorViewModelInterface = BaseViewModelInterface & {
  /** Vendor name displayed in the header. */
  readonly vendorName: string;
  /** Chat history of haggling messages. */
  readonly messages: readonly VendorChatMessage[];
  /** Items available for purchase from this vendor. */
  readonly items: readonly VendorItemEntry[];
  /** Player's current gold balance. */
  readonly playerGold: number;
  /** Current price multiplier from AI haggling (1.0 = base price). */
  readonly priceMultiplier: number;
  /** Whether the vendor has refused to sell after an aggressive interaction. */
  readonly refusesToSell: boolean;
  /** Whether an AI haggle request is in progress (disables input). */
  readonly isHaggling: boolean;
  /** Whether a purchase is in progress (disables buy buttons). */
  readonly isBuying: boolean;
  /** Last transaction result message (success or error). */
  readonly transactionMessage: string | undefined;
  /** Whether the last transaction was successful (green) vs error (red). */
  readonly transactionSuccess: boolean;
  /**
   * Calculates the final price for an item after the current haggling
   * multiplier. Rounded down via Math.floor.
   */
  getFinalPrice(basePrice: number): number;
  /**
   * Sends a freeform haggling message to the AI. The LLM extracts
   * a VendorActionIntent (narrative, priceMultiplier, refusesToSell).
   */
  haggle(message: string): Promise<void>;
  /**
   * Attempts to buy the given item. Deducts gold, adds to inventory,
   * plays pickup SFX on success.
   */
  buyItem(itemId: string): Promise<void>;
  /** Closes the vendor overlay and resets the multiplier. */
  closeVendor(): void;
  /**
   * Returns the {@link ItemDefinition} for a given item ID.
   * Used by the view to show stat bonuses on equippable items.
   */
  getItemDef(itemId: string): import('$services').ItemDefinition;
};

// ---------------------------------------------------------------------------
// ViewModel implementation
// ---------------------------------------------------------------------------

class VendorViewModel
  extends BaseViewModel<VendorViewModelOptions>
  implements VendorViewModelInterface
{
  vendorName: string;

  messages = $state<VendorChatMessage[]>([]);

  items = $state<VendorItemEntry[]>([]);

  priceMultiplier = $state<number>(1.0);

  refusesToSell = $state<boolean>(false);

  isHaggling = $state<boolean>(false);

  isBuying = $state<boolean>(false);

  transactionMessage = $state<string | undefined>(undefined);

  transactionSuccess = $state<boolean>(false);

  private readonly _onClose: () => void;

  /** Timer reference for clearing the transaction message. */
  private _transactionMessageTimer: ReturnType<typeof setTimeout> | undefined;

  /** @inheritdoc */
  get playerGold(): number {
    return gameStateService.gold;
  }

  constructor(options: VendorViewModelOptions) {
    super(options);
    this.vendorName = options.vendorName;
    this._onClose = options.onClose;

    // Parse vendor inventory from comma-separated item IDs
    const itemIds = options.vendorInventory
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    this.debug('VendorViewModel:constructor', {
      vendorId: options.vendorId,
      vendorName: options.vendorName,
      rawInventory: options.vendorInventory,
      parsedItemIds: itemIds,
      playerGold: gameStateService.gold,
    });

    this.items = itemIds.map((itemId) => {
      const definition: ItemDefinition = getItemDefinition(itemId);
      const basePrice = getBasePrice(itemId);
      return {
        itemId,
        label: definition.label,
        basePrice,
      };
    });

    this.debug('VendorViewModel:itemsParsed', {
      items: this.items.map((i) => `${i.itemId}=${i.basePrice}g`),
      playerGold: gameStateService.gold,
    });
  }

  /** @inheritdoc */
  getFinalPrice(basePrice: number): number {
    return Math.floor(basePrice * this.priceMultiplier);
  }

  /** @inheritdoc */
  async haggle(message: string): Promise<void> {
    this.debug('haggle:entry', {
      isHaggling: this.isHaggling,
      refusesToSell: this.refusesToSell,
      messageLength: message.length,
    });
    if (this.isHaggling || this.refusesToSell) {
      this.debug('haggle:blocked', {
        isHaggling: this.isHaggling,
        refusesToSell: this.refusesToSell,
      });
      return;
    }
    if (!message.trim()) {
      this.debug('haggle:empty-message');
      return;
    }

    this.isHaggling = true;

    // Add player message to chat
    this.messages = [
      ...this.messages,
      { id: crypto.randomUUID(), role: 'player', content: message },
    ];

    try {
      const contextualPrompt = this._buildHagglePrompt(message);

      this.debug('haggle: calling extractStructure', {
        message: message.slice(0, 50),
        promptLength: contextualPrompt.length,
      });

      const raw = await textGenerationService.extractStructure({
        schema: VendorActionSchema as unknown as Record<string, unknown>,
        schemaName: 'VendorActionIntent',
        prompt: contextualPrompt,
        systemPrompt: VENDOR_ACTION_SYSTEM_PROMPT,
      });

      const intent = raw as VendorActionIntent;

      // Log full AI response for debugging (appears in tmux via $logger)
      this.debug('haggle: LLM response (full)', {
        priceMultiplier: intent.priceMultiplier,
        refusesToSell: intent.refusesToSell,
        itemToBuy: intent.itemToBuy,
        narrative: intent.narrative ? intent.narrative.slice(0, 100) : '',
      });

      // Clamp multiplier to safe range
      const clampedMultiplier = Math.max(0.5, Math.min(1.5, intent.priceMultiplier));

      this.priceMultiplier = clampedMultiplier;
      this.refusesToSell = intent.refusesToSell;

      // Add vendor response to chat
      this.messages = [
        ...this.messages,
        { id: crypto.randomUUID(), role: 'vendor', content: intent.narrative },
      ];

      // Auto-buy when the AI detects purchase intent
      if (intent.itemToBuy && !this.refusesToSell) {
        const validItem = this.items.find((i) => i.itemId === intent.itemToBuy);
        if (validItem) {
          this.debug('haggle: auto-buy triggered', { itemToBuy: intent.itemToBuy });
          await this.buyItem(intent.itemToBuy);
        } else {
          this.debug('haggle: auto-buy skipped (item not in vendor inventory)', {
            itemToBuy: intent.itemToBuy,
          });
        }
      }
    } catch (error) {
      this.debug('haggle:failed', { error: String(error) });
      this.messages = [
        ...this.messages,
        {
          id: crypto.randomUUID(),
          role: 'vendor',
          content: '...',
        },
      ];
    } finally {
      this.debug('haggle:finally', {
        isHaggling: this.isHaggling,
        isBuying: this.isBuying,
        refusesToSell: this.refusesToSell,
      });
      this.isHaggling = false;
    }
  }

  /** @inheritdoc */
  async buyItem(itemId: string): Promise<void> {
    this.debug('buyItem:entry', {
      itemId,
      isBuying: this.isBuying,
      refusesToSell: this.refusesToSell,
      playerGold: gameStateService.gold,
      priceMultiplier: this.priceMultiplier,
    });
    if (this.isBuying || this.refusesToSell) {
      this.debug('buyItem:blocked', { isBuying: this.isBuying, refusesToSell: this.refusesToSell });
      return;
    }

    const entry = this.items.find((i) => i.itemId === itemId);
    if (!entry) {
      this.debug('buyItem:item-not-found', { itemId });
      return;
    }

    const finalPrice = this.getFinalPrice(entry.basePrice);
    this.debug('buyItem:price-calculated', {
      itemId,
      basePrice: entry.basePrice,
      finalPrice,
      playerGold: gameStateService.gold,
    });

    if (gameStateService.gold < finalPrice) {
      this.debug('buyItem:insufficient-gold', { needed: finalPrice, have: gameStateService.gold });
      this._showTransactionMessage(
        `Not enough gold! Need ${finalPrice}, have ${gameStateService.gold}.`,
        false,
      );
      return;
    }

    this.isBuying = true;
    this.debug('buyItem:executing', {
      itemId,
      finalPrice,
      goldBefore: gameStateService.gold,
      inventoryBefore: [...gameStateService.inventory],
    });

    try {
      gameStateService.removeGold({ amount: finalPrice });
      this.debug('buyItem:gold-removed', { removed: finalPrice, goldAfter: gameStateService.gold });

      // Add item to inventory via direct push (ECS syncs separately)
      const inventory = gameStateService.inventory;
      const existingIndex = inventory.findIndex((i) => i.itemId === itemId);
      if (existingIndex >= 0) {
        inventory[existingIndex] = {
          itemId,
          quantity: inventory[existingIndex].quantity + 1,
        };
      } else {
        inventory.push({ itemId, quantity: 1 });
      }
      // Trigger reactivity by reassigning
      gameStateService.inventory = [...inventory];
      this.debug('buyItem:inventory-updated', { inventoryAfter: [...gameStateService.inventory] });

      // Play pickup SFX
      void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');

      const definition = getItemDefinition(itemId);
      this._showTransactionMessage(`Purchased ${definition.label} for ${finalPrice} gold!`, true);
      this.debug('buyItem:complete', {
        itemId,
        finalPrice,
        gold: gameStateService.gold,
        inventorySize: gameStateService.inventory.length,
      });
    } catch (error) {
      this.debug('buyItem:failed', { itemId, error: String(error) });
      this._showTransactionMessage('Transaction failed. Please try again.', false);
    } finally {
      this.isBuying = false;
    }
  }

  /** @inheritdoc */
  closeVendor(): void {
    // Reset multiplier on close (per contract: "reset it on close")
    this.priceMultiplier = 1.0;
    this.refusesToSell = false;
    this._onClose();
  }

  /** @inheritdoc */
  getItemDef(itemId: string): import('$services').ItemDefinition {
    return getItemDefinition(itemId);
  }

  /** @inheritdoc */
  async dispose(): Promise<void> {
    if (this._transactionMessageTimer) {
      clearTimeout(this._transactionMessageTimer);
    }
    await super.dispose();
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Shows a temporary transaction message that auto-clears after 3 seconds.
   */
  private _showTransactionMessage(message: string, success: boolean): void {
    if (this._transactionMessageTimer) {
      clearTimeout(this._transactionMessageTimer);
    }
    this.transactionMessage = message;
    this.transactionSuccess = success;
    this._transactionMessageTimer = setTimeout(() => {
      this.transactionMessage = undefined;
    }, 3000);
  }

  /**
   * Builds a contextual prompt for the LLM that includes the player's
   * haggling message, current prices, and vendor personality context.
   */
  private _buildHagglePrompt(playerMessage: string): string {
    const inventorySummary = this.items
      .map((item) => `${item.label} (${item.basePrice} gold)`)
      .join(', ');

    return `Vendor: ${this.vendorName}
Items for sale: ${inventorySummary}
Current price multiplier: ${this.priceMultiplier.toFixed(2)}x
Player's gold: ${this.playerGold}

Player says: "${playerMessage}"

Respond as the vendor.`;
  }
}

export { VendorViewModel };
