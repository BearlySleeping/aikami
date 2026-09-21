// apps/e2e/src/pom/onboarding_page.ts
//
// Page object for production onboarding routes and their preset/AI paths.

import { expect, type Locator, type Page } from '@playwright/test';

/** Encapsulates production onboarding selectors and user actions. */
export class OnboardingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get chooseYourHeroHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Choose Your Hero' });
  }

  get readyToGoHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Ready to Go?' });
  }

  get enterWorldButton(): Locator {
    return this.page.getByRole('button', { name: /Enter World/ });
  }

  get customizeEverythingButton(): Locator {
    return this.page.getByRole('button', { name: 'Customize Everything' });
  }

  get chatWithDmButton(): Locator {
    return this.page.getByRole('button', { name: /Chat with the DM/ });
  }

  get chatPrompt(): Locator {
    return this.page.locator('textarea').first();
  }

  get sendButton(): Locator {
    return this.page.getByRole('button', { name: 'Send' });
  }

  get generateCharacterButton(): Locator {
    return this.page.getByRole('button', { name: /Generate Character/ });
  }

  starterHeroButton(name: string): Locator {
    return this.page.locator('button').filter({ hasText: name }).first();
  }

  motivationButton(name: string): Locator {
    return this.page.getByRole('button', { name });
  }

  async expectChooseYourHeroVisible(timeout = 10_000): Promise<void> {
    await expect(this.chooseYourHeroHeading).toBeVisible({ timeout });
  }

  async expectReadyToGoVisible(timeout = 10_000): Promise<void> {
    await expect(this.readyToGoHeading).toBeVisible({ timeout });
  }

  async expectEnterWorldVisible(): Promise<void> {
    await expect(this.enterWorldButton).toBeVisible();
  }

  async expectCustomizeEverythingVisible(): Promise<void> {
    await expect(this.customizeEverythingButton).toBeVisible();
  }

  async selectStarterHero(name: string): Promise<void> {
    await this.starterHeroButton(name).click();
  }

  async selectMotivation(name: string): Promise<void> {
    await this.motivationButton(name).click();
  }

  async enterWorld(): Promise<void> {
    await this.enterWorldButton.click();
  }

  async startChat(): Promise<void> {
    await this.chatWithDmButton.click();
  }

  async expectChatPromptVisible(timeout = 10_000): Promise<void> {
    await expect(this.chatPrompt).toBeVisible({ timeout });
  }

  async sendChatPrompt(prompt: string): Promise<void> {
    await this.chatPrompt.fill(prompt);
    await this.sendButton.click();
  }

  async expectGenerateCharacterVisible(timeout = 15_000): Promise<void> {
    await expect(this.generateCharacterButton).toBeVisible({ timeout });
  }

  async generateCharacter(): Promise<void> {
    await this.generateCharacterButton.click();
  }
}
