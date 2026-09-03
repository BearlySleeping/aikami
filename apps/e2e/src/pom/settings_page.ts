// apps/e2e/src/pom/settings_page.ts
//
// Page object model for the grouped settings shell.

import type { Locator, Page } from '@playwright/test';

/** Encapsulates settings navigation and stable selectors for grouped tabs. */
export class SettingsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** All top-level settings group tabs. */
  get groupTabs(): Locator {
    return this.page.getByRole('tablist', { name: 'Settings groups' }).getByRole('tab');
  }

  /** All section tabs in the active settings group. */
  get sectionTabs(): Locator {
    return this.page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab');
  }

  /** The AI connection heading shown by the default AI section. */
  get aiConnectionHeading(): Locator {
    return this.page.getByRole('heading', { name: 'AI Connection' });
  }

  /** The reset action shown by resettable settings sections. */
  get resetToDefaultsButton(): Locator {
    return this.page.getByRole('button', { name: /Reset to Defaults/ });
  }

  /** Find a top-level settings group tab by its visible label. */
  groupTab(label: string): Locator {
    return this.groupTabs.filter({ hasText: label });
  }

  /** Find a section tab in the active group by its visible label. */
  sectionTab(label: string): Locator {
    return this.sectionTabs.filter({ hasText: label });
  }

  /** Open the settings page and wait for its shell to render. */
  async goto(): Promise<void> {
    await this.page.goto('/settings');
    await this.page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  }

  /** Activate the AI settings group. */
  async selectAIGroup(): Promise<void> {
    await this.groupTab('AI').click();
  }

  /** Activate the Controls section in the Play group. */
  async selectControlsTab(): Promise<void> {
    await this.sectionTab('Controls').click();
  }

  /** Activate the Gameplay section in the Play group. */
  async selectGameplayTab(): Promise<void> {
    await this.sectionTab('Gameplay').click();
  }
}
