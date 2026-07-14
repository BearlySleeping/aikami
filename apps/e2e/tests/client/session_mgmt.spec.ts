// apps/e2e/tests/client/session_mgmt.spec.ts
//
// C-240: Session Management — E2E verification via dev sandbox.
//
// Tests end-to-end session lifecycle: start → end → new session,
// chat locking, session browser, and auto-summarization toast.
//
// Uses the SessionMgmtPage POM for all sandbox interactions.

import { expect, test } from '@playwright/test';
import { SessionMgmtPage } from '$pom';

test.describe('Session Management Sandbox (C-240)', () => {
  let sandbox: SessionMgmtPage;

  test.beforeEach(async ({ page }) => {
    sandbox = new SessionMgmtPage(page);
    await sandbox.gotoDev();
  });

  // ── AC-5: Dev Sandbox ─────────────────────────────────────

  test('should render the sandbox heading', async () => {
    await sandbox.expectHeadingVisible();
  });

  test('should show initial state — no active session, chat unlocked', async () => {
    await sandbox.expectInitialState();
  });

  test('should have End Session disabled when no session active', async () => {
    await sandbox.expectEndSessionDisabled();
  });

  // ── AC-1: End Session Flow ────────────────────────────────

  test('should start a session and enable End Session', async () => {
    await sandbox.clickStartSession();

    // End Session should now be enabled
    await expect(sandbox.endSessionButton).toBeEnabled();
    // Active Session card should no longer show —
    await expect(sandbox.page.getByText('—')).not.toBeVisible();
  });

  test('should end a session and lock chat', async () => {
    await sandbox.clickStartSession();
    await sandbox.clickEndSession();

    // Chat Locked should now show "Yes" in red text
    await expect(sandbox.page.locator('p.text-error')).toBeVisible();
  });

  test('should log start and end session in test log', async () => {
    // Clear old log entries
    await sandbox.clearLogButton.click();
    await sandbox.clickStartSession();
    await sandbox.clickEndSession();

    await sandbox.expectLogContains('ended');
  });

  // ── AC-2: New Session with Recap ──────────────────────────

  test('should start new session and unlock chat', async () => {
    await sandbox.clickStartSession();
    await sandbox.clickEndSession();

    await sandbox.clickNewSession();
    // Chat should be unlocked (green text)
    await expect(sandbox.page.locator('p.text-success')).toBeVisible();
  });

  // ── Session Browser ───────────────────────────────────────

  test('should load sessions after creating them', async () => {
    // Create 2 sessions
    await sandbox.clickStartSession();
    await sandbox.clickEndSession();
    await sandbox.clickNewSession();
    await sandbox.clickEndSession();

    // Sessions section should show entries
    await sandbox.loadSessionsButton.click();
    await expect(sandbox.page.getByText(/Session \d/).first()).toBeVisible();
  });
});
