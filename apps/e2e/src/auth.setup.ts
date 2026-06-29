// apps/e2e/src/auth.setup.ts
// Playwright project dependency setup — authenticates test identities against
// the local Firebase Auth emulator and serialises session state per worker
// to .auth/user-worker-{N}.json.
//
// C-054 AC-1: Authentication State Caching
// C-183 AC-1: Per-worker auth states for parallel data isolation
//
// The setup project runs once before any test suites. For each worker slot
// (0 through MAX_WORKERS-1), it creates a test user in the Auth emulator,
// injects the Firebase Auth session into the browser's IndexedDB, and
// persists the full storageState to disk.

import { existsSync, mkdirSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { EMULATOR_PORTS } from './config';

// ── Configuration ───────────────────────────────────────────

const CLIENT_BASE_URL = `http://localhost:${EMULATOR_PORTS.client}`;
const AUTH_EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORTS.auth}`;
const MAX_WORKERS = 8;
const AUTH_DIR = './.auth';

const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'asdasd';
const FIREBASE_API_KEY = 'fake-api-key';
const AUTH_STORAGE_KEY = `firebase:authUser:${FIREBASE_API_KEY}:[DEFAULT]`;

// ── Auth Emulator REST helpers ──────────────────────────────

type AuthTokens = { localId: string; idToken: string; refreshToken: string };

const fetchAuth = async (endpoint: string, body: Record<string, unknown>): Promise<AuthTokens> => {
  const resp = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, returnSecureToken: true }),
    },
  );
  const data = (await resp.json()) as { localId: string; idToken: string; refreshToken: string };
  return { localId: data.localId, idToken: data.idToken, refreshToken: data.refreshToken };
};

// ── Auth state injection ────────────────────────────────────

/**
 * Injects Firebase Auth session into a page's IndexedDB before navigation.
 * This makes the Firebase Auth SDK find the pre-authenticated state
 * on initialization, avoiding a real sign-in flow.
 */
const injectAuthState = async (
  page: import('@playwright/test').Page,
  tokens: { idToken: string; refreshToken: string; email: string; uid: string },
): Promise<void> => {
  await page.context().addInitScript(
    (data: unknown) => {
      const d = data as {
        key: string;
        idToken: string;
        refreshToken: string;
        email: string;
        uid: string;
      };

      // Set bootComplete so the AppView skips the boot diagnostics terminal
      // and renders the actual page content for test assertions.
      // This must happen BEFORE the PWA initializes (in addInitScript).
      localStorage.setItem('aikami_boot_complete', 'true');

      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('firebaseLocalStorageDb', 1);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage');
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');

          store.put({
            name: d.key,
            value: {
              uid: d.uid,
              email: d.email,
              emailVerified: false,
              isAnonymous: false,
              providerData: [{ providerId: 'password', uid: d.email, email: d.email }],
              stsTokenManager: {
                refreshToken: d.refreshToken,
                accessToken: d.idToken,
                expirationTime: Date.now() + 3_600_000,
              },
              createdAt: String(Date.now()),
              lastLoginAt: String(Date.now()),
              apiKey: FIREBASE_API_KEY,
              appName: '[DEFAULT]',
            },
          });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };

        request.onerror = () => reject(request.error);
      });
    },
    {
      key: AUTH_STORAGE_KEY,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      email: tokens.email,
      uid: tokens.uid,
    },
  );
};

// ── Setup test ──────────────────────────────────────────────

setup('authenticate test users for all workers', async ({ browser }) => {
  console.log('[auth.setup] Starting per-worker authentication setup');
  mkdirSync(AUTH_DIR, { recursive: true });

  // Create the test user once (shared across workers in the emulator)
  console.log('[auth.setup] Creating shared test user...');
  const { localId } = await fetchAuth('signUp', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  console.log(`[auth.setup] Test user localId: ${localId}`);

  // Sign in to get tokens (same tokens work for all workers)
  const tokens = await fetchAuth('signInWithPassword', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  console.log('[auth.setup] Tokens obtained');

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
      await injectAuthState(page, {
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        email: TEST_EMAIL,
        uid: localId,
      });

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
