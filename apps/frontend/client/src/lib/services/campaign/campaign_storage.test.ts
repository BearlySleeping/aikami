// apps/frontend/client/src/lib/services/campaign/campaign_storage.test.ts
//
// Runtime-boundary tests for persisted campaign validation.

import { beforeEach, describe, expect, test } from 'bun:test';
import { getLocalDatabase } from '@aikami/frontend/storage';
import { campaignStorage } from './campaign_storage.svelte.ts';

const makePersistedCampaign = (options: { id: string; includeCapabilityProfile: boolean }) => ({
  id: options.id,
  name: 'Test Campaign',
  state: 'playing',
  contentPackId: 'emberwatch',
  seed: 42,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...(options.includeCapabilityProfile
    ? {
        capabilityProfile: {
          textProvider: true,
          imageProvider: false,
          voiceProvider: false,
        },
      }
    : {}),
});

const insertPersistedCampaign = async (options: {
  id: string;
  includeCapabilityProfile: boolean;
}): Promise<void> => {
  const database = await getLocalDatabase();
  const campaign = makePersistedCampaign(options);
  await database.execute({
    sql: 'INSERT OR REPLACE INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)',
    args: [options.id, JSON.stringify(campaign), campaign.updatedAt],
  });
};

describe('CampaignStorage persisted-data validation', () => {
  beforeEach(async () => {
    const database = await getLocalDatabase();
    await database.execute({
      sql: 'DELETE FROM campaigns WHERE id = ?',
      args: ['legacy-campaign'],
    });
  });

  test('getById rejects a legacy campaign missing capabilityProfile', async () => {
    await insertPersistedCampaign({ id: 'legacy-campaign', includeCapabilityProfile: false });

    await expect(campaignStorage.getById('legacy-campaign')).rejects.toThrow();
  });

  test('getAll rejects a legacy campaign missing capabilityProfile', async () => {
    await insertPersistedCampaign({ id: 'legacy-campaign', includeCapabilityProfile: false });

    await expect(campaignStorage.getAll()).rejects.toThrow();
  });
});
