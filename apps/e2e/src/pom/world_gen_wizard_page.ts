// apps/e2e/src/pom/world_gen_wizard_page.ts
// Page Object Model — WorldGenWizardPage
//
// Encapsulates locators and interaction primitives for the World Generation
// Wizard (C-233). Provides step-aware selectors, form fillers, and
// navigation helpers for the Genre/Tone → Setting/Difficulty → Goals →
// Generating → Preview → Character Creation flow.
//
// DOM reference:
//   apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view.svelte
//   apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts

import type { Page } from '@playwright/test';

/**
 * Step names in the wizard state machine.
 */
export type WizardStep =
  | 'genre_tone'
  | 'setting_difficulty'
  | 'goals'
  | 'generating'
  | 'preview'
  | 'character_creation';

/**
 * Page Object Model for the World Generation Wizard.
 */
export class WorldGenWizardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /**
   * Navigate to the setup page (wizard entry point) and wait for render.
   */
  async gotoSetup(): Promise<void> {
    await this.page.goto('/setup');
    await this.page.locator('progress.progress').waitFor({ timeout: 10000 });
  }

  /**
   * Navigate to the dev sandbox and wait for the wizard to render.
   */
  async gotoDevSandbox(): Promise<void> {
    await this.page.goto('/dev/world-gen');
    // Wait for the wizard to fully render (progress bar appears after VM init)
    await this.page.locator('progress.progress').waitFor({ timeout: 10000 });
  }

  // ── Step detection ────────────────────────────────────────

  /**
   * Get the current step title text.
   */
  async getCurrentStepLabel(): Promise<string> {
    return await this.page.locator('h2').first().innerText();
  }

  /**
   * Check if the progress bar is visible.
   */
  async isProgressBarVisible(): Promise<boolean> {
    return await this.page.locator('progress.progress').isVisible();
  }

  /**
   * Get the progress bar value.
   */
  async getProgressValue(): Promise<number> {
    const value = await this.page.locator('progress.progress').getAttribute('value');
    return value ? Number.parseInt(value, 10) : 0;
  }

  // ── Genre & Tone step ─────────────────────────────────────

  /**
   * Select a genre by clicking the chip button.
   */
  async selectGenre(genre: string): Promise<void> {
    await this.page.getByRole('button', { name: genre, exact: true }).click();
  }

  /**
   * Select a tone by clicking the chip button.
   */
  async selectTone(tone: string): Promise<void> {
    await this.page.getByRole('button', { name: tone, exact: true }).click();
  }

  /**
   * Get the currently selected genre chip.
   * Uses .btn-sm to avoid matching the Next/Gemini/Regenerate primary buttons.
   */
  async getSelectedGenre(): Promise<string | null> {
    const btn = this.page.locator('button.btn-sm.btn-primary').first();
    return await btn.textContent();
  }

  // ── Setting & Difficulty step ─────────────────────────────

  /**
   * Fill the setting textarea.
   */
  async fillSetting(setting: string): Promise<void> {
    const textarea = this.page.locator('#setting-input');
    await textarea.fill(setting);
  }

  /**
   * Select a difficulty by clicking the radio label.
   */
  async selectDifficulty(difficulty: string): Promise<void> {
    await this.page.getByText(difficulty, { exact: true }).click();
  }

  /**
   * Check if a difficulty radio is selected.
   */
  async isDifficultySelected(difficulty: string): Promise<boolean> {
    // Check by label clickable area
    const label = this.page.locator('label.flex.items-center', {
      has: this.page.locator(`span:text-is("${difficulty}")`),
    });
    return await label.locator('input[type="radio"]').isChecked();
  }

  // ── Goals step ────────────────────────────────────────────

  /**
   * Fill the goals textarea.
   */
  async fillGoals(goals: string): Promise<void> {
    const textarea = this.page.locator('#goals-input');
    await textarea.fill(goals);
  }

  // ── Actions ────────────────────────────────────────────────

  /**
   * Click the "Next →" button to advance.
   */
  async clickNext(): Promise<void> {
    await this.page.getByRole('button', { name: 'Next →' }).click();
  }

  /**
   * Click the "← Back" button.
   */
  async clickBack(): Promise<void> {
    await this.page.getByRole('button', { name: '← Back' }).click();
  }

  /**
   * Click "Generate World" to start generation.
   */
  async clickGenerateWorld(): Promise<void> {
    await this.page.getByRole('button', { name: 'Generate World' }).click();
  }

  /**
   * Click "Surprise Me!" button.
   */
  async clickSurpriseMe(): Promise<void> {
    await this.page.getByRole('button', { name: /Surprise Me/i }).click();
  }

  /**
   * Click "Accept World" to approve the generated world.
   */
  async clickAcceptWorld(): Promise<void> {
    await this.page.getByRole('button', { name: 'Accept World' }).click();
  }

  /**
   * Click "Regenerate" to retry generation.
   */
  async clickRegenerate(): Promise<void> {
    await this.page.getByRole('button', { name: 'Regenerate' }).click();
  }

  /**
   * Click "Start Character Creation" after world is accepted.
   */
  async clickStartCharacterCreation(): Promise<void> {
    const eventPromise = this.page.evaluate(() => {
      return new Promise<string>((resolve) => {
        document.addEventListener(
          'world-accepted',
          ((e: CustomEvent) => {
            resolve(e.detail.worldName);
          }) as EventListener,
          { once: true },
        );
      });
    });

    await this.page.getByRole('button', { name: 'Start Character Creation' }).click();

    // Wait for the custom event to fire
    await eventPromise;
  }

  // ── Waiting ───────────────────────────────────────────────

  /**
   * Wait for the generating spinner to appear.
   */
  async waitForGenerating(): Promise<void> {
    await this.page.locator('.loading-spinner').first().waitFor({ timeout: 5000 });
  }

  /**
   * Wait for the preview step (world output rendered).
   * Looks for the card title or the NPC cards which only appear on the preview step.
   */
  async waitForPreview(): Promise<void> {
    await this.page
      .locator('h3.card-title')
      .or(this.page.locator('div.card h4.font-bold'))
      .first()
      .waitFor({ timeout: 10000 });
  }

  /**
   * Wait for the character creation step.
   */
  async waitForCharacterCreation(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Start Character Creation' })
      .waitFor({ timeout: 10000 });
  }

  // ── Preview selectors ────────────────────────────────────

  /**
   * Get the world name from the preview step.
   */
  async getWorldName(): Promise<string | null> {
    const title = this.page.locator('h3.card-title').first();
    return await title.textContent();
  }

  /**
   * Get the number of NPC cards displayed.
   */
  async getNpcCount(): Promise<number> {
    return await this.page.locator('div.card div.card-body h4.font-bold').count();
  }

  /**
   * Get the number of location badges.
   */
  async getLocationCount(): Promise<number> {
    return await this.page.locator('span.badge.badge-outline').count();
  }

  // ── Error state ──────────────────────────────────────────

  /**
   * Check if an error alert is visible.
   */
  async isErrorVisible(): Promise<boolean> {
    return await this.page.locator('div.alert.alert-error').first().isVisible();
  }

  /**
   * Get the error message text.
   */
  async getErrorMessage(): Promise<string | null> {
    const alert = this.page.locator('div.alert.alert-error').first();
    return await alert.textContent();
  }

  // ── Surprise Me overrides for dev sandbox ─────────────────

  /**
   * Click "Simulate Failure" button (dev sandbox only).
   */
  async clickSimulateFailure(): Promise<void> {
    await this.page.getByRole('button', { name: /Simulate Failure/i }).click();
  }

  /**
   * Click "Reset Sim" button (dev sandbox only).
   */
  async clickResetSimulation(): Promise<void> {
    await this.page.getByRole('button', { name: /Reset Sim/i }).click();
  }

  /**
   * Toggle the debug prompt panel (dev sandbox only).
   */
  async toggleDebugPanel(): Promise<void> {
    await this.page.getByRole('button', { name: /Show Prompt|Hide Prompt/ }).click();
  }

  /**
   * Get the debug prompt text (dev sandbox only).
   */
  async getDebugPromptText(): Promise<string> {
    const pre = this.page.locator('pre.font-mono');
    return await pre.innerText();
  }
}
