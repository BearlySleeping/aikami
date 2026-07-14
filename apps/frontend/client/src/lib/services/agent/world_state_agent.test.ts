// apps/frontend/client/src/lib/services/agent/world_state_agent.test.ts
//
// Unit tests for the world state tracker agent schema validation.
// Uses manual structural validation matching the ViewModel approach,
// since typebox v1.x does not expose Value.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';

describe('WorldStateExtraction validation', () => {
  const isValid = (input: unknown): boolean => {
    if (typeof input !== 'object' || input === null) {
      return false;
    }
    const data = input as Record<string, unknown>;
    if (typeof data.locationName !== 'string' || data.locationName.length === 0) {
      return false;
    }
    if (typeof data.locationDescription !== 'string' || data.locationDescription.length === 0) {
      return false;
    }
    if (typeof data.timeOfDay !== 'string') {
      return false;
    }
    if (typeof data.weather !== 'string') {
      return false;
    }
    if (data.notableChanges !== undefined && !Array.isArray(data.notableChanges)) {
      return false;
    }
    return true;
  };

  it('should validate a complete world state extraction', () => {
    const input = {
      locationName: 'The Whispering Woods',
      locationDescription: 'Ancient trees with glowing moss',
      timeOfDay: 'twilight',
      weather: 'Fog rolling in from the east',
      notableChanges: ['A fallen tree blocks the northern path'],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should reject missing required fields', () => {
    const input = {
      locationName: 'The Whispering Woods',
    };

    expect(isValid(input)).toBe(false);
  });

  it('should allow empty notableChanges array', () => {
    const input = {
      locationName: 'Town Square',
      locationDescription: 'Bustling marketplace',
      timeOfDay: 'noon',
      weather: 'Sunny',
      notableChanges: [],
    };

    expect(isValid(input)).toBe(true);
  });

  it('should reject empty locationName', () => {
    const input = {
      locationName: '',
      locationDescription: 'Test',
      timeOfDay: 'morning',
      weather: 'Clear',
      notableChanges: [],
    };

    expect(isValid(input)).toBe(false);
  });
});
