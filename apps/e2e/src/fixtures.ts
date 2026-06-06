// apps/e2e/src/fixtures.ts
// Custom Playwright test fixtures for the Aikami E2E suite.
//
// C-054 AC-2: Custom E2E Fixtures and POM Injection
// Extends @playwright/test to inject pre-authenticated contexts and
// Page Object Models into every test block.
//
// Domain isolation: authUser and guestUser use separate browser contexts
// with distinct cookies/storage, preventing session bleed between tests.

import { EMULATOR_PORTS } from './config';
import { test as base, type Page } from '@playwright/test';
import { GameMenuPage, PwaAuthPage, PwaChatPage, PwaNavigation } from './pom/index';

// ── Configuration ───────────────────────────────────────────

const PWA_BASE_URL = `http://localhost:${EMULATOR_PORTS.pwa}`;
const AUTH_STATE_FILE = './.auth/user.json';

// ── POM Factory Types ───────────────────────────────────────

/**
 * Creates PWA Page Object Models bound to a specific Playwright Page.
 */
export type PwaPomFactory = (page: Page) => {
  auth: PwaAuthPage;
  chat: PwaChatPage;
  nav: PwaNavigation;
};

/**
 * Creates Game Page Object Models bound to a specific Playwright Page.
 */
export type GamePomFactory = (page: Page) => {
  menu: GameMenuPage;
};

// ── Fixture type definitions ────────────────────────────────

/**
 * Extended test fixtures injected into every Aikami E2E test.
 *
 * - authUser: Pre-authenticated browser page (loads .auth/user.json)
 * - guestUser: Pristine, unauthenticated browser page
 * - pwa: Factory — call `pwa(page)` to get POMs bound to that page
 * - game: Factory — call `game(page)` to get POMs bound to that page
 */
export type E2EFixtures = {
  /** Pre-authenticated browser page targeting the PWA domain. */
  authUser: Page;

  /** Pristine, unauthenticated browser page targeting the PWA domain. */
  guestUser: Page;

  /** PWA POM factory — call `pwa(page)` to get POM instances. */
  pwa: PwaPomFactory;

  /** Game POM factory — call `game(page)` to get POM instances. */
  game: GamePomFactory;
};

// ── Custom test fixture definition ──────────────────────────

export const test = base.extend<E2EFixtures>({
  // ── Auth User ───────────────────────────────────────────
  authUser: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: PWA_BASE_URL,
      storageState: AUTH_STATE_FILE,
    });
    const page = await context.newPage();

    // Set test-mode headers so the PWA server bypasses Firebase Auth
    // verification and trusts the pre-injected IndexedDB state.
    await page.setExtraHTTPHeaders({
      'x-test-mode': 'true',
      'x-test-user-id': 'test-user-123',
      'x-test-user-email': 'user@example.com',
      'x-test-user-name': 'Regular User',
    });

    await use(page);
    await context.close();
  },

  // ── Guest User ──────────────────────────────────────────
  guestUser: async ({ browser }, use) => {
    // Create a completely isolated browser context.
    // No storageState — starts unauthenticated.
    // No baseURL — inherits from the project-level playwright config.
    const context = await browser.newContext();
    const page = await context.newPage();

    await use(page);
    await context.close();
  },

  // ── PWA POM Factory ─────────────────────────────────────
  pwa: async ({ page: _page }, use) => {
    void _page;
    const factory: PwaPomFactory = (page: Page) => ({
      auth: new PwaAuthPage(page),
      chat: new PwaChatPage(page),
      nav: new PwaNavigation(page),
    });
    await use(factory);
  },

  // ── Game POM Factory ────────────────────────────────────
  game: async ({ page: _page2 }, use) => {
    void _page2;
    const factory: GamePomFactory = (page: Page) => ({
      menu: new GameMenuPage(page),
    });
    await use(factory);
  },
});

export { expect } from '@playwright/test';
