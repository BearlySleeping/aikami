// apps/frontend/client/src/lib/services/agent/quest_tracker_agent.test.ts
//
// Unit tests for the quest tracker agent schema validation.
// Uses manual structural validation matching the ViewModel approach.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';

const VALID_STATUSES = ['active', 'completed', 'failed', 'updated'] as const;

describe('QuestUpdate validation', () => {
  const isValid = (input: unknown): boolean => {
    if (typeof input !== 'object' || input === null) {
      return false;
    }
    const data = input as Record<string, unknown>;
    if (!Array.isArray(data.questUpdates)) {
      return false;
    }
    if (!Array.isArray(data.newQuests)) {
      return false;
    }
    for (const update of data.questUpdates) {
      const u = update as Record<string, unknown>;
      if (typeof u.questId !== 'string') {
        return false;
      }
      if (typeof u.questName !== 'string') {
        return false;
      }
      if (!VALID_STATUSES.includes(u.status as (typeof VALID_STATUSES)[number])) {
        return false;
      }
      if (typeof u.reason !== 'string') {
        return false;
      }
    }
    for (const quest of data.newQuests) {
      const q = quest as Record<string, unknown>;
      if (
        typeof q.name !== 'string' ||
        typeof q.description !== 'string' ||
        typeof q.objective !== 'string'
      ) {
        return false;
      }
    }
    return true;
  };

  it('should validate a complete quest update', () => {
    const input = {
      questUpdates: [
        {
          questId: 'quest-1',
          questName: 'Find the Lost Artifact',
          status: 'completed',
          reason: 'Player found the artifact in the ruins',
        },
      ],
      newQuests: [],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should validate a new quest proposal', () => {
    const input = {
      questUpdates: [],
      newQuests: [
        {
          name: 'Rescue the Blacksmith',
          description: 'The blacksmith has been captured by goblins',
          objective: 'Find and free the blacksmith from the goblin camp',
        },
      ],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should validate quest update with optional objective', () => {
    const input = {
      questUpdates: [
        {
          questId: 'quest-2',
          questName: 'Deliver the Message',
          status: 'updated',
          objective: 'The recipient has moved to the next village',
          reason: 'Player learned of recipient relocation',
        },
      ],
      newQuests: [],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should reject invalid quest status', () => {
    const input = {
      questUpdates: [
        {
          questId: 'quest-1',
          questName: 'Test Quest',
          status: 'in-progress',
          reason: 'testing',
        },
      ],
      newQuests: [],
    };

    expect(isValid(input)).toBe(false);
  });
});
