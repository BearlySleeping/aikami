// apps/frontend/hub/scripts/verify_persona_dataconnect.ts
//
// Emulator verification script for the C-374 Data Connect persona layer.
// Exercises the full CRUD + one-active-persona flow against the local
// emulators, mirroring what the hub UI does through the repository.
//
// Prerequisites (run AFTER `herdr_session start firebase` AND the Data
// Connect emulator — see Phase 4 of the contract):
//   1. Firebase emulators running (auth on 127.0.0.1:9098).
//   2. Data Connect emulator running on 127.0.0.1:9398 with the updated
//      schema + connector, and the partial unique index applied:
//        psql "$EMULATOR_DATACONNECT_URL" \
//          -f dataconnect/migrations/persona_one_active.sql
//   3. The seeded emulator user (user@example.com / asdasd) exists — created
//      by apps/backend/firebase/scripts/on_emulate.ts on emulator start.
//
// Run:
//   bun run scripts/verify_persona_dataconnect.ts   (from apps/frontend/hub)
//
// The script signs in to the Auth emulator, then drives the generated SDK
// directly (the wrapper singleton in @aikami/frontend/dataconnect requires
// Vite env, which is unavailable under `bun run`), asserting:
//   - create → list → update → delete round-trip, ordered createdAt DESC
//   - duplicate id → typed conflict (PK constraint)
//   - cross-user writes rejected (@auth ownership + uid-scoped where)
//   - missing/not-owned row id → typed not-found (zero affected rows)
//   - one-active invariant: create with isActive:true on a second persona
//     fails with a unique violation (partial index backstop), a normal
//     setActive deactivates the previous row, and after concurrent setActive
//     calls exactly one row stays active.

import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import pg from '../../../../apps/backend/firebase/node_modules/pg/lib/index.js';
import {
  activatePersona,
  connectorConfig,
  createPersona,
  deactivatePersonas,
  deletePersona,
  listPersonas,
  updatePersona,
} from '../../../../packages/frontend/dataconnect/src/lib/generated/esm/index.esm.js';

// ── Configuration (emulator values — see packages/shared/constants) ──────
const AUTH_EMULATOR_URL = 'http://127.0.0.1:9098';
const DATACONNECT_HOST = '127.0.0.1';
const DATACONNECT_PORT = 9398;
const EMAIL = 'user@example.com';
const PASSWORD = 'asdasd';

// ── Tiny assertion harness ───────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

