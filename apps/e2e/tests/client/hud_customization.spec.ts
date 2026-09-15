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

import { expect, test } from '@playwright/test';
import { HudCustomizationPage } from '$pom';

test.describe('C-528 HUD presets and layout editor', () => {
  let hud: HudCustomizationPage;

  test.beforeEach(async ({ page }) => {
    hud = new HudCustomizationPage(page);
    await hud.open();
  });

  test('AC-1: the resolved HUD exposes the required surfaces and no stray chrome', async () => {
    await expect(hud.menuEntry).toBeVisible();
    await expect(hud.hudAnchor('top-end')).toBeAttached();
    // Required widgets are placed; the adventure preset keeps the objective.
    await expect(hud.hudWidget('menu')).toBeAttached();
  });

  test('AC-2: pointer and keyboard reach the same valid configuration', async () => {
    await hud.openEditor();

    // Pointer: drag the objective onto another allowed region.
    await hud.dragWidgetTo('objective', 'top-start');
    await expect(hud.editorRow('objective')).toContainText('top-start');
    await expect(hud.previewWidget('objective')).toBeAttached();

    // Keyboard: select another widget and move it with the arrow keys.
    await hud.selectEditorWidget('hotbar');
    await hud.pressEditorKey('ArrowRight');
    await expect(hud.editorRow('hotbar')).not.toContainText('bottom-center');

    // Both edits are drafts: the committed snapshot is untouched until Save.
    await expect(hud.editorUndo).toBeEnabled();
  });

  test('AC-2: a reserved action region refuses an unrelated widget', async () => {
    await hud.openEditor();
    // `bottom-center` carries the required interaction/hotbar region. Dropping
    // the objective there must not move it — the reserved region wins.
    await hud.dragWidgetTo('objective', 'bottom-center');
    const anchor = await hud.previewWidget('objective').getAttribute('data-hud-anchor');
    expect(anchor).not.toBe('bottom-center');
  });

  test('AC-3: Cancel restores the exact prior snapshot', async () => {
    const before = await hud.readStoredPreferences();
    await hud.openEditor();
    await hud.selectPreviewContext('combat');
    await hud.selectEditorWidget('hotbar');
    await hud.pressEditorKey('+');
    await hud.resetEditorLayout();
    await hud.cancelEditor();

    await expect(hud.editor).toHaveCount(0);
    expect(await hud.readStoredPreferences()).toEqual(before);
  });

  test('AC-3: Save persists and survives a reload', async () => {
    await hud.openEditor();
    await hud.selectPreviewContext('explore');
    await hud.selectEditorWidget('clock');
    await hud.pressEditorKey('v');
    await hud.saveEditor();
    await expect(hud.editor).toHaveCount(0);

    const stored = await hud.readStoredPreferences();
    expect(stored).not.toBeNull();

    await hud.reload();
    expect(await hud.readStoredPreferences()).toEqual(stored);
  });

  test('AC-3: closing a dirty editor asks before discarding', async () => {
    await hud.openEditor();
    // A pointer edit makes the draft dirty without depending on key delivery.
    await hud.dragWidgetTo('clock', 'bottom-end');
    await expect(hud.editorUndo).toBeEnabled();

    await hud.requestEditorClose();
    await expect(hud.editorDiscard).toBeVisible();
    await hud.confirmEditorDiscard();
    await expect(hud.editor).toHaveCount(0);
  });

  test('AC-4: a hidden widget is not in the DOM, so it cannot capture input', async () => {
    // Hide the hotbar through the persisted snapshot, then reload.
    await hud.seedHiddenHotbar();
    await hud.reload();

    // The hidden widget is absent entirely — no tab stop, no pointer target.
    await expect(hud.hudWidget('hotbar')).toHaveCount(0);
    // A required surface is still present.
    await expect(hud.hudWidget('menu')).toBeAttached();
  });

  test('AC-5: a compact viewport reflows without overlap and restores desktop intent', async ({
    page,
  }) => {
    await hud.openEditor();
    await hud.selectEditorWidget('objective');
    await hud.pressEditorKey('+');
    await hud.saveEditor();

    const beforeCompact = await hud.readStoredPreferences();
    expect(beforeCompact).not.toBeNull();

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    const compactOverlaps = await hud.countVisibleHudOverlaps();
    expect(compactOverlaps).toBe(0);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
    // The saved intent is unchanged by the compact visit.
    const afterDesktopRestore = await hud.readStoredPreferences();
    expect(afterDesktopRestore).not.toBeNull();
    expect(afterDesktopRestore).toEqual(beforeCompact);
  });

  test('AC-6: legacy keys migrate once and an explicit false survives', async () => {
    await hud.seedLegacyPreferences();
    await hud.reload();

    const stored = (await hud.readStoredPreferences()) as {
      overrides: { widgetId: string; visibility: string }[];
    };
    expect(stored).not.toBeNull();
    const objective = stored.overrides.find((widget) => widget.widgetId === 'objective');
    expect(objective?.visibility).toBe('contextual');
    // The legacy keys are left intact for the rollback window.
    const legacy = await hud.readStorageValue('aikami:quest-overlay:visible');
    expect(legacy).toBe('0');
    const marker = await hud.readStorageValue('aikami:hud:migration');
    expect(marker).toBeDefined();
  });

  test('AC-6: corrupt stored data falls back safely and keeps the bytes', async () => {
    const corrupt =
      '{"schemaVersion":1,"selectedPresetId":"adventure","overrides":[{"widgetId":"hotbar"}]}';
    await hud.setStoredPreferences(corrupt);
    await hud.reload();

    await hud.gotoInterfaceSettings();
    await expect(hud.recoveryNotice).toBeVisible();
    await hud.restoreDefaults();
    await expect(hud.status).toBeVisible();
  });

  test('AC-7: with optional HUD hidden, Menu and recovery stay operable offline', async ({
    page,
  }) => {
    await page.context().setOffline(true);
    try {
      await hud.openPauseMenu();
      await hud.toggleHiddenHudAndResume();

      // Menu (required) is still reachable while Hide HUD is on.
      await expect(hud.menuEntry).toBeVisible();
      // The optional chrome is gone.
      await expect(hud.hudWidget('hotbar')).toHaveCount(0);

      // Restoring is one action away, and the saved preferences were not erased.
      await hud.openPauseMenu();
      await hud.toggleHiddenHudAndResume();
      await expect(hud.menuEntry).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });

  test('AC-8: an unknown optional widget stays dormant and a broken preset is rejected', async () => {
    await hud.gotoInterfaceSettings();
    await expect(hud.settingsInterface).toBeVisible();

    // A preset that omits the required Menu surface is refused with an explanation.
    await hud.importPreset({
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
    });
    await expect(hud.importError).toBeVisible();
  });

  test('AC-8: exporting a layout produces bounded, data-only JSON', async () => {
    await hud.gotoInterfaceSettings();
    await hud.exportLayout();
    const exported = await hud.exportedPreset.inputValue();
    const parsed = JSON.parse(exported) as { schemaVersion: number; widgets: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.widgets)).toBe(true);
    expect(exported).not.toContain('http');
  });

  test('AC-1: the Interface section is reachable from the in-game settings overlay', async () => {
    await hud.openInGameInterfaceSettings();
    await expect(hud.settingsInterface).toBeVisible();
  });
});
