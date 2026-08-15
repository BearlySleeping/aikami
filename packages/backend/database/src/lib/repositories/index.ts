// packages/backend/database/src/lib/repositories/index.ts
//
// C-394: repository bundle — one typed handle over the three catalog tables.

import type { Pool } from 'pg';
import { AccountRepository } from './account_repository.ts';
import { PackRepository } from './pack_repository.ts';
import { PackVersionRepository } from './pack_version_repository.ts';

export type CatalogRepositories = {
  accounts: AccountRepository;
  packs: PackRepository;
  packVersions: PackVersionRepository;
};

/**
 * Build the three catalog repositories over one shared pool.
 *
 * The caller owns the pool's lifecycle (created lazily via `getPool` in
 * connection.ts — never at module load) and must close it with
 * `closePool()` when the process shuts down.
 */
export const createCatalogRepositories = (pool: Pool): CatalogRepositories => ({
  accounts: AccountRepository.create({ pool, className: 'AccountRepository' }),
  packs: PackRepository.create({ pool, className: 'PackRepository' }),
  packVersions: PackVersionRepository.create({ pool, className: 'PackVersionRepository' }),
});
