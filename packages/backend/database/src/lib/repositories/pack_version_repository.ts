// packages/backend/database/src/lib/repositories/pack_version_repository.ts
//
// C-394: repository for the `pack_versions` table — immutable published
// versions, content-addressed by manifestHash into the static index.

import { BaseClass, type BaseClassOptions } from '@aikami/utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { type PackVersionRow, packVersions } from '../schema.ts';

export type PackVersionRepositoryOptions = BaseClassOptions & {
  /** Shared pooled connection (see connection.ts). */
  pool: Pool;
};

/**
 * CRUD for pack versions.
 *
 * Versions are immutable once published: there is deliberately no update
 * method. Uniqueness of (pack_id, version) is enforced in the database.
 */
export class PackVersionRepository extends BaseClass<PackVersionRepositoryOptions> {
  private readonly _db: NodePgDatabase<{ packVersions: typeof packVersions }>;

  constructor(options: PackVersionRepositoryOptions) {
    super({ ...options, className: 'PackVersionRepository' });
    if (!options.pool) {
      throw new Error('PackVersionRepository requires a pg Pool');
    }
    this._db = drizzle(options.pool, { schema: { packVersions } });
  }

  /** Insert a version. Throws on a duplicate (pack_id, version) — unique. */
  async create(options: {
    packId: string;
    version: string;
    manifestHash: string;
    publishedAt?: Date | null;
  }): Promise<PackVersionRow> {
    const { packId, version, manifestHash, publishedAt = null } = options;
    const [row] = await this._db
      .insert(packVersions)
      .values({ packId, version, manifestHash, publishedAt })
      .returning();
    if (!row) {
      throw new Error('pack_versions.insert returned no row');
    }
    return row;
  }

  async findById(id: string): Promise<PackVersionRow | undefined> {
    const rows = await this._db.select().from(packVersions).where(eq(packVersions.id, id)).limit(1);
    return rows[0];
  }

  async findByPackAndVersion(options: {
    packId: string;
    version: string;
  }): Promise<PackVersionRow | undefined> {
    const { packId, version } = options;
    const rows = await this._db
      .select()
      .from(packVersions)
      .where(and(eq(packVersions.packId, packId), eq(packVersions.version, version)))
      .limit(1);
    return rows[0];
  }

  /** All versions of a pack, newest published first (nulls last); semver ordering is C-398's job. */
  async listByPack(packId: string): Promise<PackVersionRow[]> {
    return this._db
      .select()
      .from(packVersions)
      .where(eq(packVersions.packId, packId))
      .orderBy(sql`${packVersions.publishedAt} DESC NULLS LAST`);
  }

  /** Batch read by pack ids — one `IN` query instead of N per-pack queries. */
  async listByPackIds(packIds: readonly string[]): Promise<PackVersionRow[]> {
    if (packIds.length === 0) {
      return [];
    }
    return this._db
      .select()
      .from(packVersions)
      .where(inArray(packVersions.packId, packIds))
      .orderBy(sql`${packVersions.publishedAt} DESC NULLS LAST`);
  }

  /** Delete a version (test/cleanup only — published versions are immutable in production flow). */
  async delete(id: string): Promise<boolean> {
    const rows = await this._db
      .delete(packVersions)
      .where(eq(packVersions.id, id))
      .returning({ id: packVersions.id });
    return rows.length > 0;
  }
}
