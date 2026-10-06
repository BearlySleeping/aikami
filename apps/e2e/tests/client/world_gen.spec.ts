// apps/e2e/tests/client/world_gen.spec.ts
//
// Playwright tests for the G01 world-generation wizard.
//
// The G01 acceptance gate is "worldgen cancellation/navigation E2E using
// controllable provider delays". That is what the `Cancellation and
// navigation` block below covers: with a deliberately slow mock provider, the
// player cancels, navigates away and restarts mid-run, and the wizard must not
// resurrect the abandoned run's result. The happy-path block exists to prove
// the draft those tests cancel FROM is a real, coherent draft.
//
// Contract: G01 — safe private narrative-world drafts

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { WorldGenWizardPage } from '$pom/world_gen_wizard_page';
import {
  isObservedOptionalRuntimeConfig404,
  isOptionalRuntimeConfig404,
  type ObservedConsoleError,
  type ObservedResourceFailure,
} from '../../src/optional_runtime_config_errors.ts';

const EVIDENCE_DIRECTORY = fileURLToPath(
  new URL('../../../../.evidence/G01/raw/', import.meta.url),
);

// ── Happy path ─────────────────────────────────────────────────────────────

test.describe('World Generation Wizard — draft preview', () => {
  test.beforeEach(async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox();
  });

  test('the production route states the draft is not playable', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoProduction();

    // The C-405 banner claimed a "Preview" that "seeds NPCs/locations"; it now
    // says what the feature actually does.
    await expect(page.locator('[data-testid="worldgen-preview-badge"]')).toHaveText(
      'Narrative draft',
    );
    await expect(page.locator('[data-testid="worldgen-plan-link"]')).toBeVisible();
    // The closed-issue link is gone.
    await expect(page.locator('a[href*="issues/81"]')).toHaveCount(0);
  });

  test('navigates through the input steps', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);

    await wizard.selectGenre('Fantasy');
    await wizard.selectTone('Heroic');
    await wizard.clickNext();
    expect(await wizard.getCurrentStepLabel()).toContain('Setting');
    await wizard.fillSetting('A valley under a permanent twilight.');
    await wizard.clickNext();
    expect(await wizard.getCurrentStepLabel()).toContain('Goals');
  });

  test('a complete run previews a draft and says plainly it is not playable', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    await wizard.waitForPreview();

    expect(await wizard.getWorldName()).toBeTruthy();
    const notice = await wizard.getPreviewNotice();
    expect(notice).toContain('not a playable world');
    expect(notice).toContain('does not change the running game');
    expect(notice).not.toContain('GM prompts');
    // There is no character-creation step any more.
    await expect(page.getByRole('button', { name: /Character Creation/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Start Character Creation/i })).toHaveCount(0);
  });

  test('accepting saves a private draft and reports it as saved', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();
    await wizard.clickGenerateDraft();
    await wizard.waitForPreview();

    const captureDirectory = `${EVIDENCE_DIRECTORY}/${Date.now()}`;
    await mkdir(captureDirectory, { recursive: true });
    await page.getByTitle('Collapse Dev Tools').click();
    await page.screenshot({ path: `${captureDirectory}/preview.png` });
    await page.getByText('The Ember Market', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${captureDirectory}/preview-places.png` });
    await page.getByRole('heading', { name: /HUD Widgets/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${captureDirectory}/preview-bottom.png` });
    await wizard.clickSaveDraft();
    await wizard.waitForDraftSaved();
    await page.screenshot({ path: `${captureDirectory}/saved.png` });

    const saved = await page.locator('[data-testid="worldgen-draft-saved"]').innerText();
    expect(saved).toContain('Draft Saved');
    expect(saved).toContain('private narrative draft');
    expect(saved).toContain('not a playable world');
  });

  test('a failing run shows an error with a working retry', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox({ fail: true });
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    await wizard.waitForRunStopped();

    expect(await wizard.isErrorVisible()).toBe(true);
    expect(await wizard.getErrorMessage()).toBeTruthy();
    await expect(page.locator('[data-testid="worldgen-retry"]')).toBeVisible();
  });
});

// ── The G01 gate: cancellation and navigation ──────────────────────────────

