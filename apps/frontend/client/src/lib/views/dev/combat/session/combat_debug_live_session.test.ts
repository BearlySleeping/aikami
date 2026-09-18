// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_live_session.test.ts
//
// Unit tests for the live session's pure helpers. The class itself boots
// PixiJS and an ECS worker, which Bun cannot host — only the standalone
// functions are exercised here.
//
// Contract: combat debug workspace (execution prompt §2, §6, §7)
import { describe, expect, test } from 'bun:test';
import { hashCombatDebugSeed, parseActiveCombatantId } from './combat_debug_live_session.ts';

describe('hashCombatDebugSeed', () => {
  test('is stable for the same input', () => {
    expect(hashCombatDebugSeed('x')).toBe(hashCombatDebugSeed('x'));
    expect(hashCombatDebugSeed('emberwatch-proof')).toBe(hashCombatDebugSeed('emberwatch-proof'));
  });

  test('differs for different input', () => {
    expect(hashCombatDebugSeed('x')).not.toBe(hashCombatDebugSeed('y'));
    expect(hashCombatDebugSeed('42')).not.toBe(hashCombatDebugSeed('43'));
  });

  test('is an unsigned 32-bit integer', () => {
    const hash = hashCombatDebugSeed('x');
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  test('the empty string has the djb2 offset basis', () => {
    expect(hashCombatDebugSeed('')).toBe(5381);
  });
});

describe('parseActiveCombatantId', () => {
  test('extracts the combatant id from an r-prefixed turn id', () => {
    expect(parseActiveCombatantId('r2:goblin')).toBe('goblin');
    expect(parseActiveCombatantId('r1:player-hero')).toBe('player-hero');
  });

  test('returns undefined for a null turn id', () => {
    expect(parseActiveCombatantId(null)).toBeUndefined();
  });

  test('returns the input when there is no prefix separator', () => {
    expect(parseActiveCombatantId('player')).toBe('player');
  });

  test('returns the input when the separator is trailing', () => {
    expect(parseActiveCombatantId('r2:')).toBe('r2:');
  });

  test('keeps everything after the first separator', () => {
    expect(parseActiveCombatantId('r2:emberwatch:goblin-1')).toBe('emberwatch:goblin-1');
  });
});
