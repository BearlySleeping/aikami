// apps/e2e/src/pom/appearance_theme_page.ts
// Production appearance/theme settings navigation, controls, and persisted state.

import type { Page } from '@playwright/test';

const APPEARANCE_STORAGE_KEYS = [
  'aikami:theme:selection',
  'aikami:hud:preferences',
  'aikami:motion:preference',
  'aikami:theme:accessibility',
  'aikami:theme:last-good',
] as const;

/** Encapsulates production appearance settings, theme editor controls, and persistence. */
export class AppearanceThemePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get root() {
    return this.page.locator('html');
  }

  get themeScope() {
    return this.page.locator('[data-aikami-theme-scope]');
  }

  get settingsInterface() {
    return this.page.getByTestId('settings-interface');
  }

  get appearanceSurface() {
    return this.page.getByTestId('settings-appearance');
  }

  get resolvedVariant() {
    return this.page.getByTestId('appearance-resolved-variant');
  }

  get recoveryNotice() {
    return this.page.getByTestId('appearance-recovery-notice');
  }

  get restoreDefaultsButton() {
    return this.page.getByTestId('appearance-restore-defaults');
  }

  get resetButton() {
    return this.page.getByTestId('appearance-reset');
  }

  get openEditorButton() {
    return this.page.getByTestId('appearance-open-editor');
  }

  get editor() {
    return this.page.getByTestId('theme-editor');
  }

  get editorPreview() {
    return this.page.getByTestId('theme-editor-preview');
  }

  get editorIssues() {
    return this.page.getByTestId('theme-editor-issues');
  }

  get editorApplyButton() {
    return this.page.getByTestId('theme-editor-apply');
  }

  get editorJson() {
    return this.page.getByTestId('theme-editor-json');
  }

  get editorJsonApplyButton() {
    return this.page.getByTestId('theme-editor-json-apply');
  }

  get editorJsonIssues() {
    return this.page.getByTestId('theme-editor-json-issues');
  }

  get exportButton() {
    return this.page.getByTestId('theme-export');
  }

  get importInput() {
    return this.page.getByTestId('theme-import-input');
  }

  get stagedSummary() {
    return this.page.getByTestId('theme-staged-summary');
  }

  get applyStagedButton() {
    return this.page.getByTestId('theme-apply-staged');
  }

  get cancelStagedButton() {
    return this.page.getByTestId('theme-cancel-staged');
  }

  get packageErrors() {
    return this.page.getByTestId('theme-package-errors');
  }

  get themeLinkInput() {
    return this.page.getByTestId('theme-link-input');
  }

  get themeLinkInstallButton() {
    return this.page.getByTestId('theme-link-install');
  }

  get status() {
    return this.page.getByTestId('hud-status');
  }

  get importError() {
    return this.page.getByTestId('hud-import-error');
  }

  get accessibilitySurface() {
    return this.page.getByTestId('appearance-accessibility');
  }

  get highContrastToggle() {
    return this.page.getByTestId('appearance-high-contrast');
  }

  get opaqueSurfacesToggle() {
    return this.page.getByTestId('appearance-opaque-surfaces');
  }

  get accessibilityChangeSummary() {
    return this.page.getByTestId('appearance-change-summary');
  }

  mode(mode: 'system' | 'light' | 'dark') {
    return this.page.getByTestId(`appearance-mode-${mode}`);
  }

  theme(themeId: string) {
    return this.page.getByTestId(`appearance-theme-${themeId}`);
  }

  editorPreviewContext(context: string) {
    return this.page.getByTestId(`theme-preview-${context}`);
  }

  editorGroup(group: string) {
    return this.page.getByTestId(`theme-editor-group-${group}`);
  }

  editorRole(tokenId: string) {
    return this.page.getByTestId(`theme-editor-role-${tokenId}`);
  }

  /** Opens the production interface section with clean appearance-related state. */
  async openClean(): Promise<void> {
    await this.open();
    await this.page.evaluate((keys) => {
      for (const key of keys) {
        localStorage.removeItem(key);
      }
    }, APPEARANCE_STORAGE_KEYS);
    await this.reload();
  }

  /** Opens the production Interface settings section without changing persisted state. */
  async open(): Promise<void> {
    await this.page.goto('/settings?section=interface');
    await this.appearanceSurface.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.appearanceSurface.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async clearAllStorageAndReload(): Promise<void> {
    await this.page.evaluate(() => localStorage.clear());
    await this.reload();
  }

  async setMode(mode: 'system' | 'light' | 'dark'): Promise<void> {
    await this.mode(mode).click();
  }

  async exportPackage(): Promise<string> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.exportButton.click(),
    ]);
    const path = await download.path();
    if (!path) {
      throw new Error('Exported theme package has no local path.');
    }
    return path;
  }

  async importPackage(path: string): Promise<void> {
    await this.importInput.setInputFiles(path);
  }

  async chooseImportFile(file: {
    readonly name: string;
    readonly mimeType: string;
    readonly buffer: Buffer;
  }): Promise<void> {
    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.page.getByText('Import theme package').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(file);
  }

  async installFromLink(link: string): Promise<void> {
    await this.themeLinkInput.fill(link);
    await this.themeLinkInstallButton.click();
  }

  async openEditor(): Promise<void> {
    await this.openEditorButton.click();
    await this.editor.waitFor({ state: 'visible' });
  }

  async editRole(tokenId: string, value: string): Promise<void> {
    await this.editorRole(tokenId).fill(value);
    await this.editorRole(tokenId).press('Tab');
  }

  async seedCorruptSelectionAndReload(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.setItem('aikami:theme:selection', '{ not json');
    });
    await this.reload();
  }

  async seedHudAndMotion(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.setItem(
        'aikami:hud:preferences',
        JSON.stringify({ schemaVersion: 1, selectedPresetId: 'minimal', overrides: [] }),
      );
      localStorage.setItem('aikami:motion:preference', 'reduce');
    });
  }

  async readPreferenceState(): Promise<{
    readonly selection?: string;
    readonly hud?: string;
    readonly motion?: string;
    readonly installed?: string;
  }> {
    return await this.page.evaluate(() => ({
      selection: localStorage.getItem('aikami:theme:selection') ?? undefined,
      hud: localStorage.getItem('aikami:hud:preferences') ?? undefined,
      motion: localStorage.getItem('aikami:motion:preference') ?? undefined,
      installed: localStorage.getItem('aikami:theme:last-good') ?? undefined,
    }));
  }

  async readRootInlineStyle(): Promise<string> {
    return await this.page.evaluate(() => document.documentElement.getAttribute('style') ?? '');
  }

  async readInjectedThemeCss(): Promise<string> {
    return await this.page.evaluate(
      () => document.getElementById('aikami-theme-scope-style')?.textContent ?? '',
    );
  }

  async measureWarmApplication(): Promise<{
    readonly count: number;
    readonly p50: number;
    readonly p95: number;
  }> {
    return await this.page.evaluate(async () => {
      const times: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const target = index % 2 === 0 ? 'dark' : 'light';
        const input = document.querySelector<HTMLInputElement>(
          `[data-testid="appearance-mode-${target}"] input`,
        );
        if (input === null) {
          continue;
        }
        const start = performance.now();
        input.click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        if (document.documentElement.getAttribute('data-theme') === target) {
          times.push(performance.now() - start);
        }
      }
      times.sort((left, right) => left - right);
      const at = (quantile: number): number =>
        times.length === 0
          ? Number.NaN
          : (times[Math.min(times.length - 1, Math.floor(quantile * times.length))] ?? Number.NaN);
      return { count: times.length, p50: at(0.5), p95: at(0.95) };
    });
  }
}