const assert = (condition: boolean, label: string, details?: unknown): void => {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${details === undefined ? '' : ` — ${JSON.stringify(details)}`}`);
    console.error(`  ❌ ${label}`, details ?? '');
  }
};

const expectError = async (
  promise: Promise<unknown>,
  label: string,
  messagePattern?: RegExp,
): Promise<unknown> => {
  try {
    await promise;
    failed += 1;
    failures.push(`${label} — expected an error but resolved`);
    console.error(`  ❌ ${label} — expected an error but resolved`);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (messagePattern && !messagePattern.test(message)) {
      failed += 1;
      failures.push(`${label} — error message did not match ${messagePattern}: ${message}`);
      console.error(`  ❌ ${label} — mismatch: ${message}`);
      return error;
    }
    passed += 1;
    console.log(`  ✅ ${label}`);
    return error;
  }
};

const summarize = (): void => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('Failures:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
};

/**
 * Retries a Data Connect call once when the pglite gateway transiently fails
 * the first request after emulator startup (Go lib/pq protocol error
 * "unexpected message 'E'" — verified during C-374; subsequent requests on
 * the same emulator instance succeed).
 */
const withTransientRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unexpected message') || message.includes('SQL execution failed')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return await fn();
    }
    throw error;
  }
};

// ── SQL user seed ─────────────────────────────────────────────────────────
// The SQL `persona.uid` column has a foreign key to `user.id`. There is no
// Firestore→SQL sync layer in the emulator (see contract Open Questions), so
// the signed-in Auth user has no SQL row yet — seed one idempotently before
// exercising the persona operations. Uses the `pg` client bundled with the
// firebase package (psql is not guaranteed on the script's PATH).
const SQL_CONNECTION = 'postgresql://postgres@127.0.0.1:5432/fdcdb?sslmode=disable';

const seedSqlUser = async (uid: string): Promise<void> => {
  const client = new pg.Client({ connectionString: SQL_CONNECTION });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO "user" (id, created_at, updated_at) VALUES ($1, now(), now()) ON CONFLICT (id) DO NOTHING',
      [uid],
    );
    // Apply the one-active-persona partial unique index idempotently. Done
    // here (not via psql) because psql's simple-query protocol trips the
    // pglite gateway's extended-query patch and corrupts the server state
    // for subsequent Data Connect writes (verified during C-374).
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS persona_one_active_per_user ON persona (uid) WHERE is_active = true',
    );
  } finally {
    await client.end();
  }
};

// ── Main flow ────────────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  console.log('🔌 Connecting to Auth emulator...');
  const app = initializeApp({
    apiKey: 'fake-api-key',
    projectId: 'demo-aikami-emulator',
    authDomain: 'localhost',
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = credential.user.uid;
  console.log(`  Signed in as ${EMAIL} (uid=${uid})`);

  seedSqlUser(uid);
  console.log('  Seeded SQL user row (persona.uid FK satisfied)');

  console.log('🔌 Connecting to Data Connect emulator...');
  const dataConnect = getDataConnect(app, connectorConfig);
  connectDataConnectEmulator(dataConnect, DATACONNECT_HOST, DATACONNECT_PORT);

  const stamp = Date.now();
  const personaA = `persona_verify_a_${stamp}`;
  const personaB = `persona_verify_b_${stamp}`;
  const display = `Verify ${stamp}`;

  // ── Create ─────────────────────────────────────────────────────────────
  console.log('\n▶ createPersona');
  const createAResult = await withTransientRetry(() =>
    createPersona(dataConnect, {
      id: personaA,
      uid,
      name: `${display} A`,
      avatarUrl: null,
      voiceConfigId: 'voice-1',
      traits: { race: 'Elf', class: 'Ranger', level: 3 },
      isActive: false,
    }),
  );
  assert(createAResult.data.persona_insert.id === personaA, 'create A returns its id');
  const createBResult = await createPersona(dataConnect, {
    id: personaB,
    uid,
    name: `${display} B`,
    avatarUrl: null,
    voiceConfigId: null,
    traits: { race: 'Dwarf', class: 'Cleric', level: 5 },
    isActive: false,
  });
  assert(createBResult.data.persona_insert.id === personaB, 'create B returns its id');

  // ── Duplicate id → PK conflict (typed already-exists) ─────────────────
  console.log('\n▶ duplicate id conflict');
  await expectError(
    createPersona(dataConnect, {
      id: personaA,
      uid,
      name: 'Duplicate',
      isActive: false,
    }),
    'duplicate id rejected',
    /already exists|duplicate|unique/i,
  );

  // ── Cross-user write rejected (@auth ownership) ────────────────────────
  console.log('\n▶ ownership enforcement');
  await expectError(
    updatePersona(dataConnect, {
      id: personaA,
      uid: 'someone-else',
      name: 'Hacked',
    }),
    'update with another uid rejected',
    /unauthorized|unauthenticated|not signed in/i,
  );

  // ── List ───────────────────────────────────────────────────────────────
  console.log('\n▶ listPersonas');
  const listResult = await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' });
  const rows = listResult.data.personas ?? [];
  const mine = rows.filter((row: { id: string }) => row.id === personaA || row.id === personaB);
  assert(mine.length === 2, 'lists both created personas', mine);
  const [first, second] = mine;
  assert(first.createdAt >= second.createdAt, 'ordered createdAt DESC', {
    first: first.createdAt,
    second: second.createdAt,
  });
  const aRow = mine.find((row: { id: string }) => row.id === personaA);
  assert(aRow?.traits?.race === 'Elf', 'traits round-trip (race=Elf)', aRow?.traits);
  assert(aRow?.traits?.level === 3, 'traits round-trip (level=3)', aRow?.traits);
  assert(aRow?.voiceConfigId === 'voice-1', 'voiceConfigId round-trip', aRow?.voiceConfigId);
  assert(aRow?.name === `${display} A`, 'name round-trip', aRow?.name);
  assert(typeof aRow?.createdAt === 'string', 'row timestamp is RFC 3339 string', aRow?.createdAt);

  // ── Update ─────────────────────────────────────────────────────────────
  console.log('\n▶ updatePersona');
  const updateResult = await updatePersona(dataConnect, {
    id: personaA,
    uid,
    name: `${display} A2`,
    avatarUrl: 'https://example.com/a2.png',
    voiceConfigId: 'voice-2',
    traits: { race: 'Elf', class: 'Wizard', level: 4 },
  });
  assert(updateResult.data.persona_updateMany === 1, 'update affects exactly one row');
  // The raw SDK resolves with a zero affected-row count for a missing/not
  // owned row; the repository maps that to a typed not-found error (covered
  // by the repository error-path unit tests and the emulator's own flow).
  const missingUpdate = await updatePersona(dataConnect, {
    id: 'persona_missing_x',
    uid,
    name: 'Nope',
  });
  assert(missingUpdate.data.persona_updateMany === 0, 'update missing row affects zero rows');

  // ── One-active invariant ───────────────────────────────────────────────
  console.log('\n▶ one-active invariant');
  // Activate A (single-step, no deactivate) so the partial unique index is
  // armed, then a second direct activation must be rejected.
  const activateAResult = await activatePersona(dataConnect, { id: personaA, uid });
  assert(activateAResult.data.persona_updateMany === 1, 'activate A affects exactly one row');
  await expectError(
    activatePersona(dataConnect, { id: personaB, uid }),
    'second direct activation rejected by partial unique index',
    /unique|duplicate|already exists/i,
  );

  // Normal two-step setActive: deactivate-all, then activate the target.
  await deactivatePersonas(dataConnect, { uid });
  const activateBResult = await activatePersona(dataConnect, { id: personaB, uid });
  assert(activateBResult.data.persona_updateMany === 1, 'two-step setActive activates B');
  const afterSetB =
    (await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' })).data.personas ?? [];
  const activeAfterB = afterSetB.filter((row: { isActive: boolean }) => row.isActive);
  assert(
    activeAfterB.length === 1 && activeAfterB[0]?.id === personaB,
    'only B is active after setActive',
    activeAfterB,
  );

  // Concurrent two-step activations: fire both without awaiting. Either both
  // succeed serially (row locks serialize the deactivate-all) or one hits the
  // unique index — the invariant is that exactly one active row remains.
  console.log('\n▶ concurrent setActive');
  const setActiveA = async (): Promise<void> => {
    await deactivatePersonas(dataConnect, { uid });
    await activatePersona(dataConnect, { id: personaA, uid });
  };
  const setActiveB = async (): Promise<void> => {
    await deactivatePersonas(dataConnect, { uid });
    await activatePersona(dataConnect, { id: personaB, uid });
  };
  const [r1, r2] = await Promise.allSettled([setActiveA(), setActiveB()]);
  const afterConcurrent =
    (await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' })).data.personas ?? [];
  const activeAfterConcurrent = afterConcurrent.filter(
    (row: { isActive: boolean }) => row.isActive,
  );
  assert(
    activeAfterConcurrent.length === 1,
    'exactly one active row after concurrent setActive',
    activeAfterConcurrent,
  );
  assert(
    r1.status === 'fulfilled' || r2.status === 'fulfilled',
    'at least one concurrent activation succeeded',
    { r1: r1.status, r2: r2.status },
  );

  // ── Delete ─────────────────────────────────────────────────────────────
  console.log('\n▶ deletePersona');
  const deleteAResult = await deletePersona(dataConnect, { id: personaA, uid });
  assert(deleteAResult.data.persona_deleteMany === 1, 'delete A affects one row');
  // Raw SDK resolves with a zero count for a missing row; the repository
  // maps that to a typed not-found error (unit-tested).
  const missingDelete = await deletePersona(dataConnect, { id: 'persona_missing_x', uid });
  assert(missingDelete.data.persona_deleteMany === 0, 'delete missing row affects zero rows');
  const deleteBResult = await deletePersona(dataConnect, { id: personaB, uid });
  assert(deleteBResult.data.persona_deleteMany === 1, 'delete B affects one row');

  const finalList =
    (await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' })).data.personas ?? [];
  assert(
    finalList.every((row: { id: string }) => row.id !== personaA && row.id !== personaB),
    'created personas are gone after delete',
  );

  console.log(`\nRan verification with ${passed + failed} assertions.`);
  summarize();
};

main().catch((error: unknown) => {
  console.error('❌ Verification script failed:', error);
  process.exit(1);
});