test.describe('World Generation Wizard — cancellation and navigation', () => {
  // 900ms per stage is long enough for the run to still be in flight when the
  // test acts, and short enough not to stall the suite.
  const SLOW = { delayMs: 900 };

  test('cancelling a run stops it and never shows the abandoned draft', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox(SLOW);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    await wizard.waitForRunStarted();

    await wizard.clickCancel();
    await wizard.waitForRunStopped();

    // The cancelled run's result must not appear, now or later.
    expect(await wizard.isPreviewVisible()).toBe(false);
    await page.waitForTimeout(2000);
    expect(await wizard.isPreviewVisible()).toBe(false);
    await expect(page.locator('[data-testid="worldgen-draft-saved"]')).toHaveCount(0);
  });

  test('completed stages are reported before a cancel, proving partial progress was kept', async ({
    page,
  }) => {
    const wizard = new WorldGenWizardPage(page);
    // Only `arcs` is slow, so the earlier stages finish quickly and are visible.
    await wizard.gotoDevSandbox({ delayStage: 'arcs', delayMs: 3000 });
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    // Wait for the second stage round to begin: the premise round has settled
    // and published its checkpoint, so the readout is populated while the run
    // is still live (it disappears the moment the run stops).
    await wizard.waitForCompletedStage('world premise');
    const completed = await wizard.getCompletedStages();
    expect(completed).toContain('world premise');
    expect(completed).not.toContain('story arcs');

    await wizard.clickCancel();
  });

  test('navigating away mid-run does not resurrect the abandoned draft', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox(SLOW);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    await wizard.waitForRunStarted();

    // Leave the wizard entirely, then wait longer than a stage would take.
    await wizard.gotoDevSandbox();
    await page.waitForTimeout(2500);

    expect(await wizard.isPreviewVisible()).toBe(false);
    await expect(page.locator('[data-testid="worldgen-draft-saved"]')).toHaveCount(0);
  });

  test('restarting mid-run discards the abandoned draft', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox(SLOW);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    await wizard.clickGenerateDraft();
    await wizard.waitForRunStarted();

    // The generating step deliberately offers no Back button; restart is the
    // sandbox's own "Reset Wizard" action, which is the same `restart()` path a
    // player reaches from the preview step.
    await wizard.clickResetWizard();
    expect(await wizard.getCurrentStepLabel()).toContain('Genre');
    await page.waitForTimeout(2500);

    expect(await wizard.isPreviewVisible()).toBe(false);
    await expect(page.locator('[data-testid="worldgen-draft-saved"]')).toHaveCount(0);
  });

  test('a run started after a cancelled one completes cleanly', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoDevSandbox(SLOW);
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();
    await wizard.clickGenerateDraft();
    await wizard.waitForRunStarted();
    await wizard.clickCancel();
    await wizard.waitForRunStopped();

    // Remove the delay and run again — the cancelled run must not have left a
    // half-applied draft that the new run trips over.
    await wizard.clickClearDelay();
    await wizard.clickRetry();
    await wizard.waitForPreview();

    expect(await wizard.getWorldName()).toBeTruthy();
  });
});
// ── Production route: the provider boundary is honest ─────────────────────
//
// The blocks above run against the DEV SANDBOX, whose provider is an explicit
// mock (`?wgDelay`, `?wgFail`). Everything here runs against the REAL
// `/worldgen` route with the REAL `textGenerationService` — no mock, no stub,
// no seeded row.
//
// That distinction matters for what these tests can and cannot assert. This
// environment has no local text model behind `textGenerationService`, so a
// Generate on the production route cannot produce a draft. Rather than fake a
// ready provider, these tests stop AT that boundary and assert the two things
// that are true either way:
//
//   * `initialize()` runs on the production route and hydrates from the real
//     device store without wedging the wizard, and
//   * a browser reload — the exact event that used to lose an in-memory-only
//     draft — leaves the wizard usable rather than crashed or blank.
//
// The reload ROUND-TRIP of a stored draft is proven where it can actually be
// driven end to end: `world_gen_draft_service.test.ts` drives two service
// instances over one real in-memory SQLite database built from the real
// migration list. Asserting it here with a mock provider would prove nothing
// that lane does not already prove, and would look like coverage it is not.

test.describe('World Generation Wizard — production route with the real provider', () => {
  test('hydrates from the real device store on load and survives a hard reload', async ({
    page,
  }) => {
    const wizard = new WorldGenWizardPage(page);
    const consoleErrors: ObservedConsoleError[] = [];
    const httpFailures: ObservedResourceFailure[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ text: message.text(), url: message.location().url });
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        httpFailures.push({ url: response.url(), status: response.status() });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await wizard.gotoProduction();
    // No stored draft exists on a fresh profile, so the wizard starts at the
    // first input step rather than landing somewhere undefined.
    expect(await wizard.getCurrentStepLabel()).toContain('Genre');
    await page.waitForTimeout(500);
    expect(await wizard.isPreviewVisible()).toBe(false);

    await page.reload();

    // The reload is the event this milestone exists for: a rebuilt ViewModel
    // and a rebuilt draft service hold nothing in memory. Hydration must not
    // throw, must not blank the wizard, and must not leave it mid-generation.
    expect(await wizard.getCurrentStepLabel()).toContain('Genre');
    await expect(page.locator('[data-testid="worldgen-preview-badge"]')).toHaveText(
      'Narrative draft',
    );
    expect(await wizard.isPreviewVisible()).toBe(false);
    const appOrigin = new URL(page.url()).origin;
    expect(
      httpFailures.filter((response) => !isOptionalRuntimeConfig404(response, appOrigin)),
    ).toEqual([]);
    expect(
      consoleErrors.filter(
        (error) =>
          !isObservedOptionalRuntimeConfig404({
            error,
            responses: httpFailures,
            appOrigin,
          }),
      ),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('an unavailable production provider cannot claim a completed draft', async ({ page }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoProduction();
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();

    // With no provider behind it this fails rather than producing a draft.
    // Either way the wizard must report the outcome and show no preview —
    // a failure that silently showed a draft would be the real defect.
    await wizard.clickGenerateDraft();
    await wizard.waitForRunStopped();

    expect(await wizard.isPreviewVisible()).toBe(false);
    await expect(page.locator('[data-testid="worldgen-draft-saved"]')).toHaveCount(0);
  });

  test('navigating away mid-run on the production route leaves no draft behind', async ({
    page,
  }) => {
    const wizard = new WorldGenWizardPage(page);
    await wizard.gotoProduction();
    await wizard.clickSurpriseMe();
    await wizard.clickNext();
    await wizard.clickNext();
    await wizard.clickGenerateDraft();

    // Leave the route entirely while the request is in flight, then come back.
    await wizard.gotoDevSandbox();
    await page.waitForTimeout(1500);
    await wizard.gotoProduction();

    expect(await wizard.isPreviewVisible()).toBe(false);
    await expect(page.locator('[data-testid="worldgen-draft-saved"]')).toHaveCount(0);
  });
});
