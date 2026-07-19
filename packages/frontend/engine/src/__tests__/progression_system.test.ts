// packages/frontend/engine/src/__tests__/progression_system.test.ts
//
// Unit tests for the class-aware progression system.
//
// Contract: C-337 — AC-2: XP progression unlocks class features at correct levels

import { describe, expect, it } from 'bun:test';
import { XP_THRESHOLDS } from '@aikami/constants';
import {
  checkLevelUp,
  resolveHpPerLevel,
  resolveLevelFeatures,
} from '../systems/progression_system.ts';

// ---------------------------------------------------------------------------
// checkLevelUp
// ---------------------------------------------------------------------------

describe('checkLevelUp', () => {
  it('returns null when XP is below threshold', () => {
    const result = checkLevelUp({ currentLevel: 1, currentXp: 200 });
    expect(result).toBeNull();
  });

  it('returns level 2 when XP reaches threshold', () => {
    const result = checkLevelUp({ currentLevel: 1, currentXp: 300 });
    expect(result).toBe(2);
  });

  it('returns level 3 when XP reaches level 3 threshold', () => {
    const result = checkLevelUp({ currentLevel: 2, currentXp: 900 });
    expect(result).toBe(3);
  });

  it('returns level 4 at 2700 XP', () => {
    const result = checkLevelUp({ currentLevel: 3, currentXp: 2700 });
    expect(result).toBe(4);
  });

  it('returns level 5 at 6500 XP', () => {
    const result = checkLevelUp({ currentLevel: 4, currentXp: 6500 });
    expect(result).toBe(5);
  });

  it('returns null for XP beyond defined table (level 6)', () => {
    // Level 6 threshold is auto-computed, XP 10000 should trigger it
    // But our checkLevelUp checks only one level at a time
    const result = checkLevelUp({ currentLevel: 5, currentXp: 10000 });
    expect(result).toBe(6); // auto-computed threshold
  });
});

// ---------------------------------------------------------------------------
// resolveLevelFeatures
// ---------------------------------------------------------------------------

describe('resolveLevelFeatures', () => {
  it('returns fighter level 1 features', () => {
    const features = resolveLevelFeatures({ classId: 'fighter', level: 1 });
    expect(features).toContain('fighter_fighting_style');
    expect(features).toContain('fighter_second_wind');
    expect(features.length).toBe(2);
  });

  it('returns fighter level 2 features (Action Surge)', () => {
    const features = resolveLevelFeatures({ classId: 'fighter', level: 2 });
    expect(features).toContain('fighter_action_surge');
    expect(features.length).toBe(1);
  });

  it('returns wizard level 1 features', () => {
    const features = resolveLevelFeatures({ classId: 'wizard', level: 1 });
    expect(features).toContain('wizard_arcane_recovery');
    expect(features).toContain('wizard_magic_missile');
    expect(features.length).toBe(2);
  });

  it('returns rogue level 2 features (Cunning Action)', () => {
    const features = resolveLevelFeatures({ classId: 'rogue', level: 2 });
    expect(features).toContain('rogue_cunning_action');
    expect(features.length).toBe(1);
  });

  it('returns cleric level 2 features (Channel Divinity)', () => {
    const features = resolveLevelFeatures({ classId: 'cleric', level: 2 });
    expect(features).toContain('cleric_channel_divinity');
    expect(features.length).toBe(1);
  });

  it('returns empty array for unknown class', () => {
    const features = resolveLevelFeatures({ classId: 'barbarian', level: 1 });
    expect(features).toEqual([]);
  });

  it('returns empty array for level beyond defined features', () => {
    const features = resolveLevelFeatures({ classId: 'fighter', level: 6 });
    expect(features).toEqual([]);
  });

  it('generates unique feature IDs across classes', () => {
    const fighterFeatures = resolveLevelFeatures({ classId: 'fighter', level: 1 });
    const wizardFeatures = resolveLevelFeatures({ classId: 'wizard', level: 1 });
    // No collision between fighter and wizard features
    const allIds = new Set([...fighterFeatures, ...wizardFeatures]);
    expect(allIds.size).toBe(fighterFeatures.length + wizardFeatures.length);
  });
});

// ---------------------------------------------------------------------------
// resolveHpPerLevel
// ---------------------------------------------------------------------------

describe('resolveHpPerLevel', () => {
  it('returns 6 for fighter', () => {
    expect(resolveHpPerLevel('fighter')).toBe(6);
  });

  it('returns 4 for wizard', () => {
    expect(resolveHpPerLevel('wizard')).toBe(4);
  });

  it('returns 5 for rogue and cleric', () => {
    expect(resolveHpPerLevel('rogue')).toBe(5);
    expect(resolveHpPerLevel('cleric')).toBe(5);
  });

  it('returns 6 (default) for unknown class', () => {
    expect(resolveHpPerLevel('barbarian')).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// XP Thresholds
// ---------------------------------------------------------------------------

describe('XP_THRESHOLDS', () => {
  it('has correct level 1 threshold (0)', () => {
    expect(XP_THRESHOLDS['1']).toBe(0);
  });

  it('has correct level 2 threshold (300)', () => {
    expect(XP_THRESHOLDS['2']).toBe(300);
  });

  it('has correct level 3 threshold (900)', () => {
    expect(XP_THRESHOLDS['3']).toBe(900);
  });

  it('has correct level 4 threshold (2700)', () => {
    expect(XP_THRESHOLDS['4']).toBe(2700);
  });

  it('has correct level 5 threshold (6500)', () => {
    expect(XP_THRESHOLDS['5']).toBe(6500);
  });
});
