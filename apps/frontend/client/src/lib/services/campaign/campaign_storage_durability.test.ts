// apps/frontend/client/src/lib/services/campaign/campaign_storage_durability.test.ts
//
// Durability contract for campaign writes.
//
// The browser adapter (WasmStorageAdapter, `persistMode: 'idb-snapshot'`) batches
// writes into a debounced IndexedDB snapshot. `LocalDatabaseInterface.flush()`
// cancels that debounce and awaits the durable snapshot. A campaign write that
// resolves without flushing leaves the SQL row in memory only: the pause
// overlay reports "Game Saved" with a fresh timestamp, and the next page load
// restores the older snapshot — the exact production symptom where
// `lastSavedAt` / `lastSaveSlotId` disappear across a reload.
//
// These tests use a controlled fake database (not the real one) because the
// point is ORDERING: the write must not be reported as complete before the
// flush settles, and a failed flush must fail the write rather than be
// swallowed.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';
import type { Campaign } from '@aikami/types';

const realStorage = await import('@aikami/frontend/storage');

/** Ordered log of every database interaction, so tests can assert sequencing. */
let _calls: string[] = [];

const makeCampaign = (overrides?: Partial<Campaign>): Campaign => ({
  id: 'campaign-durable',
  name: 'Durable',
  state: 'playing',
  contentPackId: 'emberwatch',
  seed: 11,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
  lastSavedAt: '2026-03-02T00:00:00.000Z',
  lastSaveSlotId: 'manual-1',
  capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
  ...overrides,
});

/** The flush stub every test drives: it stays pending until settled or failed. */
type FlushControl = {
  readonly calls: number;
  settle: () => void;
  fail: (error: Error) => void;
};

let _flush: FlushControl | undefined;

const flushGate = (): { flush: () => Promise<void>; control: FlushControl } => {
  let settleFlush: (() => void) | undefined;
  let failFlush: ((error: Error) => void) | undefined;
  const released = new Promise<void>((resolve, reject) => {
    settleFlush = resolve;
    failFlush = reject;
  });
  const counter = { calls: 0 };
  return {
    control: {
      get calls() {
        return counter.calls;
      },
      settle: () => settleFlush?.(),
      fail: (error: Error) => failFlush?.(error),
    },
    flush: async () => {
      counter.calls++;
      _calls.push('flush:start');
      await released;
      _calls.push('flush:end');
    },
  };
};

/** Builds a fake database whose writes always "find" the campaign row. */
const makeDatabase = (options: { withFlush: boolean }): LocalDatabaseInterface => {
  const gated = options.withFlush ? flushGate() : undefined;
  _flush = gated?.control;
  return {
    query: async () => {
      _calls.push('query');
      // The post-transaction existence check must report the row as present.
      return { rows: [{ id: 'campaign-durable' }] };
    },
    execute: async () => {
      _calls.push('execute');
    },
    transaction: async () => {
      _calls.push('transaction');
      return undefined;
    },
    ...(gated ? { flush: gated.flush } : {}),
  } as unknown as LocalDatabaseInterface;
};

let _database: LocalDatabaseInterface;

mock.module('@aikami/frontend/storage', () => ({
  ...realStorage,
  getLocalDatabase: async () => _database,
}));

const { campaignStorage } = await import('./campaign_storage.svelte.ts');

/** Whether a promise has already settled, without awaiting it. */
const isSettled = async (promise: Promise<unknown>): Promise<boolean> => {
  const pending = Symbol('pending');
  const raced = await Promise.race([promise.then(() => 'settled'), Promise.resolve(pending)]);
  return raced === 'settled';
};

/** Yields until the write has reached the flush, or the budget runs out. */
const waitForFlushStart = async (): Promise<void> => {
  for (let i = 0; i < 50 && !_calls.includes('flush:start'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  _calls = [];
  _flush = undefined;
  _database = makeDatabase({ withFlush: true });
});

describe('CampaignStorage durability', () => {
  test('update does not resolve before the snapshot flush settles', async () => {
    const update = campaignStorage.update(makeCampaign());
    update.catch(() => {});
    await waitForFlushStart();

    // The SQL write happens first, then the flush is awaited.
    expect(_calls).toEqual(['transaction', 'query', 'flush:start']);
    expect(await isSettled(update)).toBe(false);
    expect(_flush?.calls).toBe(1);

    _flush?.settle();
    await expect(update).resolves.toMatchObject({ id: 'campaign-durable' });
    expect(_calls.at(-1)).toBe('flush:end');
  });

  test('create does not resolve before the snapshot flush settles', async () => {
    const create = campaignStorage.create(makeCampaign());
    create.catch(() => {});
    await waitForFlushStart();

    expect(_calls).toEqual(['execute', 'flush:start']);
    expect(await isSettled(create)).toBe(false);

    _flush?.settle();
    await expect(create).resolves.toMatchObject({ id: 'campaign-durable' });
  });

  test('a rejected flush fails the update instead of reporting a completed save', async () => {
    const update = campaignStorage.update(makeCampaign());
    _flush?.fail(new Error('snapshot write failed'));

    await expect(update).rejects.toThrow('snapshot write failed');
  });

  test('a rejected flush fails the create as well', async () => {
    const create = campaignStorage.create(makeCampaign());
    _flush?.fail(new Error('snapshot write failed'));

    await expect(create).rejects.toThrow('snapshot write failed');
  });

  test('an adapter without a flush still writes (OPFS / in-memory adapters)', async () => {
    _database = makeDatabase({ withFlush: false });

    await expect(campaignStorage.update(makeCampaign())).resolves.toMatchObject({
      id: 'campaign-durable',
    });
    await expect(campaignStorage.create(makeCampaign())).resolves.toMatchObject({
      id: 'campaign-durable',
    });
    expect(_calls.filter((call) => call.startsWith('flush'))).toHaveLength(0);
  });

  test('a missing campaign row still throws before any flush is attempted', async () => {
    _database = {
      query: async () => ({ rows: [] }),
      execute: async () => {},
      transaction: async () => undefined,
      flush: async () => {
        throw new Error('flush must not run for a missing campaign');
      },
    } as unknown as LocalDatabaseInterface;

    await expect(campaignStorage.update(makeCampaign())).rejects.toThrow('Campaign not found');
  });
});
