// apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts
//
// Turso/libSQL-backed repository for Campaign aggregate persistence.
// Replaces IndexedDB with the local SQLite database via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso

import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { Campaign } from '@aikami/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignRepositoryInterface = BaseFrontendClassInterface & {
  /** Persists a campaign (upsert by ID). */
  create(campaign: Campaign): Promise<Campaign>;
  /** Retrieves a campaign by ID, or undefined if not found. */
  getById(id: string): Promise<Campaign | undefined>;
  /** Retrieves all campaigns, sorted by updatedAt descending (newest first). */
  getAll(): Promise<Campaign[]>;
  /** Updates an existing campaign (throws if not found). */
  update(campaign: Campaign): Promise<Campaign>;
  /** Deletes a campaign by ID. */
  delete(id: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Repository Implementation
// ---------------------------------------------------------------------------

class CampaignRepository
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CampaignRepositoryInterface
{
  /** @inheritdoc */
  async create(campaign: Campaign): Promise<Campaign> {
    const db = await getLocalDatabase();
    const data = JSON.stringify(campaign);

    await db.execute({
      sql: `INSERT OR REPLACE INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
      args: [campaign.id, data, campaign.updatedAt],
    });

    return campaign;
  }

  /** @inheritdoc */
  async getById(id: string): Promise<Campaign | undefined> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT data FROM campaigns WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) {
      return undefined;
    }

    return JSON.parse(result.rows[0].data as string) as Campaign;
  }

  /** @inheritdoc */
  async getAll(): Promise<Campaign[]> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT data FROM campaigns ORDER BY updated_at DESC',
      args: [],
    });

    return result.rows.map((row) => JSON.parse(row.data as string) as Campaign);
  }

  /** @inheritdoc */
  async update(campaign: Campaign): Promise<Campaign> {
    const db = await getLocalDatabase();
    const data = JSON.stringify(campaign);

    // Use a transaction to make check and update atomic
    await db.transaction([
      {
        sql: 'SELECT id FROM campaigns WHERE id = ?',
        args: [campaign.id],
      },
      {
        sql: `UPDATE campaigns SET data = ?, updated_at = ? WHERE id = ?`,
        args: [data, campaign.updatedAt, campaign.id],
      },
    ]);

    // Post-transaction verification: confirm the campaign exists
    // If the transaction succeeded but the campaign doesn't exist,
    // it means the SELECT returned empty (campaign was not found)
    const verification = await db.query({
      sql: 'SELECT id FROM campaigns WHERE id = ?',
      args: [campaign.id],
    });

    if (verification.rows.length === 0) {
      throw new Error(`Campaign not found: ${campaign.id}`);
    }

    return campaign;
  }

  /** @inheritdoc */
  async delete(id: string): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM campaigns WHERE id = ?',
      args: [id],
    });
  }
}

/** Shared singleton instance. */
export const campaignRepository: CampaignRepositoryInterface = CampaignRepository.create({
  className: 'CampaignRepository',
});
