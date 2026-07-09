// apps/frontend/client/src/lib/services/expression/expression_persistence.test.ts
//
// Unit tests for expression persistence on EnhancedMessage alternatives.
// Verifies expressionMap is stored per alternative and restored on swipe.
//
// Contract: C-239 Expression Emotion System

import { beforeEach, describe, expect, test } from 'bun:test';
import type { ExpressionMap } from '$types/expression';
import { messageBranchStore } from '../chat/message_branch_store.svelte.ts';

// ── Helpers ──────────────────────────────────────────────────────────────

const MESSAGE_ID = 'expr-msg-001';

const cleanupBranch = () => {
  messageBranchStore.clearAlternatives(MESSAGE_ID);
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('Expression persistence — per-alternative storage', () => {
  beforeEach(() => {
    cleanupBranch();
  });

  test('setExpressionMap stores expression map for a message', () => {
    const expressionMap: ExpressionMap = { Elara: 'happy' };
    messageBranchStore.setExpressionMap({ messageId: MESSAGE_ID, expressionMap });

    const retrieved = messageBranchStore.getExpressionMap(MESSAGE_ID);
    expect(retrieved).toEqual(expressionMap);
  });

  test('getExpressionMap returns undefined for unknown message', () => {
    const retrieved = messageBranchStore.getExpressionMap('nonexistent');
    expect(retrieved).toBeUndefined();
  });

  test('setExpressionMap updates existing expression map', () => {
    messageBranchStore.setExpressionMap({
      messageId: MESSAGE_ID,
      expressionMap: { Elara: 'happy' },
    });

    messageBranchStore.setExpressionMap({
      messageId: MESSAGE_ID,
      expressionMap: { Elara: 'angry' },
    });

    const retrieved = messageBranchStore.getExpressionMap(MESSAGE_ID);
    expect(retrieved).toEqual({ Elara: 'angry' });
  });

  test('expressionMap is preserved when adding alternatives', () => {
    const expressionMap: ExpressionMap = { Elara: 'happy' };
    messageBranchStore.setExpressionMap({ messageId: MESSAGE_ID, expressionMap });

    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    // Expression map should still be accessible
    const retrieved = messageBranchStore.getExpressionMap(MESSAGE_ID);
    expect(retrieved).toEqual(expressionMap);
  });

  test('clearAlternatives also clears expression map', () => {
    messageBranchStore.setExpressionMap({
      messageId: MESSAGE_ID,
      expressionMap: { Elara: 'happy' },
    });

    messageBranchStore.clearAlternatives(MESSAGE_ID);

    const retrieved = messageBranchStore.getExpressionMap(MESSAGE_ID);
    expect(retrieved).toBeUndefined();
  });

  test('expression map handles multi-character expressions', () => {
    const expressionMap: ExpressionMap = {
      Elara: 'happy',
      Thorn: 'angry',
      Lyra: 'surprised',
    };
    messageBranchStore.setExpressionMap({ messageId: MESSAGE_ID, expressionMap });

    const retrieved = messageBranchStore.getExpressionMap(MESSAGE_ID);
    expect(retrieved).toEqual(expressionMap);
  });
});
