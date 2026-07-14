// apps/e2e/src/pom/macro_system_page.ts
// Page Object Model — MacroSystemPage
//
// Encapsulates locators and interaction primitives for the Macro
// Template Sandbox (/dev/macros) and preset editor (C-237).
// Covers template editing, context mock fields, live macro resolution,
// autocomplete, preset CRUD, and the resolved output panel.
//
// DOM reference: apps/frontend/client/src/routes/(dev)/dev/macros/+page.svelte
//                 apps/frontend/client/src/lib/views/presets/preset_editor_view.svelte

import type { Page } from '@playwright/test';

export class MacroSystemPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the macro template dev sandbox. */
  async gotoSandbox(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/macros', {
      waitUntil: 'domcontentloaded',
    });
    await this.waitReady();
  }

  /** Wait for sandbox UI to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('h1', { timeout: 10_000 });
    await this.page.waitForTimeout(500);
  }

  // ── Template Editor ───────────────────────────────────────

  /** The main template textarea (first textarea on the page). */
  get templateEditor() {
    return this.page.locator('textarea').first();
  }

  /** Type into the template editor and trigger Svelte reactivity. */
  async typeTemplate(text: string): Promise<void> {
    await this.templateEditor.fill(text);
    await this.templateEditor.dispatchEvent('input');
    await this.page.waitForTimeout(300);
  }

  /** Type trigger text for autocomplete using keyboard (simulates real typing). */
  async typeTrigger(text: string): Promise<void> {
    await this.templateEditor.click();
    await this.templateEditor.fill('');
    await this.page.keyboard.type(text, { delay: 30 });
    await this.page.waitForTimeout(500);
  }

  // ── Context Inputs ────────────────────────────────────────

  /**
   * Returns the input/textarea for a context mock field.
   * Matches the label text and returns its associated .input or .textarea.
   */
  contextInput(label: string) {
    return this.page.locator('label.form-control', { hasText: label }).locator('input, textarea');
  }

  /** Set a context mock field value. */
  async setContextField(label: string, value: string): Promise<void> {
    const input = this.contextInput(label);
    await input.fill(value);
    await input.dispatchEvent('input');
    await this.page.waitForTimeout(300);
  }

  // ── Resolved Output ───────────────────────────────────────

  /** The resolved output pre block on the right panel. */
  get resolvedOutput() {
    return this.page.locator('pre').first();
  }

  /** Assert the resolved output contains text. */
  async expectResolved(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.resolvedOutput).toContainText(text, { timeout: 5_000 });
  }

  /** Assert the resolved output does NOT contain text. */
  async expectResolvedNot(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.resolvedOutput).not.toContainText(text, { timeout: 5_000 });
  }

  // ── Preset Selector ───────────────────────────────────────

  /** The preset select dropdown. */
  get presetSelector() {
    return this.page.locator('select.select-bordered');
  }

  /** Select a preset by its value attribute (id). */
  async selectPresetById(id: string): Promise<void> {
    await this.presetSelector.selectOption({ value: id });
    await this.page.waitForTimeout(500);
  }

  // ── Autocomplete ──────────────────────────────────────────

  /** The autocomplete dropdown container. */
  get autocompleteDropdown() {
    return this.page.locator('.fixed.z-\\[9998\\]');
  }

  /** The autocomplete menu items (each macro button). */
  get autocompleteItems() {
    return this.autocompleteDropdown.locator('button');
  }

  /** Select a macro from the autocomplete dropdown by name. */
  async selectMacro(name: string): Promise<void> {
    await this.autocompleteDropdown.locator(`text=${name}`).first().click();
    await this.page.waitForTimeout(200);
  }

  /** Assert that the autocomplete dropdown is visible and has items. */
  async expectAutocompleteVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    // Wait for the dropdown to appear
    await expect(this.autocompleteDropdown).toBeAttached({ timeout: 5_000 });
    // Wait for at least one macro option to render
    await expect(this.autocompleteItems.first()).toBeVisible({ timeout: 5_000 });
  }

  /** Assert that the autocomplete dropdown is NOT visible. */
  async expectAutocompleteHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    // The dropdown wrapper may still be in DOM but empty — check that
    // either the wrapper is absent or has no visible items
    try {
      await expect(this.autocompleteItems.first()).not.toBeVisible({ timeout: 3_000 });
    } catch {
      // If the wrapper itself is absent, that's also fine
      await expect(this.autocompleteDropdown).not.toBeAttached({ timeout: 1_000 });
    }
  }

  // ── Preset Editor (bottom section) ────────────────────────

  /** The + New button for creating presets. */
  get newPresetButton() {
    return this.page.locator('button', { hasText: '+ New' });
  }

  /** The preset name input (visible in new preset mode). */
  get presetNameInput() {
    return this.page.locator('input[placeholder="My Custom Preset"]');
  }

  /** The new section name input. */
  get sectionNameInput() {
    return this.page.locator('input[placeholder="New section name..."]');
  }

  /** The + Add Section button. */
  get addSectionButton() {
    return this.page.locator('button', { hasText: '+ Add Section' });
  }

  /** The Save Preset button. */
  get savePresetButton() {
    return this.page.locator('button', { hasText: 'Save Preset' });
  }

  /** The Discard button. */
  get discardButton() {
    return this.page.locator('button', { hasText: 'Discard' });
  }

  /** The Duplicate button (visible when editing an existing preset). */
  get duplicateButton() {
    return this.page.locator('button', { hasText: 'Duplicate' });
  }

  /** The Delete button (visible when editing a user preset). */
  get deleteButton() {
    return this.page.locator('button', { hasText: 'Delete' });
  }

  /** Click a preset in the sidebar list by name. */
  async clickPresetInList(name: string): Promise<void> {
    await this.page.locator('button.btn.btn-sm', { hasText: name }).click();
    await this.page.waitForTimeout(300);
  }

  /** Create a new preset with sections. */
  async createPreset(
    name: string,
    sections: Array<{ sectionName: string; content: string }>,
  ): Promise<void> {
    await this.newPresetButton.click();
    await this.page.waitForTimeout(300);

    // Fill preset name
    await this.presetNameInput.fill(name);

    // Add each section
    for (const s of sections) {
      await this.sectionNameInput.fill(s.sectionName);
      await this.sectionNameInput.dispatchEvent('input');
      await this.page.waitForTimeout(100);
      await this.addSectionButton.click();
      await this.page.waitForTimeout(300);

      // Find the section card's textarea — DaisyUI may transform card classes.
      // Use a combined approach: find textarea inside an element with bg-base-200
      // that also has a sibling section name input (distinguishes from template textarea).
      const allTextareas = this.page.locator('textarea');
      const count = await allTextareas.count();
      // The section textarea is the last textarea on the page when in new-preset mode
      // (there are also textareas for chatHistory and characterDescription context fields)
      const sectionTextarea = allTextareas.nth(count - 1);
      await sectionTextarea.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(200);
      await sectionTextarea.fill(s.content, { force: true });
      await sectionTextarea.fill(s.content);
      await sectionTextarea.dispatchEvent('input');
      await this.page.waitForTimeout(100);
    }

    // Save
    await this.savePresetButton.click();
    await this.page.waitForTimeout(500);
  }

  // ── DevTools Actions ──────────────────────────────────────

  /** Click a DevTools action button by label. */
  async clickDevAction(label: string): Promise<void> {
    const slug = label.toLowerCase().replace(/\s+/g, '-');
    const button = this.page.locator(`[data-testid="dev-action-${slug}"]`);
    await button.click();
    await this.page.waitForTimeout(500);
  }

  // ── Sandbox Header ────────────────────────────────────────

  /** The sandbox page title (first h1). */
  get pageTitle() {
    return this.page.locator('h1').first();
  }

  /** Assert the sandbox header is visible with correct title. */
  async expectHeader(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.pageTitle).toHaveText('Macro Template Sandbox');
  }

  // ── Split Panel ───────────────────────────────────────────

  /** Assert both left and right panels are visible. */
  async expectSplitPanel(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.templateEditor).toBeVisible();
    await expect(this.resolvedOutput).toBeVisible();
  }
}
