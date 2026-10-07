// apps/frontend/client/src/lib/services/game/game_boot_campaign_publication.test.ts
//
// Boot ↔ campaign publication collaboration.
//
// Regression under test (real Playwright failure): after a successful manual
// save, an actual `page.reload()` showed "Not Saved Yet" in the pause overlay
// even though the campaign JSON in local storage still carried `lastSavedAt`
// and `lastSaveSlotId`. Cause: `_stageLoadCampaign` resolved the campaign into
// the boot service's PRIVATE `_campaign` slot and never published it, so
// `campaignService.activeCampaign` — the identity every consumer reads
// (overlay label, NPC memory scope, save linkage) — stayed undefined or stale
// after a reload, a "continue latest" pick, or an explicit campaignId.
//
// These tests drive the real GameBootService and the real CampaignService
// against a real in-memory database. The only seam is a gate on the one
// campaign write the stale-generation test needs to interleave — installed at
// the database seam (the boot pipeline reaches storage through a dynamically
// imported module instance, so a module-level mock would not be observed).

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SqlQuery } from '@aikami/frontend/storage';
import type { Campaign } from '@aikami/types';
import { createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

// ---------------------------------------------------------------------------
// Narrow DI: a real database plus one gated campaign write
// ---------------------------------------------------------------------------

const fixture = await createRealLocalDatabase();

/** Parks the first campaign write the stale-generation boot attempt makes. */
type WriteGate = {
  campaignId: string;
  /** Resolves once the boot attempt has entered the gated write. */
  onArrive: () => void;
  /** Resolves when the test lets the write finish. */
  released: Promise<void>;
};

let _gate: WriteGate | undefined;

/**
 * Holds the `failed → loading` campaign write of the gated campaign so the
 * test can start a second, newer boot while the first is still in flight.
 */
const awaitGate = async (queries: readonly SqlQuery[]): Promise<void> => {
  const gate = _gate;
  if (!gate) {
    return;
  }
  const idFragment = `"id":"${gate.campaignId}"`;
  const isGatedWrite = queries.some((query) =>
    query.args.some(
      (arg) =>
        typeof arg === 'string' && arg.includes(idFragment) && arg.includes('"state":"loading"'),
    ),
  );
  if (!isGatedWrite) {
    return;
  }
  _gate = undefined;
  gate.onArrive();
  await gate.released;
};

const gatedDatabase = {
  query: (options: SqlQuery) => fixture.db.query(options),
  execute: async (options: SqlQuery): Promise<void> => {
    await awaitGate([options]);
    await fixture.db.execute(options);
  },
  transaction: async (queries: readonly SqlQuery[]) => {
    await awaitGate(queries);
    return fixture.db.transaction(queries);
  },
  flush: () => fixture.db.flush?.() ?? Promise.resolve(),
};

const realFrontendStorage = await import('@aikami/frontend/storage');

mock.module('@aikami/frontend/storage', () => ({
  ...realFrontendStorage,
  getLocalDatabase: async () => gatedDatabase,
}));

// Local text provider configured so the capability gate never blocks.
mock.module('../config/config_service.svelte.ts', () => ({
  configService: {
    state: {
      get connections() {
        return [
          { capability: 'text', provider: 'ollama', apiKey: '', baseUrl: '', model: 'llama3' },
        ];
      },
    },
  },
}));

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

const realCampaignStorage = await import('../campaign/campaign_storage.svelte.ts');

const { campaignService } = await import('../campaign/campaign_service.svelte.ts');
const { gameBootService } = await import('./game_boot_service.svelte.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAVED_AT = '2026-02-03T10:11:12.000Z';

/** Writes a campaign row straight into storage, as a prior session left it. */
const persistCampaign = async (options: {
  id: string;
  state: Campaign['state'];
  updatedAt: string;
  lastSavedAt?: string;
  lastSaveSlotId?: string;
}): Promise<void> => {
  const campaign: Campaign = {
    id: options.id,
    name: options.id,
    state: options.state,
    contentPackId: 'emberwatch',
    seed: 42,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: options.updatedAt,
    ...(options.lastSavedAt ? { lastSavedAt: options.lastSavedAt } : {}),
    ...(options.lastSaveSlotId ? { lastSaveSlotId: options.lastSaveSlotId } : {}),
    capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
  };
  await realCampaignStorage.campaignStorage.create(campaign);
};

const createMockInput = (overrides?: {
  campaignId?: string;
}): {
  contentPackId: string;
  canvas: HTMLCanvasElement;
  campaignId?: string;
} => ({
  contentPackId: 'emberwatch',
  canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
  ...overrides,
});

/** The identity the overlay label, NPC scope and save linkage all read. */
const activeCampaign = (): Campaign | undefined => campaignService.activeCampaign;

beforeEach(async () => {
  _gate = undefined;
  await fixture.reset();
  gameBootService.teardown();
  campaignService.activeCampaign = undefined;
  campaignService.campaigns = [];
});

afterAll(async () => {
  await fixture.close();
});

// ---------------------------------------------------------------------------
// Publication of the resolved campaign
// ---------------------------------------------------------------------------

describe('GameBootService — resolved campaign publication', () => {
  test('a fresh boot with no stored campaign publishes the default campaign', async () => {
    await gameBootService.boot(createMockInput());

    // ensureDefaultCampaign used to be the ONLY path that published; it must
    // keep working now that boot adopts explicitly.
    expect(activeCampaign()?.id).toBe('default-emberwatch');
  });

  test('reload onto the persisted latest campaign publishes its saved identity', async () => {
    await persistCampaign({
      id: 'default-emberwatch',
      state: 'playing',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    await persistCampaign({
      id: 'campaign-latest',
      state: 'playing',
      updatedAt: '2026-02-03T00:00:00.000Z',
      lastSavedAt: SAVED_AT,
      lastSaveSlotId: 'manual-save-1',
    });
    // What the app does on start-up before booting.
    await campaignService.refreshCampaigns();

    await gameBootService.boot(createMockInput());

    // Without publication this stayed undefined → overlay rendered
    // "Not Saved Yet" for a campaign that was demonstrably saved.
    expect(activeCampaign()?.id).toBe('campaign-latest');
    expect(activeCampaign()?.lastSavedAt).toBe(SAVED_AT);
    expect(activeCampaign()?.lastSaveSlotId).toBe('manual-save-1');
    expect(activeCampaign()?.lastSavedAt).not.toBeUndefined();
  });

  test('an explicitly selected non-default campaign is published, not the latest one', async () => {
    await persistCampaign({
      id: 'campaign-latest',
      state: 'playing',
      updatedAt: '2026-02-03T00:00:00.000Z',
      lastSavedAt: SAVED_AT,
      lastSaveSlotId: 'manual-save-1',
    });
    await persistCampaign({
      id: 'campaign-picked',
      state: 'paused',
      updatedAt: '2026-02-01T00:00:00.000Z',
      lastSavedAt: '2026-02-01T12:00:00.000Z',
      lastSaveSlotId: 'auto-save',
    });
    await campaignService.refreshCampaigns();

    await gameBootService.boot(createMockInput({ campaignId: 'campaign-picked' }));

    // Explicit selection wins; the newest record must not hijack the identity.
    expect(activeCampaign()?.id).toBe('campaign-picked');
    expect(activeCampaign()?.lastSaveSlotId).toBe('auto-save');
    // A paused campaign has no legal LOAD_REQUESTED, so boot adopts it
    // untouched rather than clobbering its state.
    expect(activeCampaign()?.state).toBe('paused');
  });

  test('a later boot failure leaves the published campaign in place', async () => {
    await persistCampaign({
      id: 'campaign-latest',
      state: 'playing',
      updatedAt: '2026-02-03T00:00:00.000Z',
      lastSavedAt: SAVED_AT,
      lastSaveSlotId: 'manual-save-1',
    });
    await campaignService.refreshCampaigns();

    // The mock canvas makes the boot fail at creating_engine — after the
    // campaign has been resolved.
    const result = await gameBootService.boot(createMockInput());
    expect(result.outcome).toBe('failed');

    expect(activeCampaign()?.id).toBe('campaign-latest');
    expect(activeCampaign()?.lastSavedAt).toBe(SAVED_AT);
  });

  test('the published record is the one the persisted save slot points at', async () => {
    await persistCampaign({
      id: 'campaign-latest',
      state: 'playing',
      updatedAt: '2026-02-03T00:00:00.000Z',
      lastSavedAt: SAVED_AT,
      lastSaveSlotId: 'manual-save-1',
    });
    await campaignService.refreshCampaigns();
    await gameBootService.boot(createMockInput());

    // `_stageValidateSave` looks the slot up on the boot's own campaign; the
    // published record must name the same slot or a restore would silently
    // target a different save.
    const stored = await realCampaignStorage.campaignStorage.getById('campaign-latest');
    expect(stored?.lastSaveSlotId).toBe(activeCampaign()?.lastSaveSlotId);
  });
});

// ---------------------------------------------------------------------------
// Generation guard: a superseded boot must not steal the active campaign
// ---------------------------------------------------------------------------

describe('GameBootService — stale boot generation cannot overwrite the active campaign', () => {
  test('a late resolve from a superseded boot leaves the newer campaign published', async () => {
    await persistCampaign({
      id: 'campaign-newer',
      state: 'playing',
      updatedAt: '2026-02-04T00:00:00.000Z',
      lastSavedAt: '2026-02-04T00:00:00.000Z',
      lastSaveSlotId: 'auto-save',
    });
    await persistCampaign({
      id: 'campaign-stale',
      state: 'failed',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });

    // Hold the stale boot inside its failed → loading transition.
    let markArrived = (): void => {};
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    _gate = { campaignId: 'campaign-stale', onArrive: markArrived, released };

    // Boot #1 selects the stale campaign and parks on the gated update.
    const staleBoot = gameBootService.boot(createMockInput({ campaignId: 'campaign-stale' }));
    await arrived;

    // The user navigates away and a new boot starts for the newer campaign.
    gameBootService.resetForRetry();
    await campaignService.refreshCampaigns();
    await gameBootService.boot(createMockInput());

    expect(activeCampaign()?.id).toBe('campaign-newer');

    // Boot #1 finally resumes: its generation is stale, so it must not
    // republish 'campaign-stale' over the newer identity.
    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(activeCampaign()?.id).toBe('campaign-newer');
    expect(activeCampaign()?.lastSaveSlotId).toBe('auto-save');

    // A superseded stage promise never settles by design; nothing is left to
    // reject, so the boot is simply abandoned.
    staleBoot.catch(() => {});
    gameBootService.teardown();
  });
});
