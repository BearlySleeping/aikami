// apps/e2e/src/pom/play_shell_page.ts
// Production play-shell readiness and management navigation.

import type { Page } from '@playwright/test';

export class PlayShellPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get canvasContainer() {
    return this.page.locator('#game-canvas-container');
  }

  get managementMenuEntry() {
    return this.page.getByTestId('hud-menu-entry');
  }

  get managementHost() {
    return this.page.getByTestId('management-host');
  }

  /** Open the production play shell and wait for its management entry point. */
  async open(): Promise<void> {
    await this.page.goto('/game');
    await this.canvasContainer.waitFor({ state: 'attached', timeout: 30_000 });
    await this.managementMenuEntry.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Activate the management host and wait until it owns the UI. */
  async openManagementHost(): Promise<void> {
    await this.managementMenuEntry.click();
    await this.managementHost.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** Activate a management section through the production section rail. */
  async openManagementSection(section: string): Promise<void> {
    await this.page.getByTestId(`section-tab-${section}`).click();
  }
}
