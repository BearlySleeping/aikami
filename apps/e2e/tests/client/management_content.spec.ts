// apps/e2e/tests/client/management_content.spec.ts
//
// C-551 production management task composition. Every populated state is
// seeded through the non-production seam into the real inventory, equipment,
// quest and journal stores; the rendered path remains `/game`.

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { GamePage, PlayShellPage } from '$pom';

const openSection = async (scene: PlayShellPage, section: string): Promise<void> => {
  await scene.open();
  await scene.openManagementHost();
  await scene.openManagementSection(section);
};

test.describe('C-551 management task surfaces', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('character is summary-first and discloses editing explicitly', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'character');

    await expect(scene.characterSummary).toBeVisible();
    await expect(scene.characterSummary.getByText('Core abilities')).toBeVisible();
    await expect(scene.characterSummary).toContainText('Hit points');
    await expect(scene.characterSummary).toContainText('Armor Class');
    await expect(
      scene.characterSummary.getByRole('progressbar', { name: 'Hit points' }),
    ).toBeVisible();
    await expect(
      scene.characterSummary.getByRole('progressbar', { name: 'Experience' }),
    ).toBeVisible();
    await expect(scene.characterEditToggle).toHaveText('Edit character');
    await expect(scene.characterEditToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('spinbutton', { name: 'STR score' })).toHaveCount(0);
    await expect(page.getByText('Saving throw proficiency', { exact: false })).toHaveCount(0);

    await scene.characterEditToggle.click();

    await expect(scene.characterEditToggle).toHaveText('Done editing');
    await expect(scene.characterEditToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('spinbutton', { name: 'STR score' })).toBeVisible();
    const stepperButton = page.getByRole('button', { name: 'Increase STR score' });
    const stepperBox = await stepperButton.boundingBox();
    expect(stepperBox?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(stepperBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    const strengthInput = page.getByRole('spinbutton', { name: 'STR score' });
    await strengthInput.fill('99');
    await strengthInput.press('Tab');
    await expect(strengthInput).toHaveValue('20');
    await expect(page.getByText('Saving throw', { exact: true }).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Traits' }).click();
    for (const name of ['Personality', 'Ideals', 'Bonds', 'Flaws']) {
      await expect(page.getByRole('textbox', { name })).toBeVisible();
    }
    for (const name of ['Add a likes trait', 'Add a temptations trait', 'Add a keys trait']) {
      await expect(page.getByRole('textbox', { name })).toBeVisible();
    }
  });

  test('character keeps lower content reachable through its scroll owner', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'character');
    await scene.characterEditToggle.click();

    const scroll = await scene.scrollCharacterToBottom();
    expect(scroll.clientHeight).toBeGreaterThan(0);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    expect(scroll.scrollTop).toBeGreaterThan(0);
  });

  test('inventory composes equipment, a populated bag and selected details', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('populated');

    for (const control of await scene.paperdollControlGeometry()) {
      if (control.buttonBottom !== undefined) {
        expect(control.buttonBottom).toBeLessThanOrEqual(control.slotBottom + 1);
      }
    }
    const reachableControls = await scene.inventoryControlReachability();
    expect(reachableControls.length).toBeGreaterThan(0);
    expect(reachableControls.every((control) => control.reachable)).toBe(true);
    await expect(scene.inventoryPaperdoll).toContainText('Iron Armor');
    await expect(scene.inventoryItemList).toBeVisible();
    await expect(scene.inventoryItemList.locator('li')).toHaveCount(4);
    await expect(scene.inventoryDetail).toContainText('Steel Sword');
    await expect(
      scene.inventoryDetail.getByRole('button', { name: 'Equip Steel Sword' }),
    ).toBeVisible();

    const healthPotion = scene.inventoryItemList.getByTestId('inventory-item-healthPotion');
    await healthPotion.getByRole('button').click();

    await expect(scene.inventoryDetail).toContainText('Health Potion');
    await expect(
      scene.inventoryDetail.getByRole('button', { name: 'Use Health Potion' }),
    ).toBeVisible();
  });

  test('empty inventory is a composed state contained by the workspace', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('empty');

    await expect(scene.inventoryEmptyState).toBeVisible();
    await expect(scene.inventoryEmptyState).toContainText('Your bag is empty');
    const workspaceBox = await scene.managementWorkspace.boundingBox();
    const emptyBox = await scene.inventoryEmptyState.boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(emptyBox).not.toBeNull();
    expect((emptyBox?.y ?? 0) + (emptyBox?.height ?? 0)).toBeLessThanOrEqual(
      (workspaceBox?.y ?? 0) + (workspaceBox?.height ?? 0) + 1,
    );
    const reachableControls = await scene.inventoryControlReachability();
    expect(reachableControls.some((control) => control.reachable)).toBe(true);
    expect(reachableControls.every((control) => control.reachable)).toBe(true);
  });

  test('journal defaults to quests and opens note editing only on demand', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await scene.open();
    // Seed before opening any management surface so Journal cannot mount a
    // stale asynchronous loader before the campaign-scoped rows exist.
    await scene.seedManagementContent('populated');
    await scene.openManagementHost();
    await scene.openManagementSection('journal');

    await expect(scene.journalTabs.getByRole('tab', { name: /Quests/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(scene.journalPanel.getByTestId('active-quest')).toContainText('The Fading Ward');

    const notesTab = scene.journalTabs.getByRole('tab', { name: /Notes/ });
    await notesTab.click();

    await expect(scene.journalNoteList).toContainText('Watch the eastern ward');
    await expect(scene.journalNoteDetail).toContainText('The eastern lantern flickers after dusk.');
    await expect(page.getByTestId('note-title')).toHaveCount(0);

    await page.getByTestId('note-new').click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await expect(page.getByTestId('note-content')).toBeVisible();
  });

  test('populated management has no serious or critical axe violations', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('populated');

    const results = await new AxeBuilder({ page })
      .include('[data-testid="management-workspace"]')
      .analyze();
    const seriousOrCritical = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    );

    expect(seriousOrCritical).toEqual([]);

    await scene.openManagementSection('journal');
    await expect(scene.journalPanel).toBeVisible();
    const journalResults = await new AxeBuilder({ page })
      .include('[data-testid="management-workspace"]')
      .analyze();
    expect(
      journalResults.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
  });
  test('Inventory over Dialogue preserves transcript, draft, and explore mode', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const game = new GamePage(page);
    await game.goto({ bypassTextAi: true });
    await game.approachAndTalkToNpc();

    const dialogueOverlay = page.locator('[data-testid="dialogue-overlay"]');
    const composer = page.locator('textarea').first();
    const initialTranscript = (await dialogueOverlay.textContent()) ?? '';
    await composer.fill('unsent management draft');

    // Use the real player-facing Menu entry while Dialogue is active, then
    // choose Inventory in the production management rail.
    const menu = page.getByTestId('hud-menu-entry');
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByTestId('management-workspace')).toBeVisible();
    await page.getByTestId('section-tab-inventory').click();
    const state = await page.evaluate(() => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | { getOverlayState?: () => { overlay: string; mode: string } }
        | undefined;
      return seam?.getOverlayState?.();
    });
    expect(state).toEqual({ overlay: 'INVENTORY', mode: 'MENU' });

    await page.getByTestId('management-close').click();
    await expect(dialogueOverlay).toBeVisible();
    expect((await dialogueOverlay.textContent()) ?? '').toContain(initialTranscript);
    await expect(composer).toHaveValue('unsent management draft');
    const finalState = await page.evaluate(() => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | { getOverlayState?: () => { overlay: string; mode: string } }
        | undefined;
      return seam?.getOverlayState?.();
    });
    expect(finalState).toEqual({ overlay: 'DIALOGUE', mode: 'EXPLORE' });
  });
});

