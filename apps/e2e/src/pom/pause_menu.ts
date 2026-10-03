// apps/e2e/src/pom/pause_menu.ts
// Page Object Model — Pause Menu locators (shared)
//
// Single source of truth for the production Pause Menu dialog contract.
//
// DOM reference:
//   apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte
//
// The dialog is `role="dialog" aria-label="Pause Menu"`, so every locator is
// scoped to that named dialog instead of matching bare text. Scoping matters
// because the HUD and the game surface render their own "Save"-adjacent copy
// (system notice, quest tracker), and an unscoped text match silently binds to
// whichever one happens to be in the DOM first.
//
// Button labels are owned by the product View, not by these tests: Resume /
// Save now / Settings / Customize HUD / End Session / Quit to Main Menu.

import type { Locator, Page } from '@playwright/test';

/** The Pause Menu dialog itself. */
export const pauseMenuDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Pause Menu' });

/** The primary "Resume" action that closes the menu. */
export const pauseMenuResumeButton = (page: Page): Locator =>
  pauseMenuDialog(page).getByRole('button', { name: 'Resume', exact: true });

/** The manual save action ("Save now", or "Saving…" while in flight). */
export const pauseMenuSaveButton = (page: Page): Locator =>
  pauseMenuDialog(page).getByRole('button', { name: /^(Save now|Saving…)$/ });

/** The live save status line — real timestamp/outcome, never a stub seam. */
export const pauseMenuSaveStatus = (page: Page): Locator =>
  pauseMenuDialog(page).locator('[role="status"]');

/** The HUD customization action that opens the paused HUD editor. */
export const pauseMenuCustomizeHudButton = (page: Page): Locator =>
  pauseMenuDialog(page).getByTestId('pause-customize-hud');

/** True when the focused element is contained by the Pause Menu dialog. */
export const isFocusInsidePauseMenu = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Pause Menu"]');
    return dialog?.contains(document.activeElement) ?? false;
  });
