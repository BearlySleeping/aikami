// apps/frontend/client/src/lib/views/vendor/vendor_view_model.dev.svelte.ts
//
// Dev sandbox override — injects mock vendor state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.

import { getVendorViewModel, type VendorViewModelInterface } from './vendor_view_model.svelte';

const MOCK_VENDOR_RESPONSES = [
  {
    narrative: 'A discount? Hmph. I suppose I can knock off 10% for a fellow adventurer.',
    priceMultiplier: 0.9,
    refusesToSell: false,
  },
  {
    narrative: "You saved the village, didn't you? Half price — don't tell the guild!",
    priceMultiplier: 0.5,
    refusesToSell: false,
  },
  {
    narrative: 'Fair prices for fair folk. No discounts today, friend.',
    priceMultiplier: 1.0,
    refusesToSell: false,
  },
  {
    narrative:
      "You DARE threaten me?! Get out of my shop before I call the guards! I won't sell you a THING!",
    priceMultiplier: 1.5,
    refusesToSell: true,
  },
  {
    narrative: 'Watch your tone, stranger. My prices just went up 20% for your rudeness.',
    priceMultiplier: 1.2,
    refusesToSell: false,
  },
];

let mockResponseIndex = 0;

export const getVendorDevViewModel = (
  options: { className: string; vendorId: string; vendorName: string; vendorInventory: string },
): VendorViewModelInterface => {
  const vm = getVendorViewModel(options) as VendorViewModelInterface & {
    isHaggling: boolean;
    refusesToSell: boolean;
    messages: Array<{ id: string; role: 'player' | 'vendor'; content: string }>;
    priceMultiplier: number;
  };

  const _originalHaggle = vm.haggle.bind(vm);
  vm.haggle = async (message: string) => {
    const self = vm as unknown as {
      isHaggling: boolean;
      refusesToSell: boolean;
      messages: Array<{ id: string; role: 'player' | 'vendor'; content: string }>;
      priceMultiplier: number;
    };

    if (self.isHaggling || self.refusesToSell || !message.trim()) {
      return;
    }

    self.isHaggling = true;

    try {
      self.messages = [
        ...self.messages,
        { id: crypto.randomUUID(), role: 'player', content: message },
      ];
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = MOCK_VENDOR_RESPONSES[mockResponseIndex % MOCK_VENDOR_RESPONSES.length];
      mockResponseIndex++;

      self.priceMultiplier = response.priceMultiplier;
      self.refusesToSell = response.refusesToSell;
      self.messages = [
        ...self.messages,
        { id: crypto.randomUUID(), role: 'vendor', content: response.narrative },
      ];
    } finally {
      self.isHaggling = false;
    }
  };

  return vm;
};
