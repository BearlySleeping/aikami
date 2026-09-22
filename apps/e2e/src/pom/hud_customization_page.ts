// apps/e2e/src/pom/hud_customization_page.ts
// Production HUD customization journeys and persisted-state access.

import type { Page } from '@playwright/test';

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
    const source = await this.editorDragHandle(widgetId).boundingBox();
    const target = await this.page.getByTestId(`hud-drop-anchor-${anchor}`).boundingBox();
    if (!source || !target) {
      throw new Error(`drag ${widgetId} -> ${anchor}: source or target not visible`);
    }
    await this.page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 8,
    });
    await this.page.mouse.up();
    await this.page.waitForTimeout(200);
  }

  /** Drags a widget that is already placed, from the preview onto another region. */
  async dragPreviewWidgetTo(widgetId: string, anchor: string): Promise<void> {
    const source = await this.previewWidget(widgetId).boundingBox();
    const target = await this.page.getByTestId(`hud-drop-anchor-${anchor}`).boundingBox();
    if (!source || !target) {
      throw new Error(`preview drag ${widgetId} -> ${anchor}: source or target not visible`);
    }
    await this.page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 8,
    });
    await this.page.mouse.up();
    await this.page.waitForTimeout(200);
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
    await this.page.getByTestId('pause-hide-hud').click();
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
