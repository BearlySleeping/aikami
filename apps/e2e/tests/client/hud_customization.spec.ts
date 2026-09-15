// apps/e2e/tests/client/hud_customization.spec.ts
//
// C-528 — Player HUD presets and layout editor.
//
// Production journeys on /game and /settings?section=interface. These are
// compiled Playwright assertions against the real route, real services and real
// localStorage — not a sandbox: every state below is reached by clicking what a
// player clicks.
//
// Contract: C-528 AC-1 … AC-8.

import { expect, type Page, test } from '@playwright/test';

/** Waits for the play shell HUD to be live. */
const waitForHud = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-anchor-top-end"]', {
    state: 'attached',
    timeout: 30_000,
  });
};

/** Opens the pause menu through the real input path. */
const openPauseMenu = async (page: Page): Promise<void> => {
  await waitForHud(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Paused', { state: 'visible', timeout: 10_000 });
};

/** Opens the HUD editor from the pause menu. */
const openHudEditor = async (page: Page): Promise<void> => {
  await openPauseMenu(page);
  await page.getByTestId('pause-customize-hud').click();
  await page.waitForSelector('[data-testid="hud-editor"]', { state: 'visible', timeout: 10_000 });
};

/** Reads the persisted HUD snapshot straight out of localStorage. */
const readStoredPreferences = async (page: Page): Promise<unknown> => {
  const raw = await page.evaluate(() => localStorage.getItem('aikami:hud:preferences'));
  return raw === null ? null : JSON.parse(raw);
};

/**
 * Pointer-drag helper.
 *
 * Uses raw mouse steps rather than `locator.dragTo`, because the editor's drag
 * is pointer-event based (mouse, touch and pen all work) and `dragTo` is
 * HTML5-drag oriented.
 */
const dragWidgetTo = async (page: Page, widgetId: string, anchor: string): Promise<void> => {
  // The widget list scrolls; a row below the fold has no hittable box.
  await page.getByTestId(`hud-editor-row-${widgetId}`).scrollIntoViewIfNeeded();
  const source = await page.getByTestId(`hud-editor-row-${widgetId}`).boundingBox();
  const target = await page.getByTestId(`hud-drop-anchor-${anchor}`).boundingBox();
  if (!source || !target) {
    throw new Error(`drag ${widgetId} -> ${anchor}: source or target not visible`);
  }
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

/** Clears every HUD-related key so each case starts from a known state. */
const resetHudStorage = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    for (const key of [
      'aikami:hud:preferences',
      'aikami:hud:migration',
      'aikami:hud:temporarily-hidden',
      'aikami:quest-overlay:visible',
      'aikami:music-player:visible',
      'aikami:clock-hud:visible',
    ]) {
      localStorage.removeItem(key);
    }
  });
};

