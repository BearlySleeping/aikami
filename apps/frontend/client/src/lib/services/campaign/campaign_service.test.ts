// apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts
//
// Tests for CampaignService — updated for C-321 Turso migration.
// Uses the test_preload fake LocalDatabaseInterface instead of
// mock IndexedDB.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine
// Contract: C-323 Enforce the Mandatory Text AI Capability Gate (AC-1, AC-4)

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names for module mocking

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Campaign } from '@aikami/types';

// Mock @aikami/utils before it gets resolved — Bun's tsconfig paths don't
// cover workspace packages in test mode, so we provide the AiTextProviderRequiredError
// class locally.
mock.module('@aikami/utils', () => {
  class AiTextProviderRequiredError extends Error {
    readonly code = 'text-provider-required' as const;
    constructor(message = 'A text AI provider is required to start a campaign.') {
      super(message);
      this.name = 'AiTextProviderRequiredError';
    }
  }
  return {
    AiTextProviderRequiredError,
    isAiTextProviderRequiredError: (error: unknown): error is AiTextProviderRequiredError =>
      error instanceof AiTextProviderRequiredError,
  };
});

const { AiTextProviderRequiredError } = await import('@aikami/utils');

// Mocks — must run before any imports that transitively touch $services
// ---------------------------------------------------------------------------

/** Mutable stubs for aiSettingsService — used to control gate behavior. */
let _textProviderApiKey = '';
let _textProviderEndpoint = 'http://localhost:11434';
let _textProviderModel = 'llama3';

mock.module('$services', () => ({
  aiSettingsService: {
    get textProvider() {
      return {
        apiKey: _textProviderApiKey,
        endpoint: _textProviderEndpoint,
        model: _textProviderModel,
      };
    },
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

let _uuidCounter = 0;
globalThis.crypto = {
  randomUUID: () => {
    const counter = _uuidCounter++;
    const hex = counter.toString(16).padStart(12, '0');
    return `550e8400-e29b-41d4-a716-${hex}`;
  },
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
      startNewCampaign: (opts?: { personaId?: string; contentPackId?: string }) => Promise<Campaign>;
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

  // ── AC-1: Gate rejection when text provider is false ──────────────────

  test('startNewCampaign throws AiTextProviderRequiredError when textProvider is false', async () => {
    // Disable all text providers
    _textProviderApiKey = '';
    _textProviderEndpoint = '';
    _textProviderModel = '';

    await expect(getSvc().startNewCampaign()).rejects.toBeInstanceOf(AiTextProviderRequiredError);
  });

  test('gate rejection message includes actionable guidance', async () => {
    _textProviderApiKey = '';
    _textProviderEndpoint = '';
    _textProviderModel = '';

    try {
      await getSvc().startNewCampaign();
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AiTextProviderRequiredError);
      expect(String(error)).toInclude('text AI provider');
    }
  });

  test('gate rejection does not persist campaign to DB', async () => {
    _textProviderApiKey = '';
    _textProviderEndpoint = '';
    _textProviderModel = '';

    // Count campaigns before the rejected attempt
    await getSvc().refreshCampaigns();
    const preCount = getSvc().campaigns.length;

    try {
      await getSvc().startNewCampaign();
    } catch {
      // Expected
    }

    // No new campaign should have been created
    await getSvc().refreshCampaigns();
    expect(getSvc().campaigns.length).toBe(preCount);
  });

  // ── AC-4: QA/CI bypass allows creation without text provider ──────────

  test('startNewCampaign succeeds with textProvider:false when bypass window flag is set', async () => {
    _textProviderApiKey = '';
    _textProviderEndpoint = '';
    _textProviderModel = '';

    // Set the bypass flag
    (window as Record<string, unknown>).__AIKAMI_AI_GATE_BYPASS__ = true;

    try {
      const campaign = await getSvc().startNewCampaign();
      expect(campaign.state).toBe('creating');
      expect(campaign.capabilityProfile.textProvider).toBe(false);
    } finally {
      delete (window as Record<string, unknown>).__AIKAMI_AI_GATE_BYPASS__;
    }
  });

  test('startNewCampaign with explicit capabilityProfile overrides buildCapabilityProfile', async () => {
    _textProviderApiKey = 'test-key';
    _textProviderEndpoint = '';
    _textProviderModel = '';

    const campaign = await getSvc().startNewCampaign({
      capabilityProfile: {
        textProvider: true,
        imageProvider: false,
        voiceProvider: false,
      },
    });
    expect(campaign.capabilityProfile.textProvider).toBe(true);
    expect(campaign.capabilityProfile.imageProvider).toBe(false);
    expect(campaign.capabilityProfile.voiceProvider).toBe(false);
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

  test('startNewCampaign consecutively creates distinct campaigns', async () => {
    const campaign1 = await getSvc().startNewCampaign();
    const campaign2 = await getSvc().startNewCampaign();
    expect(campaign1.id).not.toBe(campaign2.id);
    await getSvc().refreshCampaigns();
    expect(getSvc().campaigns.length).toBe(2);
    expect(getSvc().campaigns.find((c) => c.id === campaign1.id)).toBeDefined();
    expect(getSvc().campaigns.find((c) => c.id === campaign2.id)).toBeDefined();
  });

  // ── C-345 contentPackId ───────────────────────────────────────────────

  test('startNewCampaign defaults to emberwatch when no contentPackId provided', async () => {
    const campaign = await getSvc().startNewCampaign();
    expect(campaign.contentPackId).toBe('emberwatch');
  });

  test('startNewCampaign accepts custom contentPackId', async () => {
    const campaign = await getSvc().startNewCampaign({ contentPackId: 'whispering-caves' });
    expect(campaign.contentPackId).toBe('whispering-caves');
  });

  test.todo('startNewCampaign rejects unknown contentPackId (not in registry)');
  test.todo('loadCampaign preserves contentPackId from stored campaign');
});
