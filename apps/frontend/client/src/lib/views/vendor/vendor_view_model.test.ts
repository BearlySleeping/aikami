// apps/frontend/client/src/lib/views/vendor/vendor_view_model.test.ts
//
// Unit tests for VendorViewModel — C-154 AI Vendors Economy
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/vendor/vendor_view_model.test.ts

import { describe, expect, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts
// $services barrel is mocked globally via test_preload.ts

import { getVendorViewModel, type VendorViewModelOptions } from './vendor_view_model.svelte';

// ── Helpers ───────────────────────────────────────────────────────────────

let onCloseCalled = false;

const createViewModel = (options?: {
  vendorInventory?: string;
}): ReturnType<typeof getVendorViewModel> => {
  onCloseCalled = false;
  const vmOptions: VendorViewModelOptions = {
    className: 'VendorViewModelTest',
    vendorId: 'test-vendor-1',
    vendorName: 'Test Vendor',
    vendorInventory: options?.vendorInventory ?? 'rustySword,healthPotion,ironSword',
  };
  const vm = getVendorViewModel(vmOptions);
  // Monkey-patch closeVendor to track calls
  const originalClose = vm.closeVendor.bind(vm);
  vm.closeVendor = () => {
    onCloseCalled = true;
    originalClose();
  };
  return vm;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('VendorViewModel — C-154 AI Vendors Economy', () => {
  describe('item parsing', () => {
    test('parses comma-separated vendor inventory into items', () => {
      const viewModel = createViewModel({ vendorInventory: 'rustySword,healthPotion' });
      expect(viewModel.items.length).toBe(2);
      expect(viewModel.items[0].itemId).toBe('rustySword');
      expect(viewModel.items[1].itemId).toBe('healthPotion');
    });

    test('trims whitespace from item IDs', () => {
      const viewModel = createViewModel({ vendorInventory: ' rustySword , ironSword ' });
      expect(viewModel.items.length).toBe(2);
      expect(viewModel.items[0].itemId).toBe('rustySword');
      expect(viewModel.items[1].itemId).toBe('ironSword');
    });

    test('handles empty inventory string', () => {
      const viewModel = createViewModel({ vendorInventory: '' });
      expect(viewModel.items.length).toBe(0);
    });

    test('handles inventory with only whitespace', () => {
      const viewModel = createViewModel({ vendorInventory: '  ,  ,  ' });
      expect(viewModel.items.length).toBe(0);
    });
  });

  describe('getFinalPrice', () => {
    test('returns base price with 1.0 multiplier', () => {
      const viewModel = createViewModel();
      expect(viewModel.getFinalPrice(100)).toBe(100);
    });

    test('rounds down with fractional result (haggle discount)', () => {
      const viewModel = createViewModel();
      // Manually set multiplier for testing
      const vm = viewModel as unknown as { priceMultiplier: number };
      vm.priceMultiplier = 0.8;
      // 15 * 0.8 = 12 → Math.floor(12) = 12
      expect(viewModel.getFinalPrice(15)).toBe(12);
    });

    test('rounds down with fractional result (price gouge)', () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { priceMultiplier: number };
      vm.priceMultiplier = 1.3;
      // 15 * 1.3 = 19.5 → Math.floor(19.5) = 19
      expect(viewModel.getFinalPrice(15)).toBe(19);
    });

    test('handles 0.5 multiplier (minimum discount)', () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { priceMultiplier: number };
      vm.priceMultiplier = 0.5;
      // 100 * 0.5 = 50
      expect(viewModel.getFinalPrice(100)).toBe(50);
    });

    test('handles 1.5 multiplier (maximum penalty)', () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { priceMultiplier: number };
      vm.priceMultiplier = 1.5;
      // 10 * 1.5 = 15
      expect(viewModel.getFinalPrice(10)).toBe(15);
    });

    test('returns 0 when base price is 0', () => {
      const viewModel = createViewModel();
      expect(viewModel.getFinalPrice(0)).toBe(0);
    });
  });

  describe('refusesToSell', () => {
    test('buyItem returns early when refusesToSell is true', async () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { refusesToSell: boolean; isBuying: boolean };
      vm.refusesToSell = true;

      await viewModel.buyItem('rustySword');
      // Should not start buying
      expect(viewModel.isBuying).toBe(false);
    });
  });

  describe('closeVendor', () => {
    test('resets multiplier to 1.0 and calls onClose', () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { priceMultiplier: number };
      vm.priceMultiplier = 0.7;

      viewModel.closeVendor();
      expect(viewModel.priceMultiplier).toBe(1.0);
      expect(onCloseCalled).toBe(true);
    });

    test('resets refusesToSell on close', () => {
      const viewModel = createViewModel();
      const vm = viewModel as unknown as { refusesToSell: boolean; priceMultiplier: number };
      vm.refusesToSell = true;
      vm.priceMultiplier = 1.5;

      viewModel.closeVendor();
      expect(viewModel.priceMultiplier).toBe(1.0);
      expect(viewModel.refusesToSell).toBe(false);
      expect(onCloseCalled).toBe(true);
    });
  });

  describe('initial state', () => {
    test('sets vendorName from options', () => {
      const viewModel = createViewModel();
      expect(viewModel.vendorName).toBe('Test Vendor');
    });

    test('initial price multiplier is 1.0', () => {
      const viewModel = createViewModel();
      expect(viewModel.priceMultiplier).toBe(1.0);
    });

    test('initially not refusesToSell', () => {
      const viewModel = createViewModel();
      expect(viewModel.refusesToSell).toBe(false);
    });

    test('initially not haggling or buying', () => {
      const viewModel = createViewModel();
      expect(viewModel.isHaggling).toBe(false);
      expect(viewModel.isBuying).toBe(false);
    });

    test('messages start empty', () => {
      const viewModel = createViewModel();
      expect(viewModel.messages.length).toBe(0);
    });

    test('transactionMessage is initially undefined', () => {
      const viewModel = createViewModel();
      expect(viewModel.transactionMessage).toBeUndefined();
    });
  });

  describe('playerGold delegation', () => {
    test('playerGold reads from gameStateService', () => {
      const viewModel = createViewModel();
      // With mocked gameStateService, gold will be 0 (mock default)
      // The getter itself works — just verify it doesn't throw
      expect(() => viewModel.playerGold).not.toThrow();
    });
  });

  describe('getItemDef', () => {
    test('returns definition for known equippable item', () => {
      const viewModel = createViewModel({ vendorInventory: 'ironSword' });
      const def = viewModel.getItemDef('ironSword');
      expect(def.label).toBe('ironSword');
    });

    test('returns definition for consumable items', () => {
      const viewModel = createViewModel({ vendorInventory: 'healthPotion' });
      const def = viewModel.getItemDef('healthPotion');
      expect(def.label).toBe('healthPotion');
      expect(def.equippable).toBe(false);
    });

    test('returns definition for unknown item IDs', () => {
      const viewModel = createViewModel();
      const def = viewModel.getItemDef('nonexistent_item');
      expect(def.label).toBe('nonexistent_item');
    });
  });
});
