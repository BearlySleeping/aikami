// apps/frontend/client/src/lib/services/lorebook/keyword_scanner.test.ts
//
// Unit tests for scanKeywords — pure keyword matching with word-boundary
// enforcement, dedup, priority sort, and constant-entry inclusion.

import { describe, expect, it } from 'bun:test';
import type { LorebookEntry } from '$types/lorebook';
import { scanKeywords } from './keyword_scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (overrides: Partial<LorebookEntry> = {}): LorebookEntry => ({
  id: crypto.randomUUID(),
  keywords: [],
  content: '',
  priority: 0,
  constant: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanKeywords', () => {
  it('includes constant entries regardless of message content', () => {
    const constantEntry = entry({ id: 'c1', constant: true, content: 'Always there' });
    const matches = scanKeywords({ entries: [constantEntry], message: 'hello world' });

    expect(matches).toHaveLength(1);
    expect(matches[0].entry.id).toBe('c1');
    expect(matches[0].matchReason).toBe('constant');
    expect(matches[0].matchedKeyword).toBeUndefined();
  });

  it('matches keywords case-insensitively', () => {
    const goblinEntry = entry({ id: 'e1', keywords: ['Goblin'], content: 'Goblin lore' });
    const matches = scanKeywords({ entries: [goblinEntry], message: 'I see a goblin ahead' });

    expect(matches).toHaveLength(1);
    expect(matches[0].entry.id).toBe('e1');
    expect(matches[0].matchReason).toBe("matched: 'Goblin'");
    expect(matches[0].matchedKeyword).toBe('Goblin');

    // Also case-insensitive from the other direction
    const matchesUpper = scanKeywords({ entries: [goblinEntry], message: 'GOBLIN attack!' });
    expect(matchesUpper).toHaveLength(1);
  });

  it('enforces word boundaries — "gob" does NOT match "goblin"', () => {
    const gobEntry = entry({ id: 'e1', keywords: ['gob'], content: 'Gob lore' });
    const matches = scanKeywords({ entries: [gobEntry], message: 'I see a goblin' });

    expect(matches).toHaveLength(0);
  });

  it('matches plurals — "goblins" matches keyword "goblin"', () => {
    const goblinEntry = entry({ id: 'e1', keywords: ['goblin'], content: 'Goblin lore' });
    const matches = scanKeywords({ entries: [goblinEntry], message: 'the goblins are coming' });

    expect(matches).toHaveLength(1);
    expect(matches[0].entry.id).toBe('e1');
  });

  it('deduplicates matches — one match per entry', () => {
    const multiEntry = entry({
      id: 'e1',
      keywords: ['sword', 'blade', 'weapon'],
      content: 'Weapon lore',
    });
    const matches = scanKeywords({
      entries: [multiEntry],
      message: 'I swing my sword and the blade gleams',
    });

    expect(matches).toHaveLength(1);
    // First matching keyword wins
    expect(matches[0].matchedKeyword).toBe('sword');
  });

  it('sorts matches by priority descending', () => {
    const low = entry({ id: 'low', keywords: ['item'], priority: 0, content: 'Low' });
    const high = entry({ id: 'high', keywords: ['item'], priority: 10, content: 'High' });
    const mid = entry({ id: 'mid', keywords: ['item'], priority: 5, content: 'Mid' });

    const matches = scanKeywords({
      entries: [low, high, mid],
      message: 'I found an item',
    });

    expect(matches).toHaveLength(3);
    expect(matches[0].entry.id).toBe('high');
    expect(matches[1].entry.id).toBe('mid');
    expect(matches[2].entry.id).toBe('low');
  });

  it('returns constant entries at their priority level', () => {
    const regular = entry({ id: 'r1', keywords: ['dragon'], priority: 10, content: 'Dragon' });
    const constantEntry = entry({
      id: 'c1',
      constant: true,
      priority: 5,
      content: 'World rules',
    });

    const matches = scanKeywords({
      entries: [regular, constantEntry],
      message: 'I see a dragon',
    });

    expect(matches).toHaveLength(2);
    expect(matches[0].entry.id).toBe('r1'); // priority 10 wins
    expect(matches[1].entry.id).toBe('c1'); // priority 5 second
  });

  it('returns empty array for no matches', () => {
    const entry1 = entry({ id: 'e1', keywords: ['elf'], content: 'Elf lore' });
    const matches = scanKeywords({ entries: [entry1], message: 'hello world' });

    expect(matches).toHaveLength(0);
  });

  it('matches keyword at start of message (word boundary)', () => {
    const entry1 = entry({ id: 'e1', keywords: ['dragon'], content: 'Dragon lore' });
    const matches = scanKeywords({ entries: [entry1], message: 'dragon flies overhead' });

    expect(matches).toHaveLength(1);
  });

  it('matches keyword at end of message (word boundary)', () => {
    const entry1 = entry({ id: 'e1', keywords: ['dragon'], content: 'Dragon lore' });
    const matches = scanKeywords({ entries: [entry1], message: 'I see a dragon' });

    expect(matches).toHaveLength(1);
  });

  it('handles empty keywords array gracefully', () => {
    const entry1 = entry({ id: 'e1', keywords: [], content: 'No keywords' });
    const matches = scanKeywords({ entries: [entry1], message: 'anything' });

    expect(matches).toHaveLength(0);
  });

  it('handles special regex characters in keywords', () => {
    const entry1 = entry({ id: 'e1', keywords: ['dragon+king'], content: 'Special' });
    const matches = scanKeywords({ entries: [entry1], message: 'the dragon+king rules' });

    expect(matches).toHaveLength(1);
  });
});
