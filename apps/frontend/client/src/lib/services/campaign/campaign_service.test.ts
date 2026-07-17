// apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts
//
// Tests for CampaignService — updated for C-321 Turso migration.
// Uses the test_preload fake LocalDatabaseInterface instead of
// mock IndexedDB.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Campaign } from '@aikami/types';

// Mocks — must run before any imports that transitively touch $services
// ---------------------------------------------------------------------------

mock.module('$services', () => ({
  aiSettingsService: {
    textProvider: { apiKey: '', endpoint: 'http://localhost:11434', model: 'llama3' },
    imageProvider: { apiKey: '', endpoint: '' },
    ttsProvider: { apiKey: '', endpoint: '' },
  },
  capabilityService: {
    detectText: mock(async () => 'not_found'),
    detectImage: mock(async () => 'not_found'),
  },
}));

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

// ---------------------------------------------------------------------------
// Crypto mock
// ---------------------------------------------------------------------------

globalThis.crypto = {
  randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
} as unknown as Crypto;

// ---------------------------------------------------------------------------
// Reset fake DB via the repositories mock
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Reset the fake database before each test
  const reposMod = await import('@aikami/frontend/repositories');
  (reposMod as unknown as { resetLocalDatabase: () => void }).resetLocalDatabase();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CampaignService', () => {
  // We must import dynamically AFTER the mock.module calls.
  const box: { svc: null | Record<string, unknown> } = { svc: null };

  const getSvc = () =>
    box.svc as unknown as {
      hasCampaigns: () => boolean;
      getLatestCampaign: () => Campaign | undefined;
      startNewCampaign: (opts?: { personaId?: string }) => Promise<Campaign>;
      loadCampaign: (opts: { campaignId: string }) => Promise<Campaign>;
      completeSetup: () => void;
      pauseCampaign: () => void;
      resumeCampaign: () => void;
      saveCampaign: (opts?: { slotId?: string }) => Promise<void>;
      campaigns: Campaign[];
      activeCampaign: Campaign | undefined;
      refreshCampaigns: () => Promise<void>;
    };

  beforeEach(async () => {
    const mod = await import('./campaign_service.svelte.ts');
    const svc = mod.campaignService;
    box.svc = svc as unknown as Record<string, unknown>;
    // Reset singleton state between tests
    if ('activeCampaign' in svc) {
      (svc as Record<string, unknown>).activeCampaign = undefined;
    }
    if ('isBusy' in svc) {
      (svc as Record<string, unknown>).isBusy = false;
    }
    if ('_campaigns' in svc) {
      (svc as Record<string, unknown>)._campaigns = [];
    }
  });

  test('hasCampaigns returns false when no campaigns exist', () => {
    expect(getSvc().hasCampaigns()).toBe(false);
    expect(getSvc().getLatestCampaign()).toBeUndefined();
  });

  test('startNewCampaign creates a campaign in creating state', async () => {
    const campaign = await getSvc().startNewCampaign();
    expect(campaign.state).toBe('creating');
    expect(campaign.contentPackId).toBe('emberwatch');
    expect(campaign.name).toBe('New Adventure');
    expect(getSvc().hasCampaigns()).toBe(true);
    expect(getSvc().activeCampaign?.id).toBe(campaign.id);
  });

  test('startNewCampaign with personaId', async () => {
    const campaign = await getSvc().startNewCampaign({ personaId: 'persona-123' });
    expect(campaign.personaId).toBe('persona-123');
  });

  test('loadCampaign throws for non-existent campaign', async () => {
    await expect(getSvc().loadCampaign({ campaignId: 'non-existent' })).rejects.toThrow(
      'Campaign not found',
    );
  });

  test('completeSetup transitions creating → playing', async () => {
    await getSvc().startNewCampaign();
    getSvc().completeSetup();
    expect(getSvc().activeCampaign?.state).toBe('playing');
  });

  test('completeSetup throws without active campaign', () => {
    expect(() => getSvc().completeSetup()).toThrow('No active campaign');
  });

  test('pauseCampaign transitions playing → paused', async () => {
    await getSvc().startNewCampaign();
    getSvc().completeSetup();
    getSvc().pauseCampaign();
    expect(getSvc().activeCampaign?.state).toBe('paused');
  });

  test('resumeCampaign transitions paused → playing', async () => {
    await getSvc().startNewCampaign();
    getSvc().completeSetup();
    getSvc().pauseCampaign();
    getSvc().resumeCampaign();
    expect(getSvc().activeCampaign?.state).toBe('playing');
  });

  test('pauseCampaign throws without active campaign', () => {
    expect(() => getSvc().pauseCampaign()).toThrow('No active campaign');
  });

  test('saveCampaign updates lastSavedAt', async () => {
    await getSvc().startNewCampaign();
    getSvc().completeSetup();
    await getSvc().saveCampaign();
    expect(getSvc().activeCampaign?.state).toBe('playing');
    expect(getSvc().activeCampaign?.lastSavedAt).toBeDefined();
    expect(getSvc().activeCampaign?.lastSaveSlotId).toBe('auto-save');
  });

  test('saveCampaign with custom slotId', async () => {
    await getSvc().startNewCampaign();
    getSvc().completeSetup();
    await getSvc().saveCampaign({ slotId: 'manual-1' });
    expect(getSvc().activeCampaign?.lastSaveSlotId).toBe('manual-1');
  });

  test('saveCampaign throws without active campaign', async () => {
    await expect(getSvc().saveCampaign()).rejects.toThrow('No active campaign to save');
  });

  test('getLatestCampaign returns newest campaign', async () => {
    await getSvc().startNewCampaign();
    const latest = getSvc().getLatestCampaign();
    expect(latest).toBeDefined();
    expect(latest?.state).toBe('creating');
  });

  test('hasCampaigns returns true after startNewCampaign', async () => {
    await getSvc().startNewCampaign();
    expect(getSvc().hasCampaigns()).toBe(true);
  });
});
