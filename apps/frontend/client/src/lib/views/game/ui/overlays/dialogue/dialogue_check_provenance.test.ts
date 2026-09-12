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
  findInterruptedCheck,
  resumeSkillCheckOperation,
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
  const resume = mock(async () => {});
  const fail = mock(async () => {});
  const dismissInterrupted = mock(() => {});
  const interruptedOperations: GameOperation[] = [];
  const operations: DialogueOperationCapabilities = {
    begin,
    complete,
    resume,
    fail,
    interruptedOperations,
    dismissInterrupted,
  };
  return { operations, begin, complete, resume, fail, dismissInterrupted };
};

const interruptedOperation = (overrides: Partial<GameOperation> = {}): GameOperation => ({
  schemaVersion: 1,
  operationId: 'op-interrupted',
  kind: 'skill_check',
  status: 'interrupted',
  campaignId: 'camp-1',
  conversationId: 'npc-1',
  checkId: 'check-1',
  request: JSON.stringify(check),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

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

describe('findInterruptedCheck', () => {
  test('recovers the recorded roll for a matching conversation', () => {
    const { operations } = createOperations();
    operations.interruptedOperations = [interruptedOperation()];

    const recovered = findInterruptedCheck({ operations, conversationId: 'npc-1' });

    expect(recovered).toMatchObject({
      operationId: 'op-interrupted',
      natural: 17,
      difficultyClass: 12,
      isSuccess: true,
    });
  });

  test('ignores other conversations and non-check operations', () => {
    const { operations } = createOperations();
    operations.interruptedOperations = [
      interruptedOperation({ conversationId: 'other-npc' }),
      interruptedOperation({ operationId: 'op-image', kind: 'image_generation' }),
    ];

    expect(findInterruptedCheck({ operations, conversationId: 'npc-1' })).toBeUndefined();
  });

  test('ignores an unparseable request payload', () => {
    const { operations } = createOperations();
    operations.interruptedOperations = [interruptedOperation({ request: 'not-json' })];

    expect(findInterruptedCheck({ operations, conversationId: 'npc-1' })).toBeUndefined();
  });

  test('picks the most recent matching check', () => {
    const { operations } = createOperations();
    operations.interruptedOperations = [
      interruptedOperation({ operationId: 'older', createdAt: '2026-01-01T00:00:00.000Z' }),
      interruptedOperation({ operationId: 'newer', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];

    expect(findInterruptedCheck({ operations, conversationId: 'npc-1' })?.operationId).toBe(
      'newer',
    );
  });
});

describe('resumeSkillCheckOperation', () => {
  test('resumes the recorded operation with the preserved check', async () => {
    const { operations, resume } = createOperations();

    await resumeSkillCheckOperation({ operations, operationId: 'op-interrupted', check });

    expect(resume).toHaveBeenCalledWith('op-interrupted', check);
  });
});
