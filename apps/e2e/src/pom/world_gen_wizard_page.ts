// apps/e2e/src/pom/world_gen_wizard_page.ts
// Page Object Model — WorldGenWizardPage
//
// Encapsulates locators and interaction primitives for the G01 world-generation
// wizard. The wizard produces a private NARRATIVE DRAFT: step flow is
// Genre/Tone → Setting/Difficulty → Goals → Generating → Preview → Draft
// Saved. There is deliberately no character-creation step.
//
// The dev sandbox route accepts `?wgDelay=<ms>`, `?wgDelayStage=<stage>` and
// `?wgFail=1` so a browser test can make a run slow, slow ONE stage so the
// stages before it settle first, or fail every stage — the three conditions
// under which cancellation, navigation-away and retry exhaustion are actually
// observable. `wgDelayStage` narrows `wgDelay` to the named stage rather than
// adding to it.
//
// DOM reference:
//   apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view.svelte
//   apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts

import type { Page } from '@playwright/test';

/** Query knobs the dev sandbox honours. */
export type SandboxControl = {
  /** Delay in ms. Applies to every stage, or to `delayStage` alone. */
  delayMs?: number;
  /** Narrow `delayMs` to a single stage instead of applying it to all of them. */
  delayStage?: 'setting' | 'cast' | 'places' | 'hudWidgets' | 'arcs';
  /** Make every stage fail. */
  fail?: boolean;
};

/** Page Object Model for the World Generation Wizard. */
export class WorldGenWizardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /**
   * Navigate to the dev sandbox, optionally with mock-provider controls.
   */
  async gotoDevSandbox(control: SandboxControl = {}): Promise<void> {
    const params = new URLSearchParams();
    if (control.delayMs !== undefined) {
      params.set('wgDelay', String(control.delayMs));
    }
    if (control.delayStage !== undefined) {
      params.set('wgDelayStage', control.delayStage);
    }
    if (control.fail === true) {
      params.set('wgFail', '1');
    }
    const query = params.toString();
    await this.page.goto(`/dev/world-gen${query === '' ? '' : `?${query}`}`);
    await this.page.locator('progress.progress').waitFor({ timeout: 15_000 });
  }

  /** Navigate to the production route. */
  async gotoProduction(): Promise<void> {
    await this.page.goto('/worldgen');
    await this.page.locator('progress.progress').waitFor({ timeout: 15_000 });
  }

  // ── Step detection ────────────────────────────────────────

  async getCurrentStepLabel(): Promise<string> {
    return await this.page.locator('h2').first().innerText();
  }

  async isProgressBarVisible(): Promise<boolean> {
    return await this.page.locator('progress.progress').isVisible();
  }

  async getProgressValue(): Promise<number> {
    const value = await this.page.locator('progress.progress').getAttribute('value');
    return value ? Number.parseInt(value, 10) : 0;
  }

  // ── Inputs ────────────────────────────────────────────────

  async selectGenre(genre: string): Promise<void> {
    await this.page.getByRole('button', { name: genre, exact: true }).click();
  }

  async selectTone(tone: string): Promise<void> {
    await this.page.getByRole('button', { name: tone, exact: true }).click();
  }

  async getSelectedGenre(): Promise<string | null> {
    return await this.page.locator('button.btn-sm.btn-primary').first().textContent();
  }

  async fillSetting(setting: string): Promise<void> {
    await this.page.locator('#setting-input').fill(setting);
  }

  async selectDifficulty(difficulty: string): Promise<void> {
    await this.page.getByText(difficulty, { exact: true }).click();
  }

  async fillGoals(goals: string): Promise<void> {
    await this.page.locator('#goals-input').fill(goals);
  }

  // ── Actions ────────────────────────────────────────────────

  async clickNext(): Promise<void> {
    await this.page.getByRole('button', { name: 'Next →' }).click();
  }

  async clickBack(): Promise<void> {
    await this.page.getByRole('button', { name: '← Back' }).click();
  }

  async clickSurpriseMe(): Promise<void> {
    await this.page.getByRole('button', { name: /Surprise Me/i }).click();
  }

  /** Start a generation run. */
  async clickGenerateDraft(): Promise<void> {
    await this.page.getByRole('button', { name: 'Generate Draft' }).click();
  }

  /** Cancel an in-flight run from the generating step. */
  async clickCancel(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-cancel"]').click();
  }

  /** Retry after a failure. */
  async clickRetry(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-retry"]').click();
  }

  /** Accept the draft as a private preview. */
  async clickSaveDraft(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-accept"]').click();
  }

  async clickSimulateFailure(): Promise<void> {
    await this.page.locator('[data-testid="sandbox-simulate-failure"]').click();
  }

  async clickClearDelay(): Promise<void> {
    await this.page.locator('[data-testid="sandbox-clear-delay"]').click();
  }

  /** The sandbox dev-tools "Reset Wizard" action (wizard `restart()`). */
  async clickResetWizard(): Promise<void> {
    await this.page.getByRole('button', { name: /Reset Wizard/i }).click();
  }

  // ── Waiting ───────────────────────────────────────────────

  async waitForGenerating(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-generating"]').waitFor({ timeout: 15_000 });
  }

  /**
   * Waits until the live run reports `label` among its completed stages.
   *
   * Waiting on the rendered readout (rather than a timer) is what makes these
   * assertions race-free: the element only exists while the run is in flight.
   */
  async waitForCompletedStage(label: string): Promise<void> {
    await this.page
      .locator('[data-testid="worldgen-completed-stages"]', { hasText: label })
      .waitFor({ timeout: 30_000 });
  }

  /** Wait for the run to enter the generating step. */
  async waitForRunStarted(): Promise<void> {
    await this.page
      .locator('[data-testid="worldgen-generating"] [data-testid="worldgen-cancel"]')
      .waitFor({ timeout: 15_000 });
  }

  async waitForPreview(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-preview-notice"]').waitFor({ timeout: 30_000 });
  }

  async waitForDraftSaved(): Promise<void> {
    await this.page.locator('[data-testid="worldgen-draft-saved"]').waitFor({ timeout: 15_000 });
  }

  /** Wait for the run to end in a cancelled/failed state showing the error alert. */
  async waitForRunStopped(): Promise<void> {
    await this.page
      .locator('[data-testid="worldgen-error"], [data-testid="worldgen-draft-saved"]')
      .first()
      .waitFor({ timeout: 30_000 });
  }

  // ── Preview selectors ────────────────────────────────────

  async getWorldName(): Promise<string | null> {
    return await this.page.locator('[data-testid="worldgen-world-name"]').textContent();
  }

  async getCastCount(): Promise<number> {
    return await this.page.getByRole('heading', { name: /^Cast \(/ }).count();
  }

  async getPreviewNotice(): Promise<string> {
    return await this.page.locator('[data-testid="worldgen-preview-notice"]').innerText();
  }

  async getCompletedStages(): Promise<string | null> {
    return await this.page
      .locator('[data-testid="worldgen-completed-stages"]')
      .textContent()
      .catch(() => null);
  }

  async isPreviewVisible(): Promise<boolean> {
    return await this.page.locator('[data-testid="worldgen-preview-notice"]').first().isVisible();
  }

  // ── Error state ──────────────────────────────────────────

  async isErrorVisible(): Promise<boolean> {
    return await this.page.locator('[data-testid="worldgen-error"]').first().isVisible();
  }

  async getErrorMessage(): Promise<string | null> {
    return await this.page.locator('[data-testid="worldgen-error"]').textContent();
  }

  async getCompletedStagesNotice(): Promise<string | null> {
    return this.getCompletedStages();
  }
}
