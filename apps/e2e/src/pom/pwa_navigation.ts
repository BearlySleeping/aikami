// apps/e2e/src/pom/pwa_navigation.ts
// Page Object Model — PwaNavigation
//
// Encapsulates locators and interaction primitives for the PWA navigation
// drawer and app bar. Uses data-testid on drawer toggle and semantic
// getByRole/getByText for nav items.
//
// DOM reference:
//   apps/frontend/pwa/src/lib/views/app/bar/app_bar.svelte
//   apps/frontend/pwa/src/lib/views/app/drawer/navigation/navigation_drawer.svelte

import type { Page } from '@playwright/test';

/**
 * Page Object Model for PWA navigation interactions.
 */
export class PwaNavigation {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Drawer ────────────────────────────────────────────────

  /**
   * Open the navigation drawer by clicking the hamburger toggle.
   * The toggle is a <label for="left-drawer"> with data-testid="drawer-toggle".
   */
  async openDrawer(): Promise<void> {
    await this.page.locator('[data-testid="drawer-toggle"]').click();
  }

  /**
   * Assert nav items with specific labels are visible.
   * Labels are i18n: Home, Characters, Profile, Settings, Logout
   */
  async expectNavItem(label: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('button', { name: label })).toBeVisible();
  }

  /**
   * Assert all standard nav items are visible.
   */
  async expectStandardNavItems(): Promise<void> {
    await this.expectNavItem('Home');
    await this.expectNavItem('Characters');
    await this.expectNavItem('Profile');
    await this.expectNavItem('Settings');
  }

  // ── Logout ────────────────────────────────────────────────

  /**
   * Assert the logout button is visible (text "Logout" with error styling).
   */
  async expectLogoutButton(): Promise<void> {
    await this.expectNavItem('Logout');
  }

  // ── App Bar ───────────────────────────────────────────────

  /**
   * Assert the app bar heading matches the expected title.
   * Rendered as <h1 class="text-lg font-semibold">{viewModel.appBarTitle}</h1>.
   */
  async expectAppBarTitle(title: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  }
}
