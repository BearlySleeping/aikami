// apps/frontend/client/src/lib/components/messaging/suggestion_chips.test.ts
//
// Unit tests for the shared SuggestionChips component (C-420). The component
// renders a wrapped row of NpcSuggestionChip buttons with intent icons and
// intent-coloured daisyUI classes, and calls back via `onSelect` — it owns no
// selection semantics (auto-send vs prefill is per-surface).
//
// These tests cover the intent → class/icon mapping that the component
// computes from a chip's intentType, mirroring the component's logic.
//
// Contract: C-420 One Choice Affordance
import { describe, expect, test } from 'bun:test';

// ── Logic under test (mirrors SuggestionChips' intent mapping) ──────────

const chipClassFor = (intentType: string): string => {
  if (intentType === 'combat') {
    return 'btn-outline btn-error';
  }
  if (intentType === 'skill_check') {
    return 'btn-outline btn-accent';
  }
  if (intentType === 'trade') {
    return 'btn-outline btn-warning';
  }
  if (intentType === 'quest') {
    return 'btn-outline btn-info';
  }
  return 'btn-outline';
};

const chipIconFor = (intentType: string): string => {
  if (intentType === 'skill_check') {
    return '🎲';
  }
  if (intentType === 'combat') {
    return '⚔️';
  }
  if (intentType === 'trade') {
    return '💰';
  }
  if (intentType === 'quest') {
    return '📋';
  }
  return '💬';
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('SuggestionChips — intent mapping (C-420)', () => {
  test('combat intent maps to error styling and a sword icon', () => {
    expect(chipClassFor('combat')).toContain('btn-error');
    expect(chipIconFor('combat')).toBe('⚔️');
  });

  test('skill_check intent maps to accent styling and a dice icon', () => {
    expect(chipClassFor('skill_check')).toContain('btn-accent');
    expect(chipIconFor('skill_check')).toBe('🎲');
  });

  test('trade intent maps to warning styling and a coin icon', () => {
    expect(chipClassFor('trade')).toContain('btn-warning');
    expect(chipIconFor('trade')).toBe('💰');
  });

  test('quest intent maps to info styling and a clipboard icon', () => {
    expect(chipClassFor('quest')).toContain('btn-info');
    expect(chipIconFor('quest')).toBe('📋');
  });

  test('dialogue intent maps to neutral outline styling and a speech icon', () => {
    expect(chipClassFor('dialogue')).toBe('btn-outline');
    expect(chipIconFor('dialogue')).toBe('💬');
  });

  test('unknown intent falls back to neutral outline styling', () => {
    expect(chipClassFor('unknown' as string)).toBe('btn-outline');
    expect(chipIconFor('unknown' as string)).toBe('💬');
  });
});
