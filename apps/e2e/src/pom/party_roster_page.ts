// apps/e2e/src/pom/party_roster_page.ts
// Page Object Model — PartyRosterPage

import type { Page } from '@playwright/test';

/** Encapsulates party-roster HUD and overlay interactions. */
export class PartyRosterPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the party roster with its keyboard shortcut. */
  async open(): Promise<void> {
    await this.page.keyboard.press('KeyP');
  }

  /** Closes the active party-roster overlay. */
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  /** Party HUD button, hidden when the roster is empty. */
  get hudButton() {
    return this.page.locator('[aria-label="Open party roster"]');
  }

  /** Party-roster overlay root. */
  get overlay() {
    return this.page.locator('[aria-label="Party Roster"]');
  }

  /** Empty-roster message shown inside the overlay. */
  get emptyState() {
    return this.page.getByText('No companions');
  }
}
