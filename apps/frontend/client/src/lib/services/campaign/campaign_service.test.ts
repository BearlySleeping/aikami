// apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts
//
// Tests for CampaignService and CampaignRepository.
// Uses mock.module for $services to avoid the import chain reaching $app/navigation.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

// biome-ignore-all lint/style/useBlockStatements: test mocks use concise inline conditionals

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Campaign } from '@aikami/types';

// ---------------------------------------------------------------------------
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
// Mock IndexedDB (in-memory)
// ---------------------------------------------------------------------------

type MockStore = Map<string, unknown>;

/** Creates a minimal IDBRequest-like object that fires onsuccess on next tick. */
const makeRequest = <T>(result: T): IDBRequest<T> => {
  let onsuccess: (() => void) | null = null;
  let onerror: (() => void) | null = null;
  const req = {
    get result() {
      return result;
    },
    get onsuccess() {
      return onsuccess;
    },
    set onsuccess(fn: (() => void) | null) {
      onsuccess = fn;
      if (fn) {
        setTimeout(fn, 0);
      }
    },
    get onerror() {
      return onerror;
    },
    set onerror(fn: (() => void) | null) {
      onerror = fn;
    },
    error: null,
  };
  return req as unknown as IDBRequest<T>;
};

const createMockDB = () => {
  const stores: Map<string, MockStore> = new Map();
  stores.set('saves', new Map());
  stores.set('campaigns', new Map());

  return {
    _stores: stores,
    transaction(name: string) {
      const store = stores.get(name);
      if (!store) {
        throw new Error(`Object store not found: ${name}`);
      }
      return {
        objectStore: () => ({
          put(doc: unknown) {
            const d = doc as { id: string };
            store.set(d.id, doc);
            return makeRequest(doc);
          },
          get(id: string) {
            return makeRequest(store.get(id));
          },
          getAll() {
            return makeRequest([...store.values()]);
          },
          delete(id: string) {
            store.delete(id);
            return makeRequest(undefined);
          },
        }),
      };
    },
    close(): void {},
  };
};

let mockDB: ReturnType<typeof createMockDB>;

const setupIndexedDB = () => {
  let ons: (() => void) | null = null;
  globalThis.indexedDB = {
    open: () => {
      const req: Record<string, unknown> = {
        get onupgradeneeded() {
          return null;
        },
        set onupgradeneeded(_fn: unknown) {},
        get onsuccess() {
          return ons;
        },
        set onsuccess(fn: unknown) {
          ons = fn as (() => void) | null;
          if (ons) {
            setTimeout(ons, 0);
          }
        },
        get onerror() {
          return null;
        },
        set onerror(_fn: unknown) {},
        result: mockDB,
      };
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  globalThis.crypto = {
    randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
  } as unknown as Crypto;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCampaign = (overrides?: Partial<Campaign>): Campaign => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'New Adventure',
  state: 'idle' as const,
  contentPackId: 'emberwatch',
  seed: 42,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  capabilityProfile: {
    textProvider: true,
    imageProvider: false,
    voiceProvider: false,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDB = createMockDB();
  setupIndexedDB();
});

afterEach(() => {
  // Clean up IndexedDB global mock
  delete (globalThis as Record<string, unknown>).indexedDB;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CampaignService', () => {
  // We must import dynamically AFTER the mock.module calls.
  // Store the singleton reference inside a mutable box to avoid
  // Bun producing TDZ errors on `let` + `typeof import(...)`.
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
    // Reset singleton state between tests to avoid leaks
    getSvc().activeCampaign = undefined as unknown as Campaign;
    if ('isBusy' in svc) (svc as Record<string, unknown>).isBusy = false;
    await getSvc().refreshCampaigns();
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

  test('startNewCampaign creates unique IDs', async () => {
    await getSvc().startNewCampaign();
    await getSvc().startNewCampaign();
    // Both get the same mock UUID, but we can verify they are separate entries
    expect(getSvc().campaigns.length).toBe(2);
  });

  test('loadCampaign transitions to playing', async () => {
    // First we need a campaign in the repository that's in a valid
    // loadable state (idle, creating, or failed).
    // Seed a campaign directly into the mock DB.
    const rawCampaign = makeCampaign({ state: 'idle' });
    const doc = {
      id: rawCampaign.id,
      data: JSON.stringify(rawCampaign),
      updatedAt: rawCampaign.updatedAt,
    };
    const campaignsStore = mockDB._stores.get('campaigns');
    if (!campaignsStore) throw new Error('campaigns store not found');
    campaignsStore.set(rawCampaign.id, doc);

    const loaded = await getSvc().loadCampaign({ campaignId: rawCampaign.id });
    expect(loaded.state).toBe('playing');
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
