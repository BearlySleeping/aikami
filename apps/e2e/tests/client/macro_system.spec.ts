// apps/e2e/tests/client/macro_system.spec.ts
//
// C-237: Prompt Template Macro System — E2E functional tests.
//
// Acceptance Criteria:
//   AC-2: Verify built-in preset list, selection, delete prevention.
//   AC-3: Type `{{us` → autocomplete → select → verify inserted.
//   AC-4: Select preset → verify resolved text + live resolution.
//   AC-5: Navigate to /dev/macros → verify split-panel, live resolution.
//
// Note: Preset CRUD (create/save/delete user presets) is covered by
// 29 unit tests in preset_store.test.ts. E2E focuses on sandbox UX.

import { expect, test } from '@playwright/test';
import { MacroSystemPage } from '$pom';

test.describe('Macro Template System — C-237', () => {
  let macros: MacroSystemPage;

  test.beforeEach(async ({ page }) => {
    macros = new MacroSystemPage(page);
    await macros.gotoSandbox();
  });

  // ── AC-5: Sandbox renders and live resolution works ──────

  test.describe('AC-5 — Dev Sandbox', () => {
    test('should render the macro sandbox header and split-panel layout', async () => {
      await macros.expectHeader();
      await macros.expectSplitPanel();
    });

    test('should show the default template in the editor', async () => {
      const value = await macros.templateEditor.inputValue();
      expect(value).toContain('{{char}}');
      expect(value).toContain('{{personality}}');
    });

    test('should resolve macros to context values on load', async () => {
      await macros.expectResolved('Alice');
      await macros.expectResolved('Thorn');
    });

    test('should update resolution on template text input', async () => {
      await macros.typeTemplate('Hello {{user}}, meet {{char}}!');
      await macros.expectResolved('Hello Alice, meet Thorn!');
    });

    test('should update resolution when context field changes', async () => {
      await macros.setContextField('userName', 'Bob');
      await macros.expectResolved('Bob');
    });

    test('should handle unknown macros — pass-through unchanged', async () => {
      await macros.typeTemplate('{{unknown_macro}} should stay');
      await macros.expectResolved('{{unknown_macro}} should stay');
    });

    test('should show empty output when template is empty', async () => {
      await macros.typeTemplate('');
      const text = await macros.resolvedOutput.textContent();
      expect(text?.trim()).toBe('No content to preview.');
    });
  });

  // ── AC-2: Built-in Preset Verification ────────────────────

  test.describe('AC-2 — Preset Verification', () => {
    test('should show built-in presets in the sidebar', async () => {
      await expect(macros.page.locator('button', { hasText: 'Roleplay' })).toBeVisible();
      await expect(macros.page.locator('button', { hasText: 'Simple Chat' })).toBeVisible();
      await expect(macros.page.locator('button', { hasText: 'Narrator Mode' })).toBeVisible();
    });

    test('should assemble built-in preset into template on selection via dropdown', async () => {
      await macros.selectPresetById('builtin-chat');

      const value = await macros.templateEditor.inputValue();
      expect(value).toContain('{{char}}');
      expect(value).toContain('{{message}}');
    });

    test('should not delete a built-in preset', async () => {
      await macros.clickPresetInList('Roleplay');
      await expect(macros.deleteButton).toBeDisabled();
    });

    test('should show preset sections when built-in preset is selected', async () => {
      await macros.clickPresetInList('Roleplay');

      // The preset editor should show sections for the selected built-in preset
      // Wait for section cards to render
      await macros.page.waitForTimeout(500);

      // At least one section name input should be visible
      const sectionInputs = macros.page.locator('.card-body input[type="text"]');
      const inputCount = await sectionInputs.count();
      expect(inputCount).toBeGreaterThan(0);
    });
  });

  // ── AC-3: Macro Autocomplete ─────────────────────────────

  test.describe('AC-3 — Macro Autocomplete', () => {
    test('should show autocomplete dropdown when typing {{us', async () => {
      await macros.typeTrigger('{{us');
      await macros.expectAutocompleteVisible();
    });

    test('should show {{user}} in autocomplete results', async () => {
      await macros.typeTrigger('{{us');
      await expect(macros.autocompleteDropdown).toContainText('user');
    });

    test('should insert selected macro at cursor position', async () => {
      await macros.typeTemplate('Greeting: ');
      await macros.templateEditor.click();
      await macros.page.keyboard.type('{{us', { delay: 30 });
      await macros.page.waitForTimeout(500);

      await macros.autocompleteDropdown.locator('text=user').first().click();
      await macros.page.waitForTimeout(300);

      const value = await macros.templateEditor.inputValue();
      expect(value).toContain('Greeting: {{user}}');
    });

    test('should hide autocomplete when typing {{zzz — zero matches', async () => {
      await macros.typeTrigger('{{zzz');
      await macros.expectAutocompleteHidden();
    });

    test('should close autocomplete when pressing Escape', async () => {
      await macros.typeTrigger('{{us');
      await macros.expectAutocompleteVisible();

      await macros.templateEditor.press('Escape');
      await macros.page.waitForTimeout(500);
      await macros.expectAutocompleteHidden();
    });

    test('should not show autocomplete when typing plain text', async () => {
      await macros.typeTrigger('hello world');
      await macros.expectAutocompleteHidden();
    });
  });

  // ── AC-4: Live Resolution ────────────────────────────────

  test.describe('AC-4 — Live Resolution', () => {
    test('should resolve template using selected built-in preset', async () => {
      await macros.selectPresetById('builtin-chat');

      const value = await macros.templateEditor.inputValue();
      expect(value).toContain('{{char}}');
      expect(value).toContain('{{message}}');

      await macros.expectResolved('helpful conversational AI');
    });

    test('should update resolved output when template changes', async () => {
      await macros.typeTemplate('Short');
      await macros.expectResolved('Short');

      await macros.typeTemplate('A much longer template with more words');
      await macros.expectResolved('A much longer template with more words');
    });

    test('should show no content when template is cleared', async () => {
      await macros.typeTemplate('');
      await macros.expectResolved('No content to preview.');
    });

    test('should resolve context fields after changing scenario', async () => {
      await macros.setContextField('scenario', 'A moonlit castle');
      await macros.expectResolved('A moonlit castle');
    });
  });

  // ── DevTools Actions ─────────────────────────────────────

  test.describe('DevTools', () => {
    test('should reset template via DevTools action', async () => {
      await macros.typeTemplate('custom stuff');
      await macros.clickDevAction('Reset Template');

      const value = await macros.templateEditor.inputValue();
      expect(value).toContain('{{char}}');
      expect(value).toContain('{{personality}}');
    });

    test('should reset context via DevTools action', async () => {
      await macros.setContextField('userName', 'ChangedUser');
      await macros.expectResolved('ChangedUser');

      await macros.clickDevAction('Reset Context');
      await macros.expectResolved('Alice');
    });
  });
});
