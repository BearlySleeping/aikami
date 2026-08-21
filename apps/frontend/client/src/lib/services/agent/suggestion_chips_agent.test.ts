// apps/frontend/client/src/lib/services/agent/suggestion_chips_agent.test.ts
//
// Unit tests for the suggestion-chips agent (C-420) — chip sanitization:
// combat filtering, empty-label/short-prefill drops, dedupe, and cap at 4.
//
// Contract: C-420 One Choice Affordance
import { describe, expect, it } from 'bun:test';
import type { NpcSuggestionChip } from '@aikami/types';
import { sanitizeChips } from './agents/suggestion_chips_agent.ts';

const chip = (overrides: Partial<NpcSuggestionChip> = {}): NpcSuggestionChip => ({
  id: 'c1',
  label: 'Ask about the ward',
  intentType: 'dialogue',
  prefillText: 'Tell me more about the fading ward, please.',
  ...overrides,
});

describe('sanitizeChips (C-420)', () => {
  it('keeps well-formed chips', () => {
    const result = sanitizeChips([chip()]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('Ask about the ward');
  });

  it('drops combat-intent chips (no chat combat surface)', () => {
    const result = sanitizeChips([
      chip({ id: 'c1', intentType: 'combat', label: 'Attack' }),
      chip({ id: 'c2', intentType: 'dialogue', label: 'Ask' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c2');
  });

  it('drops chips with empty labels', () => {
    const result = sanitizeChips([chip({ label: '   ' })]);
    expect(result).toHaveLength(0);
  });

  it('drops chips with too-short prefillText', () => {
    const result = sanitizeChips([chip({ prefillText: 'Hi' })]);
    expect(result).toHaveLength(0);
  });

  it('dedupes duplicate labels (case-insensitive)', () => {
    const result = sanitizeChips([
      chip({ id: 'a', label: 'Go left' }),
      chip({ id: 'b', label: 'go left' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('caps the list at 4 chips', () => {
    const result = sanitizeChips(
      [1, 2, 3, 4, 5].map((n) => chip({ id: `c${n}`, label: `Chip ${n}` })),
    );
    expect(result).toHaveLength(4);
  });

  it('guarantees unique, non-empty ids', () => {
    const result = sanitizeChips([
      chip({ id: '', label: 'First' }),
      chip({ id: '', label: 'Second' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).not.toBe('');
    expect(result[1]?.id).not.toBe('');
    expect(result[0]?.id).not.toBe(result[1]?.id);
  });
});
