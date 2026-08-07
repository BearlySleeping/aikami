// apps/frontend/client/src/lib/services/expression/expression_service.test.ts
//
// Regression tests for Tier 1 agent-based expression detection:
// unrecognized freeform mood labels (e.g. "very happy") must NOT produce a
// successful neutral result that suppresses Tier 2 keyword detection.
//
// Contract: C-239 Expression Emotion System
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock textGenerationService ($services)
// ---------------------------------------------------------------------------

let extractStructureImpl: () => Promise<unknown>;

mock.module('$services', () => ({
  textGenerationService: {
    extractStructure: mock(async () => extractStructureImpl()),
  },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const { expressionService } = await import('./expression_service.svelte');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExpressionService — agent detection fallback', () => {
  beforeEach(() => {
    extractStructureImpl = async () => ({
      characters: [{ name: 'speaker', expression: 'happy' }],
    });
  });

  test('recognized agent moods use the agent tier', async () => {
    const result = await expressionService.detectExpression({
      message: 'The hero smiles.',
      characters: ['speaker'],
    });

    expect(result.detectionTier).toBe('agent');
    expect(result.expressionMap.speaker).toBe('happy');
  });

  test('unrecognized multi-word mood falls back to keyword detection', async () => {
    // The agent returns a freeform label not in the mood map.
    extractStructureImpl = async () => ({
      characters: [{ name: 'speaker', expression: 'very happy' }],
    });

    const result = await expressionService.detectExpression({
      message: 'She smiles warmly at the hero.',
      characters: ['speaker'],
    });

    // Must NOT be a successful neutral agent result — keyword detection runs.
    expect(result.detectionTier).toBe('keyword');
    // "smiles" matches the happy keyword pattern.
    expect(result.expressionMap.speaker).toBe('happy');
  });

  test('unrecognized single-word label also falls back to keyword detection', async () => {
    extractStructureImpl = async () => ({
      characters: [{ name: 'speaker', expression: 'ecstatic' }],
    });

    const result = await expressionService.detectExpression({
      message: 'He weeps softly, tears streaming down his face.',
      characters: ['speaker'],
    });

    expect(result.detectionTier).toBe('keyword');
    expect(result.expressionMap.speaker).toBe('sad');
  });
});
