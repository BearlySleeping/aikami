// apps/e2e/src/auth.setup.ts
// Playwright project dependency setup — authenticates test identities against
// the hub's Better Auth (session cookie) and serialises session state per
// worker to .auth/user-worker-{N}.json.
//
// C-054 AC-1: Authentication State Caching
// C-183 AC-1: Per-worker auth states for parallel data isolation
//
// The setup project runs once before any test suites. For each worker slot
// (0 through MAX_WORKERS-1), it signs up + signs in a test user against the
// hub's Better Auth endpoints, captures the session cookie, and persists the
// full storageState to disk.

import { existsSync, mkdirSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { EMULATOR_PORTS } from './config';

// ── Configuration ───────────────────────────────────────────

const CLIENT_BASE_URL = `http://localhost:${EMULATOR_PORTS.client}`;
const HUB_BASE_URL = `http://localhost:${EMULATOR_PORTS.hub}`;
const MAX_WORKERS = 8;
const AUTH_DIR = './.auth';

const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'asdasd';

// ── Better Auth session helpers ─────────────────────────────

/**
 * Sign up + sign in a test user against the hub's Better Auth endpoints,
 * returning the session cookie (e.g. `better-auth.session_token=...`).
 */
const signInCookie = async (email: string): Promise<string> => {
  // Sign up (idempotent-ish: a duplicate email is tolerated by ignoring errors).
  await fetch(`${HUB_BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: TEST_PASSWORD }),
  }).catch(() => undefined);

  const res = await fetch(`${HUB_BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Better Auth sign-in failed (HTTP ${res.status})`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Better Auth sign-in returned no session cookie');
  }
  return setCookie.split(';')[0] ?? '';
};

// ── Setup test ──────────────────────────────────────────────

setup('authenticate test users for all workers', async ({ browser }) => {
  console.log('[auth.setup] Starting per-worker authentication setup');
  mkdirSync(AUTH_DIR, { recursive: true });

  // Sign in once to get a session cookie (same cookie works for all workers).
  console.log('[auth.setup] Signing in shared test user...');
  const cookie = await signInCookie(TEST_EMAIL);
  console.log('[auth.setup] Session cookie obtained');

  // Generate per-worker auth states
  for (let workerIndex = 0; workerIndex < MAX_WORKERS; workerIndex++) {
    const authFile = `${AUTH_DIR}/user-worker-${workerIndex}.json`;

    if (existsSync(authFile)) {
      console.log(`[auth.setup] Worker ${workerIndex} auth state already cached, skipping`);
      continue;
    }

    console.log(`[auth.setup] Generating auth state for worker ${workerIndex}...`);

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Seed the Better Auth session cookie before the app initialises.
      await context.addCookies([
        {
          name: cookie.split('=')[0] ?? 'better-auth.session_token',
          value: cookie.split('=').slice(1).join('='),
          url: CLIENT_BASE_URL,
        },
      ]);

      await page.goto(CLIENT_BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      await context.storageState({ path: authFile });
      console.log(`[auth.setup]   ✅ Saved ${authFile}`);
    } finally {
      await page.close();
      await context.close();
    }
  }

  console.log('[auth.setup] All worker auth states generated successfully');
});