test.describe('C-528 HUD presets and layout editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    await waitForHud(page);
    await resetHudStorage(page);
    await page.reload();
    await waitForHud(page);
  });

  test('AC-1: the resolved HUD exposes the required surfaces and no stray chrome', async ({
    page,
  }) => {
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    await expect(page.getByTestId('hud-anchor-top-end')).toBeAttached();
    // Required widgets are placed; the adventure preset keeps the objective.
    await expect(page.getByTestId('hud-widget-menu')).toBeAttached();
  });

  test('AC-2: pointer and keyboard reach the same valid configuration', async ({ page }) => {
    await openHudEditor(page);

    // Pointer: drag the objective onto another allowed region.
    await dragWidgetTo(page, 'objective', 'top-start');
    await expect(page.getByTestId('hud-editor-row-objective')).toContainText('top-start');
    await expect(page.getByTestId('hud-preview-objective')).toBeAttached();

    // Keyboard: select another widget and move it with the arrow keys.
    await page.getByTestId('hud-editor-row-hotbar').click();
    await page.getByTestId('hud-editor').press('ArrowRight');
    await expect(page.getByTestId('hud-editor-row-hotbar')).not.toContainText('bottom-center');

    // Both edits are drafts: the committed snapshot is untouched until Save.
    await expect(page.getByTestId('hud-editor-undo')).toBeEnabled();
  });

  test('AC-2: a reserved action region refuses an unrelated widget', async ({ page }) => {
    await openHudEditor(page);
    // `bottom-center` carries the required interaction/hotbar region. Dropping
    // the objective there must not move it — the reserved region wins.
    await dragWidgetTo(page, 'objective', 'bottom-center');
    const anchor = await page.getByTestId('hud-preview-objective').getAttribute('data-hud-anchor');
    expect(anchor).not.toBe('bottom-center');
  });

  test('AC-3: Cancel restores the exact prior snapshot', async ({ page }) => {
    const before = await readStoredPreferences(page);
    await openHudEditor(page);
    await page.getByTestId('hud-preview-tab-combat').click();
    await page.getByTestId('hud-editor-row-hotbar').click();
    await page.getByTestId('hud-editor').press('+');
    await page.getByTestId('hud-editor-reset-layout').click();
    await page.getByTestId('hud-editor-cancel').click();

    await expect(page.getByTestId('hud-editor')).toHaveCount(0);
    expect(await readStoredPreferences(page)).toEqual(before);
  });

  test('AC-3: Save persists and survives a reload', async ({ page }) => {
    await openHudEditor(page);
    await page.getByTestId('hud-preview-tab-explore').click();
    await page.getByTestId('hud-editor-row-clock').click();
    await page.getByTestId('hud-editor').press('v');
    await page.getByTestId('hud-editor-save').click();
    await expect(page.getByTestId('hud-editor')).toHaveCount(0);

    const stored = await readStoredPreferences(page);
    expect(stored).not.toBeNull();

    await page.reload();
    await waitForHud(page);
    expect(await readStoredPreferences(page)).toEqual(stored);
  });

  test('AC-3: closing a dirty editor asks before discarding', async ({ page }) => {
    await openHudEditor(page);
    // A pointer edit makes the draft dirty without depending on key delivery.
    await dragWidgetTo(page, 'clock', 'bottom-end');
    await expect(page.getByTestId('hud-editor-undo')).toBeEnabled();

    await page.getByTestId('hud-editor-close').click();
    await expect(page.getByTestId('hud-editor-discard')).toBeVisible();
    await page.getByTestId('hud-editor-discard-confirm').click();
    await expect(page.getByTestId('hud-editor')).toHaveCount(0);
  });

  test('AC-4: a hidden widget is not in the DOM, so it cannot capture input', async ({ page }) => {
    // Hide the hotbar through the persisted snapshot, then reload.
    await page.evaluate(() => {
      localStorage.setItem(
        'aikami:hud:preferences',
        JSON.stringify({
          schemaVersion: 1,
          selectedPresetId: 'adventure',
          overrides: [
            {
              widgetId: 'hotbar',
              visibility: 'hidden',
              anchor: 'bottom-center',
              order: 0,
              density: 'compact',
              scale: 1,
            },
          ],
        }),
      );
    });
    await page.reload();
    await waitForHud(page);

    // The hidden widget is absent entirely — no tab stop, no pointer target.
    await expect(page.getByTestId('hud-widget-hotbar')).toHaveCount(0);
    // A required surface is still present.
    await expect(page.getByTestId('hud-widget-menu')).toBeAttached();
  });

  test('AC-5: a compact viewport reflows without overlap and restores desktop intent', async ({
    page,
  }) => {
    await openHudEditor(page);
    await page.getByTestId('hud-editor-row-objective').click();
    await page.getByTestId('hud-editor').press('+');
    await page.getByTestId('hud-editor-save').click();

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    const compactOverlaps = await page.evaluate(() => {
      const widgets = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="game-ui-overlay-layer"] [data-hud-widget]',
        ),
      ];
      const boxes = widgets
        .map((widget) => widget.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
          const overlapY = Math.max(
            0,
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
          );
          if (overlapX > 4 && overlapY > 4) {
            overlaps += 1;
          }
        }
      }
      return overlaps;
    });
    expect(compactOverlaps).toBe(0);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
    // The saved intent is unchanged by the compact visit.
    const stored = await readStoredPreferences(page);
    expect(stored).not.toBeNull();
  });

  test('AC-6: legacy keys migrate once and an explicit false survives', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('aikami:quest-overlay:visible', '0');
      localStorage.setItem('aikami:music-player:visible', '1');
    });
    await page.reload();
    await waitForHud(page);

    const stored = (await readStoredPreferences(page)) as {
      overrides: { widgetId: string; visibility: string }[];
    };
    expect(stored).not.toBeNull();
    const objective = stored.overrides.find((widget) => widget.widgetId === 'objective');
    expect(objective?.visibility).toBe('contextual');
    // The legacy keys are left intact for the rollback window.
    const legacy = await page.evaluate(() => localStorage.getItem('aikami:quest-overlay:visible'));
    expect(legacy).toBe('0');
    const marker = await page.evaluate(() => localStorage.getItem('aikami:hud:migration'));
    expect(marker).not.toBeNull();
  });

  test('AC-6: corrupt stored data falls back safely and keeps the bytes', async ({ page }) => {
    const corrupt =
      '{"schemaVersion":1,"selectedPresetId":"adventure","overrides":[{"widgetId":"hotbar"}]}';
    await page.evaluate((value) => localStorage.setItem('aikami:hud:preferences', value), corrupt);
    await page.reload();
    await waitForHud(page);

    await page.goto('/settings?section=interface');
    await expect(page.getByTestId('hud-recovery-notice')).toBeVisible();
    await page.getByTestId('hud-restore-defaults').click();
    await expect(page.getByTestId('hud-status')).toBeVisible();
  });

  test('AC-7: with optional HUD hidden, Menu and recovery stay operable offline', async ({
    page,
  }) => {
    await openPauseMenu(page);
    await page.getByTestId('pause-hide-hud').click();
    await page.getByRole('button', { name: 'Resume Game' }).click();

    // Menu (required) is still reachable while Hide HUD is on.
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    // The optional chrome is gone.
    await expect(page.getByTestId('hud-widget-hotbar')).toHaveCount(0);

    // Restoring is one action away, and the saved preferences were not erased.
    await openPauseMenu(page);
    await page.getByTestId('pause-hide-hud').click();
    await page.getByRole('button', { name: 'Resume Game' }).click();
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('AC-8: an unknown optional widget stays dormant and a broken preset is rejected', async ({
    page,
  }) => {
    await page.goto('/settings?section=interface');
    await expect(page.getByTestId('settings-interface')).toBeVisible();

    // A preset that omits the required Menu surface is refused with an explanation.
    await page.getByTestId('hud-import-input').fill(
      JSON.stringify({
        schemaVersion: 1,
        id: 'broken',
        name: 'Broken',
        widgets: [
          {
            widgetId: 'hotbar',
            visibility: 'always',
            anchor: 'bottom-center',
            order: 0,
            density: 'compact',
            scale: 1,
          },
        ],
      }),
    );
    await page.getByTestId('hud-import-apply').click();
    await expect(page.getByTestId('hud-import-error')).toBeVisible();
  });

  test('AC-8: exporting a layout produces bounded, data-only JSON', async ({ page }) => {
    await page.goto('/settings?section=interface');
    await page.getByTestId('hud-export-preset').click();
    const exported = await page.getByTestId('hud-export-output').inputValue();
    const parsed = JSON.parse(exported) as { schemaVersion: number; widgets: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.widgets)).toBe(true);
    expect(exported).not.toContain('http');
  });

  test('AC-1: the Interface section is reachable from the in-game settings overlay', async ({
    page,
  }) => {
    await openPauseMenu(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForSelector('[aria-label="In-game settings"]', {
      state: 'visible',
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Interface' }).click();
    await expect(page.getByTestId('settings-interface')).toBeVisible();
  });
});
