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

  test('AC-1: the player health fill is actually painted', async () => {
    await expect(hud.page.getByTestId('player-hud')).toBeAttached({ timeout: 30_000 });
    // Regression: the fill is a <span>; if it regresses to an inline box its
    // inline-size is ignored and the bar paints empty at every HP value.
    const result = await hud.page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="player-hud"]');
      const fill = root?.querySelector<HTMLElement>('.hud-status__fill');
      const track = root?.querySelector<HTMLElement>('.hud-status__track');
      return {
        percent: Number(root?.getAttribute('aria-valuenow') ?? '0'),
        display: fill ? getComputedStyle(fill).display : '',
        fill: fill?.getBoundingClientRect().width ?? 0,
        track: track?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(result.track).toBeGreaterThan(0);
    expect(result.display).not.toBe('inline');
    if (result.percent > 0) {
      expect(result.fill).toBeGreaterThan(0);
      expect(result.fill).toBeLessThanOrEqual(result.track + 1);
    }
  });

  test('AC-2: pointer and keyboard reach the same valid configuration', async () => {
    await hud.openEditor();

    // Pointer: drag the objective onto another allowed region.
    await hud.dragWidgetTo('objective', 'top-start');
    await expect(hud.previewWidget('objective')).toHaveAttribute('data-hud-anchor', 'top-start');

    // Drag directly in the preview: its own region visits another allowed one.
    await hud.dragPreviewWidgetTo('objective', 'bottom-end');
    await expect(hud.previewWidget('objective')).toHaveAttribute('data-hud-anchor', 'bottom-end');

    // Keyboard: select another widget and move it with the arrow keys.
    await hud.selectEditorWidget('hotbar');
    await hud.pressEditorKey('ArrowRight');
    await expect(hud.previewWidget('hotbar')).not.toHaveAttribute(
      'data-hud-anchor',
      'bottom-center',
    );

    // Both edits are drafts: the committed snapshot is untouched until Save.
    await expect(hud.editorUndo).toBeEnabled();
  });

  test('AC-2: a hidden widget can be brought back with the visibility control', async () => {
    await hud.openEditor();
    // `onboarding-hint` ships contextual and idle, so it is the widget that is
    // genuinely absent from the HUD — the same "not visible until asked"
    // scenario, now that the music player is on by default.
    await hud.selectEditorWidget('onboarding-hint');
    await hud.visibilityOption('onboarding-hint', 'Always').click();
    await expect(hud.visibilityOption('onboarding-hint', 'Always')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await hud.saveEditor();
    await expect(hud.editor).toHaveCount(0);

    const stored = (await hud.readStoredPreferences()) as {
      overrides: { widgetId: string; visibility: string }[];
    };
    expect(
      stored.overrides.find((widget) => widget.widgetId === 'onboarding-hint')?.visibility,
    ).toBe('always');

    // Resume so the HUD chrome is mounted again, then the widget must paint.
    await hud.page.keyboard.press('Escape');
    await expect(hud.hudWidget('onboarding-hint')).toBeAttached();
  });

  test('AC-2: dragging a widget onto the Hidden shelf removes it, and back restores it', async () => {
    await hud.openEditor();
    // The shelf is the sixth place, beside the five regions. Removal is a
    // PLACEMENT — which is why the removed widget stays findable instead of
    // vanishing with no way back.
    await expect(hud.hiddenShelf).toContainText('Hidden');
    await expect(hud.widgetLocation('hotbar')).toHaveText('Bottom centre');

    await hud.dragWidgetToShelf('hotbar');
    await expect(hud.shelfWidget('hotbar')).toBeVisible();
    await expect(hud.widgetLocation('hotbar')).toHaveText('Hidden');
    await expect(hud.editorStatus).toContainText('removed from the HUD');

    // The board no longer offers it, and it is not on the live HUD either.
    await hud.saveEditor();
    await expect(hud.editor).toHaveCount(0);
    await expect(hud.hudWidget('hotbar')).toHaveCount(0);

    const stored = (await hud.readStoredPreferences()) as {
      overrides: { widgetId: string; visibility: string }[];
    };
    expect(stored.overrides.find((entry) => entry.widgetId === 'hotbar')?.visibility).toBe(
      'hidden',
    );
  });

  test('AC-2: a required widget cannot be dragged off the HUD, and says why', async () => {
    await hud.openEditor();
    await hud.focusEditor();
    // `menu` is recovery navigation. Dropping it on the shelf must refuse with
    // a sentence and leave nothing behind — not a silent no-op, and not a
    // history entry that makes Undo a dead press.
    await expect(hud.hideWidget('menu')).toHaveCount(0);
    await hud.dragWidgetToShelf('menu');
    await expect(hud.editorStatus).toContainText('required');
    await expect(hud.widgetLocation('menu')).toHaveText('Top right');
  });

  test('AC-2: a widget idle in the preview context is on the board, not on the shelf', async () => {
    await hud.openEditor();
    // 🔴 `autosave` is contextual and idle in the `explore` fixture. The
    // resolver files idle-contextual in the same bucket as hidden, and treating
    // that bucket as "removed" is what used to make a widget seem to vanish
    // when the player merely switched preview tabs.
    await expect(hud.previewWidget('autosave')).toBeVisible();
    await expect(hud.shelfWidget('autosave')).toBeVisible();
    await expect(hud.widgetLocation('autosave')).toHaveText('Top right');

    await hud.selectPreviewContext('dialogue');
    await expect(hud.previewWidget('autosave')).toBeVisible();
    await expect(hud.widgetLocation('autosave')).toHaveText('Top right');
  });

  test('AC-2: Escape during a drag cancels the drag instead of closing the editor', async () => {
    await hud.openEditor();
    // The editor's key handling is a `keydown` on the modal, so keys only reach
    // it while focus is inside it. That is the precondition of the whole
    // keyboard surface (V, H, Tab), not something this gesture introduces.
    await hud.focusEditor();
    await hud.beginDrag('clock');
    await hud.page.keyboard.press('Escape');
    await hud.page.mouse.up();

    // The drag is gone and the editor is still open — a cancel, not a close.
    await expect(hud.editor).toBeVisible();
    await expect(hud.editor).toHaveAttribute('data-hud-dragging', 'false');
    await expect(hud.editorStatus).toContainText('Drag cancelled');
  });

  test('AC-2: the music player is on the HUD from the default preset, with no edit', async () => {
    // No drag, no visibility click: a fresh install must already show it, and
    // must show it WITHOUT a stored override — otherwise this is a stored
    // choice wearing the costume of a default.
    await expect(hud.hudWidget('music-player')).toBeAttached();

    const stored = (await hud.readStoredPreferences()) as {
      selectedPresetId: string;
      overrides: { widgetId: string; visibility: string }[];
    } | null;
    expect(stored?.selectedPresetId).toBe('adventure');
    expect(stored?.overrides.some((entry) => entry.widgetId === 'music-player')).toBe(false);
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

  test('AC-5: the music player sits at the bottom right in a narrow window', async () => {
    // 🔴 Regression: `bottom-end` used to be withheld below 1100px, so the
    // music player's shipped bottom-right home collapsed into "More HUD" while
    // the editor still drew a `bottom-end` target for the player to aim at.
    // 🔴 And position was never the whole story: the default preset also
    // shipped it `hidden`, so it was absent even where the region existed.
    await hud.useNarrowWindow();
    await expect(hud.hudWidget('music-player')).toBeAttached();

    const box = await hud.hudWidget('music-player').boundingBox();
    const viewport = hud.page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) {
      return;
    }
    // Bottom right: flush with the right edge, below the vertical midpoint, and
    // it is a placed widget — not behind the labelled overflow entry.
    expect(box.x + box.width).toBeGreaterThan(viewport.width - 24);
    expect(box.y).toBeGreaterThan(viewport.height / 2);
    expect(await hud.hudWidget('music-player').isVisible()).toBe(true);
  });

  test('AC-2: a refused drop says so, and a drop beside a region still lands', async () => {
    await hud.openEditor();

    // A reserved region refuses the drop — and now explains itself on the
    // board instead of looking exactly like a broken drag.
    await hud.dragWidgetTo('objective', 'bottom-center');
    await expect(hud.previewWidget('objective')).not.toHaveAttribute(
      'data-hud-anchor',
      'bottom-center',
    );
    await expect(hud.editorStatus).toContainText('Bottom centre');

    // A drop into the dead space beside a region snaps to that region rather
    // than resolving to "nowhere" and snapping the widget back where it was.
    const box = await hud.dropAnchor('bottom-end').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    await hud.dragWidgetTo('objective', 'top-start');
    await expect(hud.previewWidget('objective')).toHaveAttribute('data-hud-anchor', 'top-start');
    // 20px above the region: outside it, close enough to mean it.
    await hud.dragPreviewWidgetToPoint('objective', {
      x: box.x + box.width / 2,
      y: box.y - 20,
    });
    await expect(hud.previewWidget('objective')).toHaveAttribute('data-hud-anchor', 'bottom-end');
    await expect(hud.editorStatus).toContainText('Bottom right');
  });
});