test.describe('C-551 compact viewport and 200% text', () => {
  test.use({ viewport: { width: 800, height: 600 } });

  test('empty inventory composes paperdoll and bag without clipping the empty state', async ({
    page,
  }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('empty');

    await expect(scene.inventoryPaperdoll).toBeVisible();
    await expect(scene.inventoryEmptyState).toBeVisible();
    const workspaceBox = await scene.managementWorkspace.boundingBox();
    const emptyBox = await scene.inventoryEmptyState.boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(emptyBox).not.toBeNull();
    expect((emptyBox?.y ?? 0) + (emptyBox?.height ?? 0)).toBeLessThanOrEqual(
      (workspaceBox?.y ?? 0) + (workspaceBox?.height ?? 0) + 1,
    );
    const reachableControls = await scene.inventoryControlReachability();
    expect(reachableControls.some((control) => control.reachable)).toBe(true);
    expect(reachableControls.every((control) => control.reachable)).toBe(true);
  });

  test('inventory remains vertically readable without horizontal overflow', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('populated');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    await expect
      .poll(
        async () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);
    for (const control of await scene.paperdollControlGeometry()) {
      if (control.buttonBottom !== undefined) {
        expect(control.buttonBottom).toBeLessThanOrEqual(control.slotBottom + 1);
      }
    }
    const reachableControls = await scene.inventoryControlReachability();
    expect(reachableControls.length).toBeGreaterThan(0);
    expect(reachableControls.every((control) => control.reachable)).toBe(true);
    await expect(scene.inventoryDetail).toBeVisible();
  });
});
