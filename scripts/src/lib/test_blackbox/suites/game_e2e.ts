// scripts/src/lib/test_blackbox/suites/game_e2e.ts
/**
 * Game E2E blackbox test suite.
 *
 * Validates Firebase emulators (Auth, Firestore, Storage, Functions)
 * and optionally runs Playwright tests from the unified apps/e2e package.
 * Note: The game engine now runs within the client app (formerly apps/frontend/game).
 */

import { resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';
import type { TestSuite } from '../types.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const E2E_DIR = resolve(PROJECT_ROOT, 'apps/e2e');

const AUTH_PORT = EMULATOR_PORTS.auth;
const FIRESTORE_PORT = EMULATOR_PORTS.firestore;
const STORAGE_PORT = EMULATOR_PORTS.storage;
const FUNCTIONS_PORT = EMULATOR_PORTS.functions;

const GAME_DEV_PORT = 5276;
const GAME_URL = `http://localhost:${GAME_DEV_PORT}`;

/**
 * Probes a port to check if an emulator service is healthy.
 */
const probePort = async (port: number, timeoutMs = 3000): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(`http://localhost:${port}/`, { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Polls all emulator ports in parallel until healthy or timeout.
 */
const waitForEmulators = async (timeoutMs = 30_000): Promise<void> => {
  void [AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, FUNCTIONS_PORT];
  const deadline = Date.now() + timeoutMs;

  const waitForPort = async (port: number): Promise<void> => {
    while (Date.now() < deadline) {
      if (await probePort(port, 1000)) {
        console.log(`  ✓ Port ${port} ready`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`  ⚠ Port ${port} not ready (continuing)`);
  };

  const critical = [AUTH_PORT, FIRESTORE_PORT];
  const optional = [STORAGE_PORT, FUNCTIONS_PORT];

  await Promise.all(critical.map(waitForPort));

  const authOk = await probePort(AUTH_PORT, 1000);
  const firestoreOk = await probePort(FIRESTORE_PORT, 1000);
  if (!authOk || !firestoreOk) {
    throw new Error(`Critical emulator ports not ready (auth=${authOk}, firestore=${firestoreOk})`);
  }

  void Promise.all(optional.map(waitForPort));

  console.log('✓ Emulator ports ready');
};

export const gameE2eSuite: TestSuite = {
  name: 'game-e2e',
  category: 'service',

  async run(): Promise<void> {
    // ── 1. Verify emulators are healthy ────────────────────
    console.log('  Checking emulator health...');
    await waitForEmulators(90_000);

    // ── 2. Verify client dev server is reachable ──────────────
    console.log('  Checking client dev server...');
    const gameReady = await probePort(GAME_DEV_PORT, 10_000);
    if (!gameReady) {
      throw new Error(`Client dev server not reachable on :${GAME_DEV_PORT}`);
    }

    // ── 3. Verify game page loads via client ───────────────
    console.log('  Loading game page via client...');
    const pageResponse = await fetch(GAME_URL);
    if (!pageResponse.ok && pageResponse.status >= 500) {
      throw new Error(`Game page returned ${pageResponse.status}`);
    }
    console.log('  ✓ Game page loaded');

    // ── 4. Verify Firestore REST API ───────────────────────
    console.log('  Testing Firestore REST API...');
    const firestoreUrl = `http://localhost:${FIRESTORE_PORT}/v1/projects/demo-aikami-emulator/databases/(default)/documents`;
    const docId = `blackbox_${Date.now()}`;
    const testDoc = await fetch(`${firestoreUrl}/test_ping?documentId=${docId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner',
      },
      body: JSON.stringify({
        fields: {
          message: { stringValue: 'blackbox-ping' },
          timestamp: { timestampValue: new Date().toISOString() },
        },
      }),
    });
    if (!testDoc.ok) {
      throw new Error(`Firestore REST create failed: ${testDoc.status}`);
    }

    const listResp = await fetch(`${firestoreUrl}/test_ping/${docId}`, {
      headers: { Authorization: 'Bearer owner' },
    });
    if (!listResp.ok) {
      throw new Error(`Firestore REST read failed: ${listResp.status}`);
    }
    console.log('  ✓ Firestore REST API working');

    // ── 5. Verify Auth REST API ────────────────────────────
    console.log('  Testing Auth REST API...');
    const authUrl = `http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1`;
    const signUpResp = await fetch(`${authUrl}/accounts:signUp?key=fake-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner',
      },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!signUpResp.ok) {
      throw new Error(`Auth REST signUp failed: ${signUpResp.status}`);
    }
    const authData = (await signUpResp.json()) as { localId?: string };
    if (!authData.localId) {
      throw new Error('Auth response missing localId');
    }
    console.log(`  ✓ Auth REST API working (uid: ${authData.localId})`);

    // ── 6. Verify Storage REST API ─────────────────────────
    console.log('  Testing Storage REST API...');
    const storageReady = await probePort(STORAGE_PORT, 3000);
    if (!storageReady) {
      console.log('  ⚠ Storage emulator not reachable (may be expected)');
    } else {
      console.log('  ✓ Storage REST API reachable');
    }

    console.log('  Infrastructure validation complete');

    // ── 7. Optionally trigger Playwright ───────────────────
    if (process.env.RUN_PLAYWRIGHT === 'true') {
      console.log('  Running Game Playwright tests from apps/e2e...');
      const proc = Bun.spawn({
        cmd: ['npx', 'playwright', 'test', '--project=game'],
        cwd: E2E_DIR,
        stdout: 'inherit',
        stderr: 'inherit',
      });

      const timer = setTimeout(() => proc.kill(), 120_000);
      const exitCode = await proc.exited;
      clearTimeout(timer);

      if (exitCode === 0) {
        console.log('  ✓ Playwright tests passed');
      } else {
        throw new Error(`Playwright tests failed with code ${exitCode}`);
      }
    } else {
      console.log('  ⏭ Skipping Playwright (set RUN_PLAYWRIGHT=true to run)');
    }
  },
};
