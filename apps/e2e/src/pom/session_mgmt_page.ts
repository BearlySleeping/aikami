// apps/e2e/src/pom/session_mgmt_page.ts
// Page Object Model — SessionMgmtPage
//
// Encapsulates locators and interaction primitives for the Session Management
// dev sandbox (/dev/session).
//
// Contract: C-240 Session Management

import type { Page } from '@playwright/test';

export class SessionMgmtPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the session management dev sandbox. */
  async gotoDev(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/session', {
      waitUntil: 'domcontentloaded',
    });
    await this.waitReady();
  }

  /** Wait for the sandbox page to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('h1', { timeout: 10_000 });
  }

  // ── Action Buttons ────────────────────────────────────────

  get startSessionButton() {
    return this.page.getByRole('button', { name: 'Start Session' });
  }

  get endSessionButton() {
    return this.page.getByRole('button', { name: 'End Session' });
  }

  get newSessionButton() {
    return this.page.getByRole('button', { name: 'New Session' });
  }

  get loadSessionsButton() {
    return this.page.getByRole('button', { name: 'Load Sessions' });
  }

  get addMessagesButton() {
    return this.page.getByRole('button', { name: '+10 Messages' });
  }

  get clearLogButton() {
    return this.page.getByRole('button', { name: 'Clear' });
  }

  // ── Status card value locators ────────────────────────────

  /** The paragraph showing the Active Session value. */

  get mockMessageAlert() {
    return this.page.locator('.alert-info');
  }

  get logEntries() {
    return this.page.locator('.font-mono.text-xs');
  }

  // ── Actions ───────────────────────────────────────────────

  /** Clicks Start Session and waits for state update. */
  async clickStartSession(): Promise<void> {
    await this.startSessionButton.click();
    const { expect } = await import('@playwright/test');
    await expect(this.endSessionButton).toBeEnabled({ timeout: 5000 });
  }

  /** Clicks End Session and waits for chat to lock. */
  async clickEndSession(): Promise<void> {
    await this.endSessionButton.click();
    const { expect } = await import('@playwright/test');
    // Wait for Chat Locked to change to "Yes" (red text)
    await expect(this.page.locator('p.text-error')).toBeVisible({ timeout: 10_000 });
  }

  /** Clicks New Session and waits for chat to unlock. */
  async clickNewSession(): Promise<void> {
    await this.newSessionButton.click();
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('p.text-success')).toBeVisible({ timeout: 10_000 });
  }

  // ── Assertions ────────────────────────────────────────────

  /** Expects the sandbox heading to be visible. */
  async expectHeadingVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('h1')).toContainText('Session Management Sandbox');
  }

  /** Expects the initial idle state. */
  async expectInitialState(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText('—')).toBeVisible();
    // Chat Locked section shows "No" — but "No" appears in other contexts too.
    // Use a more specific assertion: the Chat Locked status card shows "No" with classes.
    await expect(this.page.locator('p.text-success')).toBeVisible();
    // Saved Sessions shows "0"
    await expect(this.page.getByText('0', { exact: true })).toBeVisible();
    await expect(this.endSessionButton).toBeDisabled();
  }

  /** Expects End Session button to be disabled. */
  async expectEndSessionDisabled(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.endSessionButton).toBeDisabled();
  }

  /** Expects the test log to contain the given text. */
  async expectLogContains(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.logEntries.last()).toContainText(text);
  }
}
