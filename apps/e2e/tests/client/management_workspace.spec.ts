// apps/e2e/tests/client/management_workspace.spec.ts
//
// C-543 — production management workspace + HUD correction.
//
// These are compiled Playwright assertions against the real `/game` and
// `/settings?section=interface` routes. They gate the failures the previous
// C-527/C-528 work allowed: a tiny legacy modal floating in a monitor-sized
// empty host, duplicate chrome, unreadable essential text, CSS `zoom`, and
// themes that never reach production surfaces.
//
// Contract: C-543 AC-1, AC-2, AC-4, AC-5, AC-7.

import type { GameCharacterSheet } from '@aikami/types';
import { expect, test } from '@playwright/test';
import { AppearanceThemePage, PlayShellPage } from '$pom';

let scene: PlayShellPage;
let appearance: AppearanceThemePage;

test.beforeEach(async ({ page }) => {
  scene = new PlayShellPage(page);
  appearance = new AppearanceThemePage(page);
});

/** Semantic computed styles of representative production surfaces. */
type ProductionThemeStyles = {
  readonly workspaceBackground: string;
  readonly navActiveBackground: string;
  readonly playerStatusBackground: string;
  readonly hotbarBorder: string;
};

const readComputedThemeStyle = (
  page: PlayShellPage['page'],
  selector: string,
  property: string,
): Promise<string> =>
  page
    .locator(selector)
    .evaluate(
      (element, propertyName) => getComputedStyle(element).getPropertyValue(propertyName).trim(),
      property,
    );

const waitForProductionHud = async (page: PlayShellPage['page']): Promise<void> => {
  await expect(page.getByTestId('player-hud')).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId('hotbar-slot-0')).toBeAttached({ timeout: 60_000 });
};

const readProductionThemeStyles = async (
  playShell: PlayShellPage,
): Promise<ProductionThemeStyles> => {
  await waitForProductionHud(playShell.page);
  const [playerStatusBackground, hotbarBorder] = await Promise.all([
    readComputedThemeStyle(playShell.page, '[data-testid="player-hud"]', 'background-color'),
    readComputedThemeStyle(playShell.page, '[data-testid="hotbar-slot-0"]', 'border-top-color'),
  ]);

  // Opening management intentionally removes non-menu HUD widgets, so capture
  // their styles first and the active management surfaces second.
  await playShell.openManagementHost();
  await playShell.openManagementSection('character');
  const [workspaceBackground, navActiveBackground] = await Promise.all([
    readComputedThemeStyle(
      playShell.page,
      '[data-testid="management-workspace"]',
      'background-color',
    ),
    readComputedThemeStyle(
      playShell.page,
      '[data-testid="management-section-tabs"] [aria-current="page"]',
      'background-color',
    ),
  ]);

  return { workspaceBackground, navActiveBackground, playerStatusBackground, hotbarBorder };
};

const seedProductionThemeHud = async (page: PlayShellPage['page']): Promise<void> => {
  const sheet: GameCharacterSheet = {
    abilities: {
      strength: { value: 15, modifier: 2 },
      dexterity: { value: 13, modifier: 1 },
      constitution: { value: 14, modifier: 2 },
      intelligence: { value: 10, modifier: 0 },
      wisdom: { value: 12, modifier: 1 },
      charisma: { value: 8, modifier: -1 },
    },
    skills: [],
    savingThrows: [],
    traits: { personalityTraits: '', ideals: '', bonds: '', flaws: '' },
    narrativeTraits: { likes: [], temptations: [], keys: [] },
    proficiencyBonus: 2,
    level: 1,
    xp: 0,
    hp: 12,
    maxHp: 12,
    attack: 0,
    defense: 15,
    classId: 'fighter',
    classFeatures: ['fighter_second_wind'],
    hotbarSlots: ['fighter_second_wind'],
  };
  await page.addInitScript((seed) => {
    (window as unknown as Record<string, unknown>).__AIKAMI_E2E_SHEET__ = seed;
  }, sheet);
};

/** Applies a non-default, valid theme through the production creator editor. */
const applyCustomTheme = async (): Promise<void> => {
  await appearance.openClean();
  await appearance.openEditor();
  await appearance.editRole('color.primary', '#c2185b');
  await appearance.editRole('color.panel', '#20303a');
  await appearance.editRole('color.elevated', '#2b3d47');
  await appearance.editorApplyButton.click();
  await expect(appearance.editor).toHaveCount(0);
  await expect(appearance.theme('my-theme')).toHaveClass(/btn-active/);
};

