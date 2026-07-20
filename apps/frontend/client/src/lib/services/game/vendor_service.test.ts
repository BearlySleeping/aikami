// apps/frontend/client/src/lib/services/game/vendor_service.test.ts
//
// Unit tests for VendorService — buy/sell, transaction validation,
// pricing from content-pack catalog, deterministic sell floor, and
// idle-degraded authored fallback lines.
//
// Contract C-331 AC-3.

import { beforeEach, describe, expect, test } from 'bun:test';
import { inventoryService } from './inventory_service.svelte';
// Import vendor service by direct module path so we exercise the real
// getItemDefinition + pricing logic (the $services barrel mock replaces
// getItemDefinition with a stub that omits basePrice).
import { vendorService } from './vendor_service.svelte';

describe('VendorService', () => {
  beforeEach(() => {
    inventoryService.reset();
    vendorService.close(); // clear any stale session state
    inventoryService.addItem({ itemId: 'wardShard', quantity: 2 });
    vendorService.startSession({
      vendorId: 'traveling_merchant',
      vendorName: 'Keth',
      vendorInventory: 'ironSword,healthPotion',
    });
  });

  // ── Buy (AC-3) ────────────────────────────────────────────────────

  test('buyItem deducts gold and adds item to inventory', async () => {
    // basePrice of ironSword = 50, multiplier = 1.0
    const goldBefore = inventoryService.gold;
    await vendorService.buyItem('ironSword');
    // Gold tracked via inventoryService; wait for next tick if async
    // buyItem is async but operations are sync — verify result
    expect(inventoryService.gold).toBe(goldBefore - 50);
    const sword = inventoryService.inventory.find((e) => e.itemId === 'ironSword');
    expect(sword).toBeDefined();
  });

  test('buyItem rejects when insufficient gold', async () => {
    // Spend all gold
    inventoryService.removeGold({ amount: inventoryService.gold });
    inventoryService.addGold({ amount: 30 });
    await vendorService.buyItem('ironSword');
    expect(inventoryService.inventory.find((e) => e.itemId === 'ironSword')).toBeUndefined();
    expect(inventoryService.gold).toBe(30); // unchanged
  });

  test('buyItem rejects when inventory full (capacity enforced)', async () => {
    // Fill inventory to 24 distinct stacks
    for (let i = 0; i < 24; i++) {
      inventoryService.addItem({ itemId: `filler_${i}`, enforceCapacity: true });
    }
    const goldBefore = inventoryService.gold;
    await vendorService.buyItem('ironSword');
    expect(inventoryService.inventory.length).toBe(24);
    expect(inventoryService.gold).toBe(goldBefore); // no charge
  });

  // ── Sell (AC-3) ───────────────────────────────────────────────────

  test('getSellPrice returns floor(basePrice × 0.5)', () => {
    // ironSword basePrice = 50 → sell floor = 25
    expect(vendorService.getSellPrice('ironSword')).toBe(25);
    // wardShard basePrice = 30 → sell floor = 15
    expect(vendorService.getSellPrice('wardShard')).toBe(15);
  });

  test('getSellPrice is haggle-independent', () => {
    vendorService.priceMultiplier = 0.5; // AI haggled down
    expect(vendorService.getSellPrice('ironSword')).toBe(25); // still 25
  });

  test('sellItem adds gold and removes item from inventory', () => {
    const goldBefore = inventoryService.gold;
    const shardEntry = inventoryService.inventory.find((e) => e.itemId === 'wardShard');
    expect(shardEntry).toBeDefined();
    expect(shardEntry?.quantity).toBe(2);

    vendorService.sellItem('wardShard');
    expect(inventoryService.gold).toBe(goldBefore + 15);
    const afterSell = inventoryService.inventory.find((e) => e.itemId === 'wardShard');
    expect(afterSell?.quantity).toBe(1);
  });

  test('sellItem rejects item with zero basePrice', () => {
    // wardPendant has basePrice = 0, add it to inventory
    inventoryService.addItem({ itemId: 'wardPendant', quantity: 1 });
    const goldBefore = inventoryService.gold;
    const wardPendantBefore = inventoryService.inventory.find((e) => e.itemId === 'wardPendant');
    expect(wardPendantBefore).toBeDefined();

    vendorService.sellItem('wardPendant');
    expect(inventoryService.gold).toBe(goldBefore); // unchanged
    const wardPendantAfter = inventoryService.inventory.find((e) => e.itemId === 'wardPendant');
    expect(wardPendantAfter?.quantity).toBe(1); // unchanged
  });

  test('sellItem rejects item not owned', () => {
    const goldBefore = inventoryService.gold;
    vendorService.sellItem('steelSword'); // not in inventory
    expect(inventoryService.gold).toBe(goldBefore);
  });

  // ── Transaction atomicity (AC-3) ───────────────────────────────────

  test.skip('buyItem atomic — no partial gold deduction on inventory-full', async () => {
    // This test exercises the real capacity enforcement which requires
    // the actual addItem implementation (not the test_preload mock).
    // Covered by the 'buyItem rejects when inventory full' test above
    // which imports the real inventory and vendor services.
    for (let i = 0; i < 24; i++) {
      inventoryService.addItem({ itemId: `filler_${i}` });
    }
    const goldBefore = inventoryService.gold;
    await vendorService.buyItem('ironSword');
    expect(inventoryService.gold).toBe(goldBefore);
    expect(inventoryService.inventory.length).toBe(24);
  });

  // ── Authored fallback (AC-3) ──────────────────────────────────────

  test('configureFallback provides authored line on haggle failure', async () => {
    // Configure fallback line
    vendorService.configureFallback({
      getVendorLine: (vendorId) =>
        vendorId === 'traveling_merchant' ? 'Welcome, traveler!' : undefined,
    });

    // Mock the text generator to reject
    const originalHaggle = vendorService.haggle.bind(vendorService);
    let fallbackTriggered = false;
    vendorService.haggle = async (message: string) => {
      // Force an error to trigger fallback
      const mockGenerator = async () => {
        throw new Error('AI unavailable');
      };
      vendorService._textGenerator = mockGenerator;
      await originalHaggle(message);
      fallbackTriggered = true;
    };

    await vendorService.haggle('Can you lower the price?');
    expect(fallbackTriggered).toBe(true);
    const lastMessage = vendorService.messages[vendorService.messages.length - 1];
    expect(lastMessage.content).toBe('Welcome, traveler!');
  });

  // ── Player gold getter ─────────────────────────────────────────────

  test('playerGold reflects inventoryService gold', () => {
    expect(vendorService.playerGold).toBe(inventoryService.gold);
    inventoryService.addGold({ amount: 10 });
    expect(vendorService.playerGold).toBe(inventoryService.gold);
  });
});
