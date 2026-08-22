// packages/backend/database/src/lib/repositories/account_repository.ts
//
// C-394: repository for the `accounts` table.
//
// Plain class holding an injected connection (the shared `pg.Pool`),
// plain typed queries — no generic document abstraction (the anti-pattern
// C-386 explicitly warned against porting).

import { BaseClass, type BaseClassOptions } from '@aikami/utils';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { pgErrorCode } from '../pg_errors.ts';
import { type AccountRow, accounts } from '../schema.ts';

export type AccountRepositoryOptions = BaseClassOptions & {
  /** Shared pooled connection (see connection.ts). */
  pool: Pool;
};

/**
 * CRUD for hub member accounts.
 *
 * Rows are created LAZILY (never in the auth path): the first member action
 * that needs an account calls `createOrFetch` — the pattern C-398
 * (submissions) and C-399 (ratings) must both use.
 */
export class AccountRepository extends BaseClass<AccountRepositoryOptions> {
  private readonly _db: NodePgDatabase<{ accounts: typeof accounts }>;

  constructor(options: AccountRepositoryOptions) {
    super({ ...options, className: 'AccountRepository' });
    if (!options.pool) {
      throw new Error('AccountRepository requires a pg Pool');
    }
    this._db = drizzle(options.pool, { schema: { accounts } });
  }

  /** Insert a new account. Throws on a duplicate authUid (unique). */
  async create(options: { authUid: string; displayName?: string | null }): Promise<AccountRow> {
    const { authUid, displayName = null } = options;
    const [row] = await this._db.insert(accounts).values({ authUid, displayName }).returning();
    if (!row) {
      throw new Error('accounts.insert returned no row');
    }
    return row;
  }

  /** Create-or-fetch by auth uid — the lazy account-row idiom. */
  async createOrFetch(options: {
    authUid: string;
    displayName?: string | null;
  }): Promise<AccountRow> {
    const existing = await this.findByAuthUid(options.authUid);
    if (existing) {
      return existing;
    }
    try {
      return await this.create(options);
    } catch (error) {
      // Only a UNIQUE violation (23505) means we lost the create-or-fetch
      // race — any other failure (connection, constraint) must surface
      // unchanged rather than being masked by a re-fetch.
      if (pgErrorCode(error) !== '23505') {
        throw error;
      }
      // Lost the uniqueness race — another request created the row first.
      const winner = await this.findByAuthUid(options.authUid);
      if (winner) {
        return winner;
      }
      throw new Error('accounts.create failed and no winner row exists', { cause: error });
    }
  }

  async findById(id: string): Promise<AccountRow | undefined> {
    const rows = await this._db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return rows[0];
  }

  async findByAuthUid(authUid: string): Promise<AccountRow | undefined> {
    const rows = await this._db
      .select()
      .from(accounts)
      .where(eq(accounts.authUid, authUid))
      .limit(1);
    return rows[0];
  }

  /** Batch read by ids — an `IN` query; never call findById in a loop. */
  async listByIds(ids: readonly string[]): Promise<AccountRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this._db.select().from(accounts).where(inArray(accounts.id, ids));
  }

  /**
   * Delete an account. Rejected by the database (foreign_key_violation)
   * when the account still owns packs — ON DELETE RESTRICT.
   */
  async delete(id: string): Promise<boolean> {
    const rows = await this._db
      .delete(accounts)
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    return rows.length > 0;
  }
}