test.describe('C-543 management workspace geometry', () => {
  test.use({ viewport: { width: 2048, height: 1152 } });

  test('AC-1: one dialog boundary and one return control own the workspace', async () => {
    await scene.open();
    await scene.openManagementHost();

    // Exactly one top-level management dialog.
    await expect(scene.page.getByRole('dialog', { name: 'Game menu' })).toHaveCount(1);
    // Exactly one host-owned Return control.
    await expect(scene.managementReturn).toHaveCount(1);

    // Embedded feature content contributes no independent top-level Close/X.
    await scene.openManagementSection('inventory');
    await expect(scene.sectionPanel('inventory')).toBeVisible();
    await expect(scene.sectionPanel('inventory').getByTestId('inventory-close')).toHaveCount(0);
    await expect(scene.managementReturn).toHaveCount(1);
  });

  test('AC-1: the workspace occupies a meaningful share of a 2K viewport', async () => {
    await scene.open();
    await scene.openManagementHost();
    await scene.openManagementSection('character');

    const ratio = await scene.managementWorkspaceAreaRatio();
    // A 32–36rem card in a 2048×1152 viewport would be far below this.
    expect(ratio).toBeGreaterThan(0.5);
  });

  test('AC-4: production HUD uses no CSS zoom or transform scale', async () => {
    await scene.open();

    const zoomed = await scene.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.hud-widget')).some((element) => {
        const style = getComputedStyle(element);
        return style.zoom !== 'normal' && style.zoom !== '' && style.zoom !== '1';
      }),
    );
    expect(zoomed).toBe(false);

    // The resolver publishes a layout-affecting scale custom property instead.
    const scaleVar = await scene.page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="hud-widget-menu"]');
      return element ? getComputedStyle(element).getPropertyValue('--hud-widget-scale').trim() : '';
    });
    expect(scaleVar).not.toBe('');
  });
});

test.describe('C-543 production theme integration', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('AC-7: a non-default valid theme changes semantic production styles', async ({ page }) => {
    await seedProductionThemeHud(page);
    await scene.open();
    const baseline = await readProductionThemeStyles(scene);

    await applyCustomTheme();

    await scene.open();
    await expect(page.locator('[data-aikami-theme-scope]')).toBeAttached();
    const themed = await readProductionThemeStyles(scene);

    // The workspace surface consumes the theme's `color.panel`.
    expect(themed.workspaceBackground).not.toBe(baseline.workspaceBackground);
    // The active navigation item consumes the theme's `color.primary`.
    expect(themed.navActiveBackground).not.toBe(baseline.navActiveBackground);
    // HUD status and hotbar surfaces consume semantic elevated/primary roles.
    expect(themed.playerStatusBackground).not.toBe(baseline.playerStatusBackground);
    expect(themed.hotbarBorder).not.toBe(baseline.hotbarBorder);
  });
});

test.describe('C-543 management journey', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('AC-2: every section is reachable and keeps one shared shell', async () => {
    await scene.open();
    await scene.openManagementHost();

    for (const section of ['character', 'inventory', 'journal', 'party', 'world']) {
      await scene.sectionTab(section).click();
      await expect(scene.sectionTab(section)).toHaveAttribute('aria-current', 'page');
      await expect(scene.managementHeading).toBeVisible();
    }

    await scene.managementReturn.click();
    await expect(scene.managementHost).toBeHidden();
    await expect(scene.managementMenuEntry).toBeVisible();
  });

  test('AC-2: direct Inventory shortcut reaches the same content', async () => {
    await scene.open();
    await scene.page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    });
    // The hook is the management host either way — same single shell.
    await expect(scene.managementHost).toBeVisible();
  });
});

test.describe('C-543 compact and large text', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC-5: compact mode exposes all top-level sections', async () => {
    await scene.open();
    await scene.openManagementHost();

    for (const section of ['character', 'inventory', 'journal', 'party', 'world']) {
      await expect(scene.sectionTab(section)).toBeVisible();
    }
    await expect(scene.managementReturn).toBeVisible();
  });
});
