// apps/e2e/src/pom/hud_customization_page.ts
// Production HUD customization journeys and persisted-state access.

import type { Locator, Page } from '@playwright/test';

const HUD_PREFERENCES_KEY = 'aikami:hud:preferences';

/** Encapsulates production HUD navigation, editor input, and local persistence. */
export class HudCustomizationPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get menuEntry() {
    return this.page.getByTestId('hud-menu-entry');
  }

  get editor() {
    return this.page.getByTestId('hud-editor');
  }

  get editorUndo() {
    return this.page.getByTestId('hud-editor-undo');
  }

  get editorDiscard() {
    return this.page.getByTestId('hud-editor-discard');
  }

  get settingsInterface() {
    return this.page.getByTestId('settings-interface');
  }

  get recoveryNotice() {
    return this.page.getByTestId('hud-recovery-notice');
  }

  get status() {
    return this.page.getByTestId('hud-status');
  }

  get importError() {
    return this.page.getByTestId('hud-import-error');
  }

  get exportedPreset() {
    return this.page.getByTestId('hud-export-output');
  }

  /** The editor's own status line — how a refused drop explains itself. */
  get editorStatus() {
    return this.page.getByTestId('hud-editor-status');
  }

  dropAnchor(anchor: string) {
    return this.page.getByTestId(`hud-drop-anchor-${anchor}`);
  }

  hudAnchor(anchor: string) {
    return this.page.getByTestId(`hud-anchor-${anchor}`);
  }

  hudWidget(widgetId: string) {
    return this.page.getByTestId(`hud-widget-${widgetId}`);
  }

  editorRow(widgetId: string) {
    return this.page.getByTestId(`hud-editor-row-${widgetId}`);
  }

  /** The drag handle for a widget row (the row center hosts controls). */
  editorDragHandle(widgetId: string) {
    return this.page.getByTestId(`hud-editor-drag-${widgetId}`);
  }

  previewWidget(widgetId: string) {
    return this.page.getByTestId(`hud-preview-${widgetId}`);
  }

  /** The Hidden shelf — the sixth place a widget can be. */
  get hiddenShelf() {
    return this.page.getByTestId('hud-editor-hidden-shelf');
  }

  /** A chip resting on the shelf, i.e. a widget that is off the HUD. */
  shelfWidget(widgetId: string) {
    return this.page.getByTestId(`hud-preview-${widgetId}`);
  }

  /** The row's Hide / Show control. */
  hideWidget(widgetId: string) {
    return this.page.getByTestId(`hud-editor-hide-${widgetId}`);
  }

  /** The Always / When-relevant control for one widget. */
  visibilityControl(widgetId: string) {
    return this.page.getByTestId(`hud-editor-visibility-${widgetId}`);
  }

  /** The Always / When-relevant control's individual button. */
  visibilityOption(widgetId: string, option: 'Always' | 'When relevant') {
    return this.visibilityControl(widgetId).getByRole('button', { name: option, exact: true });
  }

  /** The row's location cell — where the widget currently lives. */
  widgetLocation(widgetId: string) {
    return this.page.getByTestId(`hud-editor-location-${widgetId}`);
  }

  /** Starts each test on a clean production HUD route. */
  async open(): Promise<void> {
    await this.page.goto('/game');
    await this.waitForHud();
    await this.resetStorage();
    await this.reload();
  }

  async waitForHud(): Promise<void> {
    await this.hudAnchor('top-end').waitFor({ state: 'attached', timeout: 30_000 });
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForHud();
  }

  /**
   * Shrinks the window below the old 1100px `bottom-end` cutoff.
   *
   * The default Playwright viewport is wide enough that `bottom-end` was
   * always available, which is why the "the music player is not at the bottom
   * right" regression survived the whole E2E suite.
   */
  async useNarrowWindow(): Promise<void> {
    await this.page.setViewportSize({ width: 780, height: 437 });
    await this.reload();
  }

  async openPauseMenu(): Promise<void> {
    await this.waitForHud();
    await this.page.keyboard.press('Escape');
    await this.page.getByText('Paused', { exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  }

  async openEditor(): Promise<void> {
    await this.openPauseMenu();
    await this.page.getByTestId('pause-customize-hud').click();
    await this.editor.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async selectEditorWidget(widgetId: string): Promise<void> {
    await this.page.getByTestId(`hud-editor-select-${widgetId}`).click();
  }

  async selectPreviewContext(context: string): Promise<void> {
    await this.page.getByTestId(`hud-preview-tab-${context}`).click();
  }

  async pressEditorKey(key: string): Promise<void> {
    await this.editor.press(key);
  }

  async saveEditor(): Promise<void> {
    await this.page.getByTestId('hud-editor-save').click();
  }

  async cancelEditor(): Promise<void> {
    await this.page.getByTestId('hud-editor-cancel').click();
  }

  async resetEditorLayout(): Promise<void> {
    await this.page.getByTestId('hud-editor-reset-layout').click();
  }

  async requestEditorClose(): Promise<void> {
    await this.page.getByTestId('hud-editor-close').click();
  }

  async confirmEditorDiscard(): Promise<void> {
    await this.page.getByTestId('hud-editor-discard-confirm').click();
  }

  async dragWidgetTo(widgetId: string, anchor: string): Promise<void> {
    await this.editorDragHandle(widgetId).scrollIntoViewIfNeeded();
    await this.dragFromTo(
      await this.centerOf(this.editorDragHandle(widgetId)),
      await this.centerOf(this.page.getByTestId(`hud-drop-anchor-${anchor}`)),
    );
  }

  /**
   * Puts keyboard focus inside the editor.
   *
   * The editor handles keys on a `keydown` bound to the modal, so every
   * keyboard gesture — V, H, Tab, Escape — requires focus to be inside it.
   * Pointer tests do not need this; keyboard ones must establish it rather than
   * inherit it from whichever element the pause menu last focused.
   */
  async focusEditor(): Promise<void> {
    await this.editor.evaluate((element) => element.focus());
  }

  /** Presses the mouse on a row's drag handle and leaves it held down. */
  async beginDrag(widgetId: string): Promise<void> {
    await this.editorDragHandle(widgetId).scrollIntoViewIfNeeded();
    const box = await this.editorDragHandle(widgetId).boundingBox();
    if (!box) {
      throw new Error(`begin drag ${widgetId}: handle not visible`);
    }
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
  }

  /** Drags a row's widget onto the Hidden shelf — the "remove it" gesture. */
  async dragWidgetToShelf(widgetId: string): Promise<void> {
    await this.editorDragHandle(widgetId).scrollIntoViewIfNeeded();
    await this.dragFromTo(
      await this.centerOf(this.editorDragHandle(widgetId)),
      await this.centerOf(this.hiddenShelf),
    );
  }

  /** Drags a chip that is already on the shelf back onto a region. */
  async dragShelfWidgetTo(widgetId: string, anchor: string): Promise<void> {
    await this.dragFromTo(
      await this.centerOf(this.shelfWidget(widgetId)),
      await this.centerOf(this.page.getByTestId(`hud-drop-anchor-${anchor}`)),
    );
  }

  private async dragFromTo(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 12 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(200);
  }

  /** Drags a widget that is already placed, from the preview onto another region. */
  async dragPreviewWidgetTo(widgetId: string, anchor: string): Promise<void> {
    await this.dragPreviewWidgetToPoint(
      widgetId,
      await this.centerOf(this.page.getByTestId(`hud-drop-anchor-${anchor}`)),
    );
  }

  /**
   * Drags a preview widget to an absolute viewport point.
   *
   * Used to drop into the dead space BETWEEN regions, which is what a player
   * aiming at a region from a few pixels off actually does.
   */
  async dragPreviewWidgetToPoint(
    widgetId: string,
    point: { readonly x: number; readonly y: number },
  ): Promise<void> {
    const source = await this.previewWidget(widgetId).boundingBox();
    if (!source) {
      throw new Error(`preview drag ${widgetId}: source not visible`);
    }
    await this.page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(point.x, point.y, { steps: 8 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(200);
  }

  private async centerOf(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error('drop target not visible');
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async readStoredPreferences(): Promise<unknown> {
    const raw = await this.page.evaluate((key) => localStorage.getItem(key), HUD_PREFERENCES_KEY);
    return raw === null ? null : JSON.parse(raw);
  }

  async readStorageValue(key: string): Promise<string | undefined> {
    const value = await this.page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
    return value ?? undefined;
  }

  async setStoredPreferences(raw: string): Promise<void> {
    await this.page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: HUD_PREFERENCES_KEY,
      value: raw,
    });
  }

  async seedHiddenHotbar(): Promise<void> {
    await this.setStoredPreferences(
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
  }

  async seedLegacyPreferences(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('aikami:quest-overlay:visible', '0');
      localStorage.setItem('aikami:music-player:visible', '1');
    });
  }

  async gotoInterfaceSettings(): Promise<void> {
    await this.page.goto('/settings?section=interface');
    await this.settingsInterface.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async restoreDefaults(): Promise<void> {
    await this.page.getByTestId('hud-restore-defaults').click();
  }

  async importPreset(preset: unknown): Promise<void> {
    await this.page.getByTestId('hud-import-input').fill(JSON.stringify(preset));
    await this.page.getByTestId('hud-import-apply').click();
  }

  async exportLayout(): Promise<void> {
    await this.page.getByTestId('hud-export-preset').click();
  }

  async toggleHiddenHudAndResume(): Promise<void> {
    await this.page.getByTestId('pause-customize-hud').click();
    await this.page.getByTestId('hud-editor-toggle-visibility').click();
    await this.page.getByTestId('hud-editor-close').click();
    await this.page.getByRole('button', { name: 'Resume Game' }).click();
  }

  async openInGameInterfaceSettings(): Promise<void> {
    await this.openPauseMenu();
    await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await this.page.getByLabel('In-game settings').waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.getByRole('button', { name: 'Interface' }).click();
  }

  async countVisibleHudOverlaps(): Promise<number> {
    return await this.page.evaluate(() => {
      const widgets = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="game-ui-overlay-layer"] [data-hud-widget]',
        ),
      ];
      const boxes = widgets
        .map((widget) => widget.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      let overlaps = 0;
      for (let first = 0; first < boxes.length; first += 1) {
        for (let second = first + 1; second < boxes.length; second += 1) {
          const a = boxes[first];
          const b = boxes[second];
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
  }

  private async resetStorage(): Promise<void> {
    await this.page.evaluate(() => {
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
  }
}
