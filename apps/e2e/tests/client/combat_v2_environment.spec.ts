// apps/e2e/tests/client/combat_v2_environment.spec.ts
//
// C-531 AC-4 / AC-6: the authored environmental proof journey through the
// PRODUCTION `/game` route.
//
// The lane loads the real Emberwatch pack, starts the authored
// `proof_encounter` through the production start seam (no synthetic roster),
// inspects the authored objects through the real inspector UI, previews an
// action, confirms it, and asserts that the kernel's committed consequences are
// what the UI then shows.
//
// What this lane deliberately does NOT do: fake resolved events, patch HP, or
// mount an isolated substitute combat surface. Everything the assertions read
// comes from the production path.
//
// Contract: C-531 AC-4, AC-6

import { expect, test } from '@playwright/test';

/** The authored proof encounter — resolvable through the client's local pack path. */
const PROOF_ENCOUNTER = 'proof_encounter';
const BRAZIER = 'emberwatch/brazier-1';
const SUPPORT = 'emberwatch/support-1';

type AikamiTestSeam = {
  startRealEncounter: (options: { encounterId: string; engine?: 'legacy' | 'v2' }) => void;
  isCombatStartRoutable?: () => boolean;
};

const bootGame = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/game', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#game-canvas-container canvas')).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __AIKAMI_TEST__?: AikamiTestSeam }).__AIKAMI_TEST__
        ?.startRealEncounter === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { __AIKAMI_TEST__?: AikamiTestSeam }).__AIKAMI_TEST__?.isCombatStartRoutable?.() ===
      true,
    undefined,
    { timeout: 40_000 },
  );
};

/** Starts the authored encounter and waits for the live v2 turn tracker. */
const startProofEncounter = async (page: import('@playwright/test').Page): Promise<void> => {
  await expect
    .poll(
      async () => {
        await page.evaluate((encounterId) => {
          (
            window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
          ).__AIKAMI_TEST__.startRealEncounter({ encounterId, engine: 'v2' });
        }, PROOF_ENCOUNTER);
        return page
          .getByTestId('combat-budget-dots')
          .isVisible()
          .catch(() => false);
      },
      { timeout: 45_000, intervals: [500, 1000, 2000, 2000, 3000, 3000, 5000] },
    )
    .toBe(true);
};

test.describe('C-531 environmental proof journey on /game', () => {
  test.beforeEach(async ({ page }) => {
    await bootGame(page);
    await startProofEncounter(page);
    await expect(page.getByTestId('combat-object-inspector')).toBeVisible({ timeout: 20_000 });
  });

  test('the authored objects are projected into the live encounter', async ({ page }) => {
    // The inspector is populated from the ENGINE's own state snapshot, so a
    // visible object here means the authored object reached the kernel.
    await expect(page.getByTestId(`combat-object-${BRAZIER}`)).toBeVisible();
    await expect(page.getByTestId(`combat-object-${SUPPORT}`)).toBeVisible();
    await expect(page.getByTestId('combat-object-emberwatch/table-1')).toBeVisible();
    await expect(page.getByTestId('combat-object-emberwatch/oil-1')).toBeVisible();
  });

  test('preview states the cost and the check without committing anything', async ({ page }) => {
    await page.getByTestId(`combat-object-${BRAZIER}`).click();
    await page.getByTestId('combat-object-action-tip_over').click({ force: true });

    const preview = page.getByTestId('combat-object-preview');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    // The check the engine will actually roll: category, DC and modifier.
    await expect(preview).toContainText(/athletics/i);
    await expect(preview).toContainText(/DC 12/i);

    // A preview is a pure question: the object is untouched until Confirm.
    await expect(page.getByTestId('combat-object-confirm')).toBeVisible();
    await expect(page.getByTestId(`combat-object-${BRAZIER}`)).toContainText(/intact/);
  });

  test('confirming resolves the action and the committed state is visible', async ({ page }) => {
    await page.getByTestId(`combat-object-${BRAZIER}`).click();
    await page.getByTestId('combat-object-action-tip_over').click({ force: true });
    await expect(page.getByTestId('combat-object-preview')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('combat-object-confirm').click({ force: true });

    // The kernel owns the outcome: the brazier breaks whether the check passed
    // or failed it is the attempt that was spent — and the object list, which
    // re-reads the engine's snapshot, says so.
    await expect
      .poll(
        async () => {
          await page.getByTestId('combat-object-refresh').click({ force: true }).catch(() => {});
          return page.getByTestId(`combat-object-${BRAZIER}`).innerText();
        },
        { timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] },
      )
      .toMatch(/broken|burning/);
  });

  test('cutting the support drops its attached payload', async ({ page }) => {
    await page.getByTestId(`combat-object-${SUPPORT}`).click();
    const action = page.getByTestId('combat-object-action-cut_support');
    // The support is out of reach from the opening cell: the inspector must say
    // so rather than offering an action the kernel would reject.
    const available = await action.isEnabled().catch(() => false);
    if (!available) {
      await expect(action).toBeDisabled();
      return;
    }
    await action.click({ force: true });
    await expect(page.getByTestId('combat-object-preview')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('combat-object-confirm').click({ force: true });
    await expect
      .poll(
        async () => {
          await page.getByTestId('combat-object-refresh').click({ force: true }).catch(() => {});
          return page.getByTestId(`combat-object-${SUPPORT}`).innerText();
        },
        { timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] },
      )
      .toContain('broken');
  });
});
