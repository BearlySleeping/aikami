// packages/backend/database/src/lib/repositories/pack_repository.ts
//
// C-394: repository for the `packs` table — catalog identity + ownership.
//
// The pack's *content* lives in the static index (D-14); this row exists so
// a pack can be owned, moderated and versioned.

import { BaseClass, type BaseClassOptions } from '@aikami/utils';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { type PackRow, packs, type packVisibility } from '../schema.ts';

export type PackRepositoryOptions = BaseClassOptions & {
  /** Shared pooled connection (see connection.ts). */
  pool: Pool;
};

export type PackVisibilityValue = (typeof packVisibility.enumValues)[number];

/**
 * CRUD for catalog packs.
 *
 * Visibility is a Postgres enum, slug uniqueness and url-safety are
 * enforced in the database (unique + CHECK), ownership is a RESTRICT FK —
 * the repository never soft-enforces what the schema already guarantees.
 */
export class PackRepository extends BaseClass<PackRepositoryOptions> {
  private readonly _db: NodePgDatabase<{ packs: typeof packs }>;

  constructor(options: PackRepositoryOptions) {
    super({ ...options, className: 'PackRepository' });
    if (!options.pool) {
      throw new Error('PackRepository requires a pg Pool');
    }
    this._db = drizzle(options.pool, { schema: { packs } });
  }

  /** Insert a new pack. Throws on a duplicate slug (unique). */
  async create(options: {
    slug: string;
    ownerAccountId: string;
    visibility?: PackVisibilityValue;
  }): Promise<PackRow> {
    const { slug, ownerAccountId, visibility = 'draft' } = options;
    const [row] = await this._db
      .insert(packs)
      .values({ slug, ownerAccountId, visibility })
      .returning();
    if (!row) {
      throw new Error('packs.insert returned no row');
    }
    return row;
  }

  async findById(id: string): Promise<PackRow | undefined> {
    const rows = await this._db.select().from(packs).where(eq(packs.id, id)).limit(1);
    return rows[0];
  }

  async findBySlug(slug: string): Promise<PackRow | undefined> {
    const rows = await this._db.select().from(packs).where(eq(packs.slug, slug)).limit(1);
    return rows[0];
  }

  /** All packs owned by an account, newest first. */
  async listByOwner(ownerAccountId: string): Promise<PackRow[]> {
    return this._db
      .select()
      .from(packs)
      .where(eq(packs.ownerAccountId, ownerAccountId))
      .orderBy(desc(packs.createdAt));
  }

  /** Batch read by ids — an `IN` query; never call findById in a loop. */
  async listByIds(ids: readonly string[]): Promise<PackRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this._db.select().from(packs).where(inArray(packs.id, ids));
  }

  async updateVisibility(options: {
    id: string;
    visibility: PackVisibilityValue;
  }): Promise<PackRow | undefined> {
    const { id, visibility } = options;
    const rows = await this._db
      .update(packs)
      .set({ visibility })
      .where(eq(packs.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Delete a pack. Rejected by the database (foreign_key_violation) while
   * any pack_versions row references it — ON DELETE RESTRICT.
   */
  async delete(id: string): Promise<boolean> {
    const rows = await this._db.delete(packs).where(eq(packs.id, id)).returning({ id: packs.id });
    return rows.length > 0;
  }

  /**
   * Count of publicly visible packs (C-396 AC-4 placeholder aggregate).
   *
   * Zero until C-398/C-399 write rows — the stats stream's job is to prove
   * the I-8 machinery end to end, not to return meaningful numbers yet.
   */
  async countPublic(): Promise<number> {
    const rows = await this._db
      .select({ value: count() })
      .from(packs)
      .where(eq(packs.visibility, sql`'public'::pack_visibility`));
    return rows[0]?.value ?? 0;
  }
}
