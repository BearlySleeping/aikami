// apps/e2e/src/pom/pwa_auth_page.ts
// Page Object Model — PwaAuthPage
//
// Encapsulates locators and interaction primitives for the PWA authentication
// pages (login, register). Exposes business-intent methods for form-filling,
// submission, and validation-status verification.
//
// Locators aligned with actual DOM in:
//   apps/frontend/pwa/src/lib/views/auth/login/login_view.svelte
//   apps/frontend/pwa/src/lib/views/auth/register/register_view.svelte
//   apps/frontend/pwa/src/lib/paraglide/messages/en.js

import type { Page } from '@playwright/test';

/**
 * Page Object Model for PWA auth interactions.
 */
export class PwaAuthPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  async gotoLogin(): Promise<void> {
    await this.page.goto('/login');
    await this._waitForPage();
  }

  async gotoRegister(): Promise<void> {
    await this.page.goto('/register');
    await this._waitForPage();
  }

  // ── Form Interaction ─────────────────────────────────────

  /**
   * Fill login form and submit.
   * Labels match i18n: Email → "Email", Password → "Password"
   * Submit button: "Sign In" (t.login())
   */
  async login(options: { email: string; password: string }): Promise<void> {
    await this.page.getByLabel('Email').fill(options.email);
    await this.page.getByLabel('Password').fill(options.password);
    await this.page.getByRole('button', { name: 'Sign In' }).click();
  }

  /**
   * Fill register form.
   * Labels: Full Name, Email, Password
   */
  async fillRegisterForm(options: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.page.getByLabel('Full Name').fill(options.name);
    await this.page.getByLabel('Email').fill(options.email);
    await this.page.getByLabel('Password').fill(options.password);
  }

  /**
   * Submit register form. Button text is "Create Account" (t.create_account()).
   */
  async submitRegister(): Promise<void> {
    await this.page.getByRole('button', { name: 'Create Account' }).click();
  }

  // ── Assertions ────────────────────────────────────────────

  /**
   * Assert login page is visible.
   * Heading: <h1>Sign In</h1> (t.login() → "Sign In")
   * Inputs: Email, Password
   * Submit: Sign In
   */
  async expectLoginPageVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(this.page.getByLabel('Email')).toBeVisible();
    await expect(this.page.getByLabel('Password')).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  }

  /**
   * Assert register page is visible.
   * Heading: <h1>Sign Up</h1> (t.register() → "Sign Up")
   */
  async expectRegisterPageVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('heading', { name: 'Sign Up' })).toBeVisible();
    await expect(this.page.getByLabel('Full Name')).toBeVisible();
    await expect(this.page.getByLabel('Email')).toBeVisible();
    await expect(this.page.getByLabel('Password')).toBeVisible();
  }

  /**
   * Assert "Forgot password?" button is visible.
   * NOTE: This is a <button class="btn btn-ghost btn-sm">, NOT a link (<a>).
   */
  async expectForgotPasswordButton(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  }

  /**
   * Assert "Don't have an account?" text + register button are visible.
   * The register link is a <button class="link link-primary">, NOT an <a>.
   */
  async expectRegisterPrompt(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText("Don't have an account?")).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Sign Up' })).toBeVisible();
  }

  // ── Internal ──────────────────────────────────────────────

  private async _waitForPage(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
