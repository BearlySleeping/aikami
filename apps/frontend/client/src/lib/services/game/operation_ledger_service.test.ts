// apps/frontend/client/src/lib/services/game/operation_ledger_service.test.ts
//
// Real-adapter contract tests for the durable operation ledger. The service is
// constructed with a repository over a real in-memory WASM libSQL database
// (production migration v6 applied), so pending→completed/interrupted
// transitions and recovery are observed exactly as on the player device.
//
// Contract: docs/design/game_ui_hud_overhaul.md §8 — operation provenance

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigrations } from '@aikami/frontend/storage/migrations';
import { createGameOperationRepository } from '@aikami/frontend/storage/operations';
import { WasmStorageAdapter } from '@aikami/frontend/storage/wasm_storage_adapter';
import {
  OperationLedgerService,
  type OperationLedgerServiceInterface,
} from './operation_ledger_service.svelte.ts';

// ── Real in-memory database with production schema ─────────────────────

const adapter = new WasmStorageAdapter({ databasePath: ':memory:' });
await adapter.open();
await applyMigrations(adapter);

const repository = createGameOperationRepository(adapter);

const createService = (): OperationLedgerServiceInterface =>
  OperationLedgerService.create({
    className: 'OperationLedgerServiceTest',
    repository,
  });

beforeEach(async () => {
  await adapter.execute({ sql: 'DELETE FROM game_operations', args: [] });
});

afterAll(async () => {
  await adapter.close();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('OperationLedgerService — provenance', () => {
  test('begin records a pending operation with its references', async () => {
    const service = createService();

    const operation = await service.begin({
      kind: 'skill_check',
      campaignId: 'camp-1',
      conversationId: 'mira',
      checkId: 'check-1',
      request: { difficultyClass: 12 },
    });

    expect(operation.status).toBe('pending');
    expect(operation.operationId).toBeTruthy();

    const stored = await service.get(operation.operationId);
    expect(stored).toMatchObject({
      kind: 'skill_check',
      status: 'pending',
      campaignId: 'camp-1',
      conversationId: 'mira',
      checkId: 'check-1',
    });
    expect(JSON.parse(stored?.request ?? '{}')).toEqual({ difficultyClass: 12 });
  });

  test('complete records the authoritative result', async () => {
    const service = createService();
    const operation = await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });

    await service.complete(operation.operationId, { outcome: 'pass', natural: 17 });

    const stored = await service.get(operation.operationId);
    expect(stored?.status).toBe('completed');
    expect(JSON.parse(stored?.result ?? '{}')).toEqual({ outcome: 'pass', natural: 17 });
  });

  test('fail records the reason', async () => {
    const service = createService();
    const operation = await service.begin({ kind: 'dialogue_turn', campaignId: 'camp-1' });

    await service.fail(operation.operationId, 'provider unavailable');

    const stored = await service.get(operation.operationId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('provider unavailable');
  });

  test('listPending scopes to a campaign', async () => {
    const service = createService();
    await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });
    await service.begin({ kind: 'skill_check', campaignId: 'camp-2' });

    expect(await service.listPending()).toHaveLength(2);
    expect(await service.listPending('camp-1')).toHaveLength(1);
  });
});

describe('OperationLedgerService — interrupted-operation recovery', () => {
  test('reconcileInterrupted flips stale pending rows and surfaces them', async () => {
    const service = createService();
    const finished = await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });
    const interrupted = await service.begin({ kind: 'dialogue_turn', campaignId: 'camp-1' });
    await service.complete(finished.operationId, { outcome: 'pass' });

    const reconciled = await service.reconcileInterrupted();

    expect(reconciled.map((operation) => operation.operationId)).toEqual([interrupted.operationId]);
    expect((await service.get(interrupted.operationId))?.status).toBe('interrupted');
    expect(service.interruptedOperations).toHaveLength(1);
    expect(service.interruptedOperations[0]?.operationId).toBe(interrupted.operationId);
    // A completed row is never touched by reconciliation.
    expect((await service.get(finished.operationId))?.status).toBe('completed');
  });

  test('a late completion cannot overwrite a recovered interruption', async () => {
    const service = createService();
    const operation = await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });
    await service.reconcileInterrupted();

    await service.complete(operation.operationId, { outcome: 'pass' });

    const stored = await service.get(operation.operationId);
    expect(stored?.status).toBe('interrupted');
    expect(stored?.result).toBeUndefined();
  });

  test('reconcileInterrupted is idempotent once nothing is pending', async () => {
    const service = createService();
    await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });

    await service.reconcileInterrupted();
    const second = await service.reconcileInterrupted();

    expect(second).toHaveLength(0);
  });

  test('dismissInterrupted clears a recovered operation from state', async () => {
    const service = createService();
    const operation = await service.begin({ kind: 'skill_check', campaignId: 'camp-1' });
    await service.reconcileInterrupted();

    service.dismissInterrupted(operation.operationId);

    expect(service.interruptedOperations).toHaveLength(0);
  });
});
