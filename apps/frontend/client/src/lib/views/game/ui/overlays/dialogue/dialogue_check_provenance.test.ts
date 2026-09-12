// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_check_provenance.test.ts
//
// Unit tests for skill-check provenance helpers — the mapping from a decided
// check to durable operation-ledger calls (design §8).

import { describe, expect, mock, test } from 'bun:test';
import type { BeginGameOperationOptions, GameOperation } from '@aikami/types';
import {
  beginSkillCheckOperation,
  completeSkillCheckOperation,
  type DialogueOperationCapabilities,
  failSkillCheckOperation,
  type SkillCheckProvenance,
} from './dialogue_check_provenance.ts';

const check: SkillCheckProvenance = {
  checkId: 'check-1',
  checkType: 'Persuasion',
  difficultyClass: 12,
  natural: 17,
  total: 20,
  isSuccess: true,
};

const createOperations = () => {
  const begin = mock(
    async (options: BeginGameOperationOptions): Promise<GameOperation> => ({
      schemaVersion: 1,
      operationId: 'op-1',
      kind: options.kind,
      status: 'pending',
      campaignId: options.campaignId,
      conversationId: options.conversationId,
      checkId: options.checkId,
      request: JSON.stringify(options.request ?? {}),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  const complete = mock(async () => {});
  const fail = mock(async () => {});
  const operations: DialogueOperationCapabilities = { begin, complete, fail };
  return { operations, begin, complete, fail };
};

describe('beginSkillCheckOperation', () => {
  test('maps the check onto a pending skill_check operation', async () => {
    const { operations, begin } = createOperations();

    const operationId = await beginSkillCheckOperation({
      operations,
      campaignId: 'camp-1',
      conversationId: 'npc-1',
      check,
    });

    expect(operationId).toBe('op-1');
    expect(begin).toHaveBeenCalledWith({
      kind: 'skill_check',
      campaignId: 'camp-1',
      conversationId: 'npc-1',
      checkId: 'check-1',
      request: check,
    });
  });

  test('skips provenance without a campaign (dev sandbox)', async () => {
    const { operations, begin } = createOperations();

    const operationId = await beginSkillCheckOperation({
      operations,
      campaignId: undefined,
      conversationId: 'npc-1',
      check,
    });

    expect(operationId).toBeUndefined();
    expect(begin).not.toHaveBeenCalled();
  });
});

describe('completeSkillCheckOperation', () => {
  test('passes the authoritative roll to the ledger', async () => {
    const { operations, complete } = createOperations();

    await completeSkillCheckOperation({ operations, operationId: 'op-1', check });

    expect(complete).toHaveBeenCalledWith('op-1', check);
  });

  test('is a no-op without an operation id', async () => {
    const { operations, complete } = createOperations();

    await completeSkillCheckOperation({ operations, operationId: undefined, check });

    expect(complete).not.toHaveBeenCalled();
  });
});

describe('failSkillCheckOperation', () => {
  test('records the reason', async () => {
    const { operations, fail } = createOperations();

    await failSkillCheckOperation({ operations, operationId: 'op-1', error: 'timeout' });

    expect(fail).toHaveBeenCalledWith('op-1', 'timeout');
  });

  test('is a no-op without an operation id', async () => {
    const { operations, fail } = createOperations();

    await failSkillCheckOperation({ operations, operationId: undefined, error: 'timeout' });

    expect(fail).not.toHaveBeenCalled();
  });
});
