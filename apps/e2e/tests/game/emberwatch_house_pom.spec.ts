// apps/e2e/tests/game/emberwatch_house_pom.spec.ts
//
// Regression for the EmberwatchHousePage tutorial dismissal contract.
//
// `dismissTutorial()` used `getByRole('button', { name: /skip/i }).first()`.
// That pattern is not scoped to the tutorial: the music player in the SAME
// overlay layer exposes `aria-label="Skip to similar song"`, which is usually
// disabled with no track playing. Once the first-run hint is gone, the loose
// match binds to the music button, the click waits on a disabled control, and
// the run dies on a 30 s timeout that has nothing to do with the tutorial
// (captured in .evidence/engine-polish/baseline/map-probe.log).
//
// These cases drive the POM against representative DOM rather than the booted
// route: the defect is a selector-scoping defect, and the DOM is the whole
// input. No product fixture is invented and no timeout is relaxed — the fix is
// proven by the music control never being targeted.

import { expect, test } from '@playwright/test';
import { EmberwatchHousePage } from '$pom';

/** HUD markup mirroring the production overlay layer: hint + music player. */
const hudMarkup = (options: { hint: boolean }): string => `
  <div data-testid="game-ui-overlay-layer">
    ${
      options.hint
        ? `<div class="hud-onboarding" data-testid="onboarding-hint" role="status">
             <div class="hud-onboarding__actions">
               <button type="button" class="hud-onboarding__skip" aria-label="Skip tutorial"
                 onclick="window.__tutorialSkips = (window.__tutorialSkips ?? 0) + 1">Skip</button>
             </div>
           </div>`
        : ''
    }
    <div class="hud-music">
      <button type="button" aria-label="Skip to similar song" disabled
        onclick="window.__musicSkips = (window.__musicSkips ?? 0) + 1">Skip</button>
    </div>
  </div>
`;

const readClicks = (page: import('@playwright/test').Page, key: string): Promise<number> =>
  page.evaluate(
    (counter) =>
      ((window as unknown as Record<string, number | undefined>)[counter] ?? 0) as number,
    key,
  );

test.describe('EmberwatchHousePage.dismissTutorial — selector scoping', () => {
  test('is a no-op when only the disabled music skip is present', async ({ page }) => {
    await page.setContent(hudMarkup({ hint: false }));
    const pom = new EmberwatchHousePage(page);

    // Must return promptly — a scoped, absent locator resolves immediately.
    const dismissed = await pom.dismissTutorial();

    expect(dismissed).toBe(false);
    expect(await readClicks(page, '__musicSkips')).toBe(0);
    expect(await page.getByRole('button', { name: 'Skip to similar song' }).isDisabled()).toBe(
      true,
    );
  });

  test('dismisses the tutorial hint without touching the music skip', async ({ page }) => {
    await page.setContent(hudMarkup({ hint: true }));
    const pom = new EmberwatchHousePage(page);

    const dismissed = await pom.dismissTutorial();

    expect(dismissed).toBe(true);
    expect(await readClicks(page, '__tutorialSkips')).toBe(1);
    // The disabled music control was never the target.
    expect(await readClicks(page, '__musicSkips')).toBe(0);
  });
});
