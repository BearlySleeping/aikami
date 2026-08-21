// packages/backend/database/tests/d1_schema.test.ts
//
// C-426 AC-1: the Cloudflare D1 schema (sqlite dialect) round-trips a pack
// insert/select identical in shape to the existing Postgres repository test
// (catalog_repository.test.ts).
//
// Runs against an in-memory libsql database (the same SQLite engine D1 uses)
// with the generated D1 migration applied — a mocked database cannot prove
// the schema/constraints exist. D1 itself is SQLite under the hood, so an
// in-memory libsql instance is a faithful stand-in for `wrangler d1
// migrations apply DB --local` without needing a wrangler runtime in the
// unit-test loop.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import {
  accountBackups,
  accounts,
  packs,
  packVersions,
  sessions,
  users,
  verifications,
} from '../src/lib/d1_schema.ts';

// ── In-memory libsql database ───────────────────────────────────────────

let client: Client;
let db: LibSQLDatabase<Record<string, never>>;

/** Apply the generated D1 migration SQL (drizzle-d1/*.sql) to the in-memory db. */
const applyD1Migrations = async (): Promise<void> => {
  const dir = join(import.meta.dir, '..', 'drizzle-d1');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) {
        await client.execute(trimmed);
      }
    }
  }
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  db = drizzle(client);
  await applyD1Migrations();
});

afterAll(async () => {
  await client.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────

const insertUser = async (id: string, email: string) => {
  const now = new Date();
  await db.insert(users).values({
    id,
    name: 'Alice',
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
};

// ── Tests ───────────────────────────────────────────────────────────────

describe('D1 schema (AC-1)', () => {
  test('all seven tables exist after applying the migration', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const names = result.rows.map((r) => r.name as string);
    for (const expected of [
      'user',
      'session',
      'account',
      'verification',
      'packs',
      'pack_versions',
      'account_backups',
    ]) {
      expect(names).toContain(expected);
    }
  });

  test('happy path: user → pack → version round-trips (shape parity with Postgres test)', async () => {
    await insertUser('user-1', 'alice@example.com');

    const pack = await db
      .insert(packs)
      .values({
        id: 'pack-1',
        slug: 'my-campaign',
        ownerAccountId: 'user-1',
        visibility: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(pack[0].slug).toBe('my-campaign');
    expect(pack[0].visibility).toBe('draft');
    expect(pack[0].ownerAccountId).toBe('user-1');

    const v1 = await db
      .insert(packVersions)
      .values({
        id: 'pv-1',
        packId: 'pack-1',
        version: '1.0.0',
        manifestHash: 'a'.repeat(64),
        createdAt: new Date(),
        publishedAt: new Date(),
      })
      .returning();
    const v2 = await db
      .insert(packVersions)
      .values({
        id: 'pv-2',
        packId: 'pack-1',
        version: '1.1.0',
        manifestHash: 'b'.repeat(64),
        createdAt: new Date(),
      })
      .returning();

    expect(v1[0].version).toBe('1.0.0');
    expect(v1[0].publishedAt).toBeInstanceOf(Date);
    expect(v2[0].publishedAt).toBeNull();

    const listed = await db.select().from(packVersions).where(eq(packVersions.packId, 'pack-1'));
    expect(listed).toHaveLength(2);

    const fetched = await db.select().from(packs).where(eq(packs.id, 'pack-1'));
    expect(fetched[0].slug).toBe('my-campaign');
  });

  test('packs.owner_account_id has a foreign key to user.id (RESTRICT)', async () => {
    // Inserting a pack with a non-existent owner must be rejected by the FK.
    await expect(
      db
        .insert(packs)
        .values({
          id: 'pack-orphan',
          slug: 'orphan-pack',
          ownerAccountId: 'no-such-user',
          visibility: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).rejects.toThrow();
  });

  test('a second pack with the same slug is rejected (unique)', async () => {
    await insertUser('user-2', 'bob@example.com');
    await db.insert(packs).values({
      id: 'pack-a',
      slug: 'same-slug',
      ownerAccountId: 'user-2',
      visibility: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      db
        .insert(packs)
        .values({
          id: 'pack-b',
          slug: 'same-slug',
          ownerAccountId: 'user-2',
          visibility: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).rejects.toThrow();
  });

  test('an invalid visibility value is rejected by the CHECK constraint', async () => {
    await insertUser('user-3', 'carol@example.com');
    await expect(
      db
        .insert(packs)
        .values({
          id: 'pack-bad',
          slug: 'bad-visibility',
          ownerAccountId: 'user-3',
          visibility: 'on-fire',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).rejects.toThrow();
  });

  test('account_backups round-trips and references user.id', async () => {
    await insertUser('user-4', 'dave@example.com');
    const backup = await db
      .insert(accountBackups)
      .values({
        id: 'backup-1',
        accountId: 'user-4',
        r2Key: 'saves/user-4/1700000000000-save.db',
        sizeBytes: 4096,
        checksumSha256: 'c'.repeat(64),
        createdAt: new Date(),
      })
      .returning();
    expect(backup[0].r2Key).toBe('saves/user-4/1700000000000-save.db');
    expect(backup[0].sizeBytes).toBe(4096);
  });

  test('Better Auth identity tables are present and usable', async () => {
    await insertUser('user-5', 'erin@example.com');
    const session = await db
      .insert(sessions)
      .values({
        id: 'sess-1',
        expiresAt: new Date(Date.now() + 3600_000),
        token: 'tok-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'user-5',
      })
      .returning();
    expect(session[0].token).toBe('tok-1');

    const account = await db
      .insert(accounts)
      .values({
        id: 'acct-1',
        accountId: 'google-123',
        providerId: 'google',
        userId: 'user-5',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    expect(account[0].providerId).toBe('google');

    const verification = await db
      .insert(verifications)
      .values({
        id: 'ver-1',
        identifier: 'alice@example.com',
        value: 'code-1',
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    expect(verification[0].identifier).toBe('alice@example.com');
  });
});
