// packages/backend/database/tests/catalog_repository.test.ts
//
// C-394 AC-3: the catalog write model with its constraints enforced.
//
// Runs against the REAL local PostgreSQL (C-387) — a mocked database cannot
// prove a constraint exists. Every violation below is rejected BY THE
// DATABASE (Postgres error codes), never by application code:
//
//   23505 unique_violation   — duplicate firebase_uid / slug / (pack, version)
//   23503 foreign_key_violation — version referencing a missing pack,
//                                 deleting an account that owns a pack
//   22P02 invalid_text_representation — invalid enum value for visibility

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { closePool, createCatalogRepositories, getPool } from '../src/index.ts';
import {
  expectPgError,
  isPostgresReachable,
  pgErrorCode,
  TEST_CONNECTION_URL,
  truncateCatalog,
} from './helpers.ts';

const reachable = await isPostgresReachable();

const describeSuite = reachable ? describe : describe.skip;

if (!reachable) {
  // biome-ignore lint/suspicious/noConsole: clear skip notice for the test runner (postgres not running)
  console.warn(
    'SKIP catalog_repository suite: local postgres (localhost:5433) is not running — start it with bun postgres:start',
  );
}

describeSuite('catalog write model (AC-3)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getPool({ connectionString: TEST_CONNECTION_URL });
    const { applyMigrations } = await import('../src/lib/migrate.ts');
    await applyMigrations({ connectionString: TEST_CONNECTION_URL });
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await truncateCatalog(pool);
  });

  test('happy path: account → pack → two versions', async () => {
    const { accounts, packs, packVersions } = createCatalogRepositories(pool);

    const account = await accounts.create({ firebaseUid: 'uid-1', displayName: 'Alice' });
    expect(account.id).toBeDefined();
    expect(account.firebaseUid).toBe('uid-1');
    expect(account.displayName).toBe('Alice');

    const pack = await packs.create({ slug: 'my-campaign', ownerAccountId: account.id });
    expect(pack.slug).toBe('my-campaign');
    expect(pack.visibility).toBe('draft');

    const v1 = await packVersions.create({
      packId: pack.id,
      version: '1.0.0',
      manifestHash: 'a'.repeat(64),
      publishedAt: new Date(),
    });
    const v2 = await packVersions.create({
      packId: pack.id,
      version: '1.1.0',
      manifestHash: 'b'.repeat(64),
    });

    expect(v1.version).toBe('1.0.0');
    expect(v1.publishedAt).toBeInstanceOf(Date);
    expect(v2.publishedAt).toBeNull();
    expect(await packVersions.listByPack(pack.id)).toHaveLength(2);
    expect(await accounts.findByFirebaseUid('uid-1')).toBeDefined();
  });

  test('violation: a second account with the same firebase_uid is rejected (23505)', async () => {
    const { accounts } = createCatalogRepositories(pool);
    await accounts.create({ firebaseUid: 'uid-dup' });
    await expectPgError(accounts.create({ firebaseUid: 'uid-dup' }), '23505');
  });

  test('violation: a second pack with the same slug is rejected (23505)', async () => {
    const { accounts, packs } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-slug' });
    await packs.create({ slug: 'same-slug', ownerAccountId: account.id });
    await expectPgError(packs.create({ slug: 'same-slug', ownerAccountId: account.id }), '23505');
  });

  test('violation: an invalid slug pattern is rejected by the CHECK (23514)', async () => {
    const { accounts, packs } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-check' });
    await expectPgError(packs.create({ slug: 'Not Valid!', ownerAccountId: account.id }), '23514');
  });

  test('violation: a second version with the same (pack_id, version) is rejected (23505)', async () => {
    const { accounts, packs, packVersions } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-ver' });
    const pack = await packs.create({ slug: 'ver-pack', ownerAccountId: account.id });
    await packVersions.create({ packId: pack.id, version: '1.0.0', manifestHash: 'a'.repeat(64) });
    await expectPgError(
      packVersions.create({ packId: pack.id, version: '1.0.0', manifestHash: 'b'.repeat(64) }),
      '23505',
    );
  });

  test('violation: a version referencing a non-existent pack is rejected (23503)', async () => {
    const { packVersions } = createCatalogRepositories(pool);
    await expectPgError(
      packVersions.create({
        packId: '00000000-0000-0000-0000-000000000000',
        version: '1.0.0',
        manifestHash: 'a'.repeat(64),
      }),
      '23503',
    );
  });

  test('violation: deleting an account that still owns a pack is REJECTED, not cascaded (23001)', async () => {
    const { accounts, packs } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-owner' });
    await packs.create({ slug: 'owned-pack', ownerAccountId: account.id });

    // 23001 = restrict_violation — ON DELETE RESTRICT fired. (A plain NO
    // ACTION FK would surface 23503 instead; RESTRICT is the contract.)
    await expectPgError(accounts.delete(account.id), '23001');

    // The account row must still exist — the delete did not cascade.
    expect(await accounts.findById(account.id)).toBeDefined();
  });

  test('violation: deleting a pack that still has versions is REJECTED, not cascaded (23001)', async () => {
    const { accounts, packs, packVersions } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-pack' });
    const pack = await packs.create({ slug: 'with-versions', ownerAccountId: account.id });
    await packVersions.create({ packId: pack.id, version: '1.0.0', manifestHash: 'a'.repeat(64) });

    // 23001 = restrict_violation — ON DELETE RESTRICT fired (see above).
    await expectPgError(packs.delete(pack.id), '23001');
    expect(await packs.findById(pack.id)).toBeDefined();
  });

  test('violation: an invalid visibility value is rejected by the enum (22P02)', async () => {
    const { accounts } = createCatalogRepositories(pool);
    const account = await accounts.create({ firebaseUid: 'uid-enum' });
    // Bypass the repository's typed union — the DB must reject raw bad input.
    const err = await pool
      .query(
        `INSERT INTO packs (slug, owner_account_id, visibility)
         VALUES ('bad-enum', $1, 'on-fire')`,
        [account.id],
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(pgErrorCode(err)).toBe('22P02');
  });
});
