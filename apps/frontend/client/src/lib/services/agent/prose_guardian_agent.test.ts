// apps/frontend/client/src/lib/services/agent/prose_guardian_agent.test.ts
//
// Unit tests for the prose guardian agent schema validation.
// Uses manual structural validation matching the ViewModel approach.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';

const VALID_ISSUE_TYPES = ['repetition', 'cliche', 'pacing', 'voice', 'formatting'] as const;

describe('ProseGuardian validation', () => {
  const isValid = (input: unknown): boolean => {
    if (typeof input !== 'object' || input === null) {
      return false;
    }
    const data = input as Record<string, unknown>;
    if (typeof data.qualityScore !== 'number' || data.qualityScore < 0 || data.qualityScore > 100) {
      return false;
    }
    if (!Array.isArray(data.issues)) {
      return false;
    }
    if (!Array.isArray(data.styleNotes)) {
      return false;
    }
    for (const issue of data.issues) {
      const i = issue as Record<string, unknown>;
      if (!VALID_ISSUE_TYPES.includes(i.type as (typeof VALID_ISSUE_TYPES)[number])) {
        return false;
      }
      if (typeof i.description !== 'string' || typeof i.suggestion !== 'string') {
        return false;
      }
    }
    return true;
  };

  it('should validate a complete prose evaluation', () => {
    const input = {
      qualityScore: 85,
      issues: [
        {
          type: 'repetition',
          description: 'The word "darkness" appears 5 times',
          suggestion: 'Vary word choice: use "shadows", "gloom", "obscurity"',
        },
      ],
      styleNotes: ['Good use of sensory details', 'Strong pacing in combat scene'],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should validate with optional rewriteSuggestion', () => {
    const input = {
      qualityScore: 55,
      issues: [
        {
          type: 'voice',
          description: 'NPC voice inconsistent',
          suggestion: 'Maintain gruff tone for dwarven blacksmith',
        },
      ],
      styleNotes: ['Dialogue needs stronger character voice'],
      rewriteSuggestion: 'Consider a more concise opening line.',
    };

    expect(isValid(input)).toBe(true);
  });

  it('should reject invalid issue type', () => {
    const input = {
      qualityScore: 70,
      issues: [
        {
          type: 'grammar',
          description: 'Grammar error',
          suggestion: 'Fix it',
        },
      ],
      styleNotes: [],
    };

    expect(isValid(input)).toBe(false);
  });

  it('should reject qualityScore outside 0-100', () => {
    const input = {
      qualityScore: 150,
      issues: [],
      styleNotes: ['Excellent prose'],
    };

    expect(isValid(input)).toBe(false);
  });

  it('should validate boundary quality scores', () => {
    expect(
      isValid({
        qualityScore: 0,
        issues: [],
        styleNotes: [],
      }),
    ).toBe(true);

    expect(
      isValid({
        qualityScore: 100,
        issues: [],
        styleNotes: [],
      }),
    ).toBe(true);
  });
});
