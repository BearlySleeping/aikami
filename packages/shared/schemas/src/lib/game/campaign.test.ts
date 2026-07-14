// packages/shared/schemas/src/lib/campaign.test.ts
//
// Tests for Campaign schema validation.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { CampaignSchema } from './campaign.ts';

/** Minimal valid campaign fixture. */
const validCampaign = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'New Adventure',
  state: 'idle' as const,
  contentPackId: 'emberwatch',
  seed: 42,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  capabilityProfile: {
    textProvider: true,
    imageProvider: false,
    voiceProvider: false,
  },
};

describe('CampaignSchema', () => {
  test('should validate a valid campaign', () => {
    const result = Value.Parse(CampaignSchema, validCampaign);
    expect(result.id).toBe(validCampaign.id);
    expect(result.state).toBe('idle');
    expect(result.seed).toBe(42);
  });

  test('should accept all valid campaign states', () => {
    const states = [
      'idle',
      'creating',
      'loading',
      'playing',
      'paused',
      'saving',
      'failed',
    ] as const;
    for (const state of states) {
      const campaign = { ...validCampaign, state };
      const result = Value.Parse(CampaignSchema, campaign);
      expect(result.state).toBe(state);
    }
  });

  test('should reject invalid state', () => {
    const campaign = { ...validCampaign, state: 'invalid_state' };
    expect(() => Value.Parse(CampaignSchema, campaign)).toThrow();
  });

  test('should reject missing required fields', () => {
    const { id, ...missingId } = validCampaign;
    expect(() => Value.Parse(CampaignSchema, missingId)).toThrow();
  });

  test('should accept optional personaId', () => {
    const withPersona = { ...validCampaign, personaId: 'persona-123' };
    const result = Value.Parse(CampaignSchema, withPersona);
    expect(result.personaId).toBe('persona-123');

    const withoutPersona = { ...validCampaign };
    const result2 = Value.Parse(CampaignSchema, withoutPersona);
    expect(result2.personaId).toBeUndefined();
  });

  test('should accept optional save metadata', () => {
    const withSaves = {
      ...validCampaign,
      lastSavedAt: '2026-01-01T01:00:00.000Z',
      lastSaveSlotId: 'auto-save',
    };
    const result = Value.Parse(CampaignSchema, withSaves);
    expect(result.lastSavedAt).toBe('2026-01-01T01:00:00.000Z');
    expect(result.lastSaveSlotId).toBe('auto-save');
  });

  test('should reject missing capabilityProfile fields', () => {
    const badProfile = {
      ...validCampaign,
      capabilityProfile: { textProvider: true },
    };
    expect(() => Value.Parse(CampaignSchema, badProfile)).toThrow();
  });

  test('should reject non-boolean capabilityProfile values', () => {
    const badProfile = {
      ...validCampaign,
      capabilityProfile: { textProvider: 'yes', imageProvider: false, voiceProvider: false },
    };
    expect(() => Value.Parse(CampaignSchema, badProfile)).toThrow();
  });
});
