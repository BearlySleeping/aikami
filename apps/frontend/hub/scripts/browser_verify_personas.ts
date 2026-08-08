// Temporary browser verification for C-374 hub personas page (AC-4).
// Signs in via the Auth emulator Google popup, exercises create/activate/
// delete on /personas, and captures screenshots for visual QA.

import pg from '../../../../apps/backend/firebase/node_modules/pg/lib/index.js';
import { chromium } from '../../../../apps/e2e/node_modules/playwright/index.mjs';

const HUB_URL = 'http://127.0.0.1:5276';
const SHOT_DIR =
  '/home/sonny/.herdr/worktrees/aikami/contract-task-c-374-msjad3uy/.pi/.screenshots';
const SQL = 'postgresql://postgres@127.0.0.1:5432/fdcdb?sslmode=disable';

const seedUserRow = async (uid: string): Promise<void> => {
  const client = new pg.Client({ connectionString: SQL });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO "user" (id, created_at, updated_at) VALUES ($1, now(), now()) ON CONFLICT (id) DO NOTHING',
      [uid],
    );
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS persona_one_active_per_user ON persona (uid) WHERE is_active = true',
    );
  } finally {
    await client.end();
  }
};

const readSignedInUid = async (
  page: import('../../../../apps/e2e/node_modules/playwright/index.mjs').Page,
): Promise<string> => {
  // The Firebase Auth SDK persists the session in IndexedDB
  // (firebaseLocalStorageDb → firebaseLocalStorage store).
  const uid = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const dbMeta of dbs) {
      if (!dbMeta.name?.includes('firebase')) {
        continue;
      }
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open(dbMeta.name as string);
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          resolve(null);
        };
      });
      if (!db) {
        continue;
      }
      const storeNames = Array.from(db.objectStoreNames);
      for (const storeName of storeNames) {
        const value = await new Promise<unknown>((resolve) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.getAll();
          req.onsuccess = () => {
            resolve(req.result);
          };
          req.onerror = () => {
            resolve(undefined);
          };
        });
        db.close();
        const rows = Array.isArray(value) ? value : [];
        for (const row of rows) {
          const rec = row as { value?: { uid?: string; email?: string } };
          if (rec.value?.uid && rec.value?.email === 'aragorn.ranger@example.com') {
            return rec.value.uid;
          }
        }
      }
    }
    return undefined;
  });
  if (!uid) {
    throw new Error('Could not read signed-in uid from IndexedDB');
  }
  return uid;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

console.log('1. Navigating to login page');
await page.goto(`${HUB_URL}/login`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${SHOT_DIR}/hub-login.png` });

console.log('2. Clicking Sign in with Google');
const popupPromise = context.waitForEvent('page', { timeout: 15000 });
await page.getByRole('button', { name: /Sign in with Google/i }).click();
const popup = await popupPromise;
await popup.waitForLoadState('domcontentloaded');
await popup.waitForTimeout(1500);
await popup.screenshot({ path: `${SHOT_DIR}/hub-auth-popup.png` });

// The auth emulator's fake account chooser lists pre-imported Google users.
const accountOption = popup.locator('text=Aragorn the Ranger').first();
await accountOption.waitFor({ timeout: 10000 });
await accountOption.click();

console.log('3. Waiting for post-sign-in redirect');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${SHOT_DIR}/hub-after-login.png` });

console.log('4. Seeding SQL user row for Aragorn');
const uid = await readSignedInUid(page);
await seedUserRow(uid);
console.log(`   uid=${uid} seeded`);

console.log('5. Navigating to /personas');
await page.goto(`${HUB_URL}/personas`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOT_DIR}/hub-personas-empty.png`, fullPage: true });

console.log('6. Creating a persona');
const nameInput = page.locator('#persona-name');
await nameInput.fill('Browser Verifier');
await page.getByRole('button', { name: 'Create persona' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT_DIR}/hub-personas-created.png`, fullPage: true });

const personaCard = page.locator('div', { hasText: 'Browser Verifier' }).last();
await personaCard.waitFor({ timeout: 10000 });
console.log('   persona card visible');

console.log('7. Setting persona active');
const card = page.locator('.grid .rounded-lg', { hasText: 'Browser Verifier' }).first();
await card.getByRole('button', { name: /Set active|Activate/i }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT_DIR}/hub-personas-active.png`, fullPage: true });

console.log('8. Deleting the persona');
const card2 = page.locator('.grid .rounded-lg', { hasText: 'Browser Verifier' }).first();
await card2.getByRole('button', { name: /Delete/i }).click();
await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT_DIR}/hub-personas-deleted.png`, fullPage: true });

await browser.close();
console.log('DONE');
