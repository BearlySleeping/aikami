// apps/e2e/tests/client/management_content.spec.ts
//
// C-551 production management task composition. Every populated state is
// seeded through the non-production seam into the real inventory, equipment,
// quest and journal stores; the rendered path remains `/game`.

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PlayShellPage } from '$pom';

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
    await expect(scene.characterEditToggle).toHaveText('Edit character');
    await expect(page.getByRole('spinbutton', { name: 'STR score' })).toHaveCount(0);
    await expect(page.getByText('Saving throw proficiency', { exact: false })).toHaveCount(0);

    await scene.characterEditToggle.click();

    await expect(scene.characterEditToggle).toHaveText('Done editing');
    await expect(page.getByRole('spinbutton', { name: 'STR score' })).toBeVisible();
    await expect(page.getByText('Saving throw', { exact: true }).first()).toBeVisible();
  });

  test('inventory composes equipment, a populated bag and selected details', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('populated');

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
  });

  test('journal defaults to quests and opens note editing only on demand', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'journal');
    await scene.seedManagementContent('populated');

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
  });

  test('inventory remains vertically readable without horizontal overflow', async ({ page }) => {
    const scene = new PlayShellPage(page);
    await openSection(scene, 'inventory');
    await scene.seedManagementContent('populated');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await expect(scene.inventoryDetail).toBeVisible();
  });
});
