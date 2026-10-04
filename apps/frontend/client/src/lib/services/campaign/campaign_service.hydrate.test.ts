// apps/frontend/client/src/lib/services/campaign/campaign_service.hydrate.test.ts
//
// Save-slot hydration contract for the campaign aggregate — driven through the
// REAL serializable registry, not a stub, because the defect was in the
// registration itself.
//
// Production symptom this locks down: a save slot embeds a campaign snapshot
// taken before the save wrote its metadata (the slot is persisted first, the
// metadata second, so a failed metadata write can never leave resume pointing
// at a slot that does not exist). On reload, boot hydrates that stale copy over
// the campaign it just resolved from the campaigns table, so the pause overlay
// reported "Not saved yet" while the stored row carried a real timestamp.
//
// The campaigns table is the source of truth: hydration must never replace a
// stored campaign, whatever the slot contains.

import { beforeEach, describe, expect, test } from 'bun:test';
import type { Campaign } from '@aikami/types';
// Real registry: `campaignService` registers into this module at construction.
import { hydrateAllServices, serializeAllServices } from '../game/serializable_service.ts';
import { campaignService } from './campaign_service.svelte.ts';

const SAVED_AT = '2026-10-03T22:12:30.335Z';
const OLDER_SAVED_AT = '2026-10-03T20:47:08.916Z';

const storedCampaign = (overrides?: Partial<Campaign>): Campaign => ({
  id: 'default-emberwatch',
  name: 'Emberwatch',
  state: 'playing',
  contentPackId: 'emberwatch',
  seed: 42,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: SAVED_AT,
  lastSavedAt: SAVED_AT,
  lastSaveSlotId: 'manual-1',
  capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
  ...overrides,
});

/** Hydrates the campaign aggregate exactly as the boot pipeline does. */
const hydrateSlot = (slotCampaign: unknown): void => {
  hydrateAllServices([{ serviceKey: 'campaign', data: slotCampaign }]);
};

beforeEach(() => {
  campaignService.activeCampaign = undefined;
});

describe('CampaignService — save-slot hydration', () => {
  test('a slot snapshot WITHOUT a timestamp does not erase the stored one', () => {
    campaignService.activeCampaign = storedCampaign();

    // The slot was written before this save existed, so its embedded copy has
    // no save metadata at all.
    hydrateSlot(storedCampaign({ lastSavedAt: undefined, lastSaveSlotId: undefined }));

    expect(campaignService.activeCampaign?.lastSavedAt).toBe(SAVED_AT);
    expect(campaignService.activeCampaign?.lastSaveSlotId).toBe('manual-1');
  });

  test('a slot snapshot with OLDER non-empty metadata does not clobber the stored one', () => {
    campaignService.activeCampaign = storedCampaign();

    hydrateSlot(
      storedCampaign({
        lastSavedAt: OLDER_SAVED_AT,
        lastSaveSlotId: 'auto-save',
        updatedAt: OLDER_SAVED_AT,
      }),
    );

    expect(campaignService.activeCampaign?.lastSavedAt).toBe(SAVED_AT);
    expect(campaignService.activeCampaign?.lastSaveSlotId).toBe('manual-1');
  });

  test('a slot snapshot for a DIFFERENT campaign is refused', () => {
    campaignService.activeCampaign = storedCampaign();

    hydrateSlot(storedCampaign({ id: 'other-campaign', lastSavedAt: OLDER_SAVED_AT }));

    // Switching identity here would re-scope NPC memory and break the
    // save↔campaign linkage the overlay's save path relies on.
    expect(campaignService.activeCampaign?.id).toBe('default-emberwatch');
    expect(campaignService.activeCampaign?.lastSavedAt).toBe(SAVED_AT);
  });

  test('the stored campaign is authoritative even when the slot disagrees on state', () => {
    campaignService.activeCampaign = storedCampaign({ state: 'paused' });

    hydrateSlot(storedCampaign({ state: 'playing' }));

    expect(campaignService.activeCampaign?.state).toBe('paused');
  });

  test('legacy: with no stored campaign a schema-valid snapshot is adopted', () => {
    const legacy = storedCampaign({ id: 'legacy-campaign', lastSavedAt: OLDER_SAVED_AT });

    hydrateSlot(legacy);

    expect(campaignService.activeCampaign?.id).toBe('legacy-campaign');
    expect(campaignService.activeCampaign?.lastSavedAt).toBe(OLDER_SAVED_AT);
  });

  test('legacy: a missing or malformed snapshot invents nothing', () => {
    hydrateSlot(null);
    expect(campaignService.activeCampaign).toBeUndefined();

    hydrateSlot({ id: 'broken' });
    expect(campaignService.activeCampaign).toBeUndefined();
  });

  test('round trip: what the slot carries is the current campaign, and hydration is a no-op', () => {
    campaignService.activeCampaign = storedCampaign();

    const snapshots = serializeAllServices();
    const campaignSnapshot = snapshots.find((s) => s.serviceKey === 'campaign');
    expect(campaignSnapshot?.data).toMatchObject({ id: 'default-emberwatch' });

    // Re-hydrating our own snapshot must be idempotent.
    hydrateAllServices(snapshots.filter((s) => s.serviceKey === 'campaign'));
    expect(campaignService.activeCampaign?.lastSavedAt).toBe(SAVED_AT);
  });
});
