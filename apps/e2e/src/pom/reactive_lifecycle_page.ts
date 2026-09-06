// apps/e2e/src/pom/reactive_lifecycle_page.ts
// Page Object Model for the compiled reactive lifecycle test sandbox.

import type { Locator, Page } from '@playwright/test';

export class ReactiveLifecyclePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──

  async goto(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/reactive-lifecycle', {
      waitUntil: 'domcontentloaded',
    });
  }

  // ── Locators ──

  get countDisplay(): Locator {
    return this.page.getByTestId('count-display');
  }

  get doubledDisplay(): Locator {
    return this.page.getByTestId('doubled-display');
  }

  get labelDisplay(): Locator {
    return this.page.getByTestId('label-display');
  }

  get tickDisplay(): Locator {
    return this.page.getByTestId('tick-display');
  }

  get asyncStatus(): Locator {
    return this.page.getByTestId('async-status');
  }

  get asyncResult(): Locator {
    return this.page.getByTestId('async-result');
  }

  get incrementButton(): Locator {
    return this.page.getByTestId('btn-increment');
  }

  get decrementButton(): Locator {
    return this.page.getByTestId('btn-decrement');
  }

  get resetButton(): Locator {
    return this.page.getByTestId('btn-reset');
  }

  get asyncFastButton(): Locator {
    return this.page.getByTestId('btn-async-fast');
  }

  get asyncSlowButton(): Locator {
    return this.page.getByTestId('btn-async-slow');
  }

  get disposeButton(): Locator {
    return this.page.getByTestId('btn-dispose');
  }

  // ── Convenience helpers ──

  /** Extract the numeric count value from the count-display text. */
  async getCount(): Promise<number> {
    const text = await this.countDisplay.textContent();
    const match = text?.match(/Count:\s*(-?\d+)/);
    return match ? Number(match[1]) : Number.NaN;
  }

  /** Extract the numeric doubled value from the doubled-display text. */
  async getDoubled(): Promise<number> {
    const text = await this.doubledDisplay.textContent();
    const match = text?.match(/Doubled:\s*(-?\d+)/);
    return match ? Number(match[1]) : Number.NaN;
  }
}
