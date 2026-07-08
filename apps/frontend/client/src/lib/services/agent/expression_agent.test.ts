// apps/frontend/client/src/lib/services/agent/expression_agent.test.ts
//
// Unit tests for the expression agent schema validation.
// Uses manual structural validation matching the ViewModel approach.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';

const VALID_MOODS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'fearful',
  'disgusted',
] as const;

describe('Expression validation', () => {
  const isValid = (input: unknown): boolean => {
    if (typeof input !== 'object' || input === null) {
      return false;
    }
    const data = input as Record<string, unknown>;
    if (typeof data.npcName !== 'string') {
      return false;
    }
    if (!VALID_MOODS.includes(data.currentMood as (typeof VALID_MOODS)[number])) {
      return false;
    }
    if (typeof data.intensity !== 'number' || data.intensity < 0 || data.intensity > 1) {
      return false;
    }
    if (typeof data.expressionLabel !== 'string') {
      return false;
    }
    if (typeof data.reason !== 'string') {
      return false;
    }
    return true;
  };

  it('should validate a complete expression output', () => {
    const input = {
      npcName: 'Elara',
      currentMood: 'happy',
      intensity: 0.8,
      expressionLabel: 'warm_smile',
      reason: 'Player complimented her magic skills',
    };

    expect(isValid(input)).toBe(true);
  });

  it('should reject invalid mood values', () => {
    const input = {
      npcName: 'Thorn',
      currentMood: 'bored',
      intensity: 0.3,
      expressionLabel: 'blank',
      reason: 'Nothing happening',
    };

    expect(isValid(input)).toBe(false);
  });

  it('should reject intensity outside 0-1 range', () => {
    const input = {
      npcName: 'Elara',
      currentMood: 'angry',
      intensity: 1.5,
      expressionLabel: 'furious',
      reason: 'Player insulted her',
    };

    expect(isValid(input)).toBe(false);
  });

  it('should validate boundary intensity values', () => {
    expect(
      isValid({
        npcName: 'Elara',
        currentMood: 'neutral',
        intensity: 0,
        expressionLabel: 'blank',
        reason: 'Completely neutral',
      }),
    ).toBe(true);

    expect(
      isValid({
        npcName: 'Thorn',
        currentMood: 'angry',
        intensity: 1,
        expressionLabel: 'enraged',
        reason: 'Maximum anger',
      }),
    ).toBe(true);
  });
});
