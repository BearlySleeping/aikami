// apps/frontend/client/src/lib/views/vendor/vendor_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock vendor state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.
//
// Overrides haggle() with mock AI responses so the sandbox works without
// a configured LLM provider.
//
// Contract: C-154 AI Vendors Economy

import { VendorViewModel, type VendorViewModelOptions } from './vendor_view_model.svelte';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_VENDOR_RESPONSES: Array<{
  narrative: string;
  priceMultiplier: number;
  refusesToSell: boolean;
}> = [
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

// ---------------------------------------------------------------------------
// Dev ViewModel
// ---------------------------------------------------------------------------

export type VendorDevViewModelOptions = VendorViewModelOptions & {};

export class VendorDevViewModel extends VendorViewModel {
  /** @inheritdoc */
  async haggle(message: string): Promise<void> {
    if (this.isHaggling || this.refusesToSell || !message.trim()) {
      return;
    }

    this.isHaggling = true;

    try {
      const self = this as unknown as {
        messages: Array<{ id: string; role: 'player' | 'vendor'; content: string }>;
        priceMultiplier: number;
        refusesToSell: boolean;
      };

      self.messages = [
        ...self.messages,
        { id: crypto.randomUUID(), role: 'player', content: message },
      ];

      // Simulate AI delay
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
      this.isHaggling = false;
    }
  }
}
