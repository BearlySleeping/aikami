// apps/frontend/client/src/lib/views/dev/save_load/save_load_view_model.test.ts
//
// SaveLoadViewModel — signed-in gating and save/load/delete delegation through
// explicit capability fixtures.
//
// Contract: cloud save/load pipeline

import { describe, expect, mock, test } from 'bun:test';
import type { SaveSlotEntry } from '@aikami/types';
import {
  createSaveLoadViewModel,
  type GameStateSyncCapabilities,
  type SaveLoadAuthCapabilities,
} from './save_load_view_model.svelte.ts';

const SLOT: SaveSlotEntry = {
  slotNumber: 1,
  lastLocationName: 'Test Location',
  playedTimeSeconds: null,
  storageRef: 'saves/test-uid/slot_1.json',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

const createHarness = (signedIn: boolean) => {
  const auth = {
    uid: signedIn ? 'test-uid' : undefined,
    initialize: mock(async () => undefined),
  } satisfies SaveLoadAuthCapabilities;

  const listSlots = mock(async () => [SLOT]);
  const saveGame = mock(async (_options: { uid: string; slot: number; payload: string }) => 'ref');
  const loadGame = mock(async (_options: { uid: string; slot: number }) => '{"entities":[]}');
  const deleteSlot = mock(async (_options: { uid: string; slot: number }) => {});
  const sync = { listSlots, saveGame, loadGame, deleteSlot } satisfies GameStateSyncCapabilities;

  const viewModel = createSaveLoadViewModel({ className: 'SaveLoadViewModel', auth, sync });
  return { viewModel, listSlots, saveGame, loadGame, deleteSlot };
};

describe('SaveLoadViewModel — auth gating', () => {
  test('uid proxies the auth capability', () => {
    const { viewModel } = createHarness(true);
    expect(viewModel.uid).toBe('test-uid');
  });

  test('loadSlots refuses when signed out', async () => {
    const { viewModel, listSlots } = createHarness(false);
    await viewModel.loadSlots();

    expect(listSlots).not.toHaveBeenCalled();
    expect(viewModel.slots).toEqual([]);
    expect(viewModel.message).toContain('Not signed in');
  });

  test('loadSlots lists slots when signed in', async () => {
    const { viewModel, listSlots } = createHarness(true);
    await viewModel.loadSlots();

    expect(listSlots).toHaveBeenCalledWith({ uid: 'test-uid' });
    expect(viewModel.slots).toEqual([SLOT]);
  });
});

describe('SaveLoadViewModel — operations', () => {
  test('saveSlot delegates to the sync capability', async () => {
    const { viewModel, saveGame, listSlots } = createHarness(true);
    viewModel.payload = '{"entities":[1]}';

    await viewModel.saveSlot();

    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(listSlots).toHaveBeenCalledTimes(1);
    expect(viewModel.message).toContain('Saved to slot 1');
  });

  test('saveSlot refuses an empty payload', async () => {
    const { viewModel, saveGame } = createHarness(true);
    viewModel.payload = '   ';

    await viewModel.saveSlot();

    expect(saveGame).not.toHaveBeenCalled();
    expect(viewModel.message).toBe('Payload is empty.');
  });

  test('loadSlot surfaces the loaded payload', async () => {
    const { viewModel, loadGame } = createHarness(true);
    await viewModel.loadSlot();

    expect(loadGame).toHaveBeenCalledWith({ uid: 'test-uid', slot: 1 });
    expect(viewModel.loadedPayload).toBe('{"entities":[]}');
  });

  test('deleteSlot delegates and refreshes', async () => {
    const { viewModel, deleteSlot, listSlots } = createHarness(true);
    await viewModel.deleteSlot();

    expect(deleteSlot).toHaveBeenCalledWith({ uid: 'test-uid', slot: 1 });
    expect(listSlots).toHaveBeenCalledTimes(1);
  });
});
