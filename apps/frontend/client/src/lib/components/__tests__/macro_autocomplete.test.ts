// apps/frontend/client/src/lib/components/__tests__/macro_autocomplete.test.ts
//
// Unit tests for the macro autocomplete component (C-237).
// Tests the 23 registered macros: shape validation, filter logic,
// category grouping, zero-match handling, and edge cases.

import { describe, expect, test } from 'bun:test';

// ── Type (mirrors component's MacroOption) ──────────────────────────────────

type MacroOption = {
  name: string;
  description: string;
  category: string;
};

// ── 23 registered macros (mirrors component's ALL_MACROS) ───────────────────

const ALL_MACROS: MacroOption[] = [
  // Identity
  { name: 'user', description: 'User display name', category: 'Identity' },
  { name: 'char', description: 'Character name', category: 'Identity' },
  // Character
  { name: 'description', description: 'Character description', category: 'Character' },
  { name: 'personality', description: 'Character personality', category: 'Character' },
  // Context
  { name: 'scenario', description: 'Current scenario', category: 'Context' },
  { name: 'persona', description: 'User persona', category: 'Context' },
  { name: 'history', description: 'Chat history', category: 'Context' },
  { name: 'message', description: 'User message', category: 'Context' },
  { name: 'other_characters', description: 'Other NPCs present', category: 'Context' },
  { name: 'getcontext', description: 'Extra context by key', category: 'Context' },
  // Time
  { name: 'time', description: 'Current time', category: 'Time' },
  { name: 'date', description: 'Current date', category: 'Time' },
  { name: 'datetime', description: 'Current date & time', category: 'Time' },
  { name: 'timestamp', description: 'Unix timestamp', category: 'Time' },
  // Random
  { name: 'random', description: 'Random option selection', category: 'Random' },
  { name: 'dice', description: 'Dice roll', category: 'Random' },
  // Variables
  { name: 'setvar', description: 'Set variable', category: 'Variables' },
  { name: 'getvar', description: 'Get variable', category: 'Variables' },
  { name: 'incvar', description: 'Increment variable', category: 'Variables' },
  { name: 'decvar', description: 'Decrement variable', category: 'Variables' },
  // Formatting
  { name: 'trim', description: 'Trim whitespace', category: 'Formatting' },
  { name: 'uppercase', description: 'Convert to uppercase', category: 'Formatting' },
  { name: 'lowercase', description: 'Convert to lowercase', category: 'Formatting' },
];

// ── Filter & categorize logic (mirrors component's $derived) ─────────────────

const filterMacros = (trigger: string, macros: MacroOption[] = ALL_MACROS): MacroOption[] => {
  if (trigger.length === 0) {
    return [...macros];
  }
  return macros.filter((m) => m.name.toLowerCase().startsWith(trigger.toLowerCase()));
};

const categorizeMacros = (macros: MacroOption[]): Map<string, MacroOption[]> => {
  const map = new Map<string, MacroOption[]>();
  for (const macro of macros) {
    const existing = map.get(macro.category);
    if (existing) {
      existing.push(macro);
    } else {
      map.set(macro.category, [macro]);
    }
  }
  return map;
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests: 23 registered macros
// ═══════════════════════════════════════════════════════════════════════════

describe('macro_autocomplete — 23 registered macros', () => {
  test('there are exactly 23 registered macros', () => {
    expect(ALL_MACROS.length).toBe(23);
  });

  test('all macros have required fields', () => {
    for (const macro of ALL_MACROS) {
      expect(macro.name).toBeDefined();
      expect(macro.name.length).toBeGreaterThan(0);
      expect(macro.description).toBeDefined();
      expect(macro.description.length).toBeGreaterThan(0);
      expect(macro.category).toBeDefined();
      expect(macro.category.length).toBeGreaterThan(0);
    }
  });

  test('all macro names are unique', () => {
    const names = ALL_MACROS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('all macro names are lowercase or snake_case (no spaces)', () => {
    for (const macro of ALL_MACROS) {
      expect(macro.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test('categories are correct', () => {
    const categories = new Set(ALL_MACROS.map((m) => m.category));
    expect(categories).toContain('Identity');
    expect(categories).toContain('Character');
    expect(categories).toContain('Context');
    expect(categories).toContain('Time');
    expect(categories).toContain('Random');
    expect(categories).toContain('Variables');
    expect(categories).toContain('Formatting');
    expect(categories.size).toBe(7);
  });

  test('category counts are correct', () => {
    const byCategory = categorizeMacros(ALL_MACROS);
    expect(byCategory.get('Identity')?.length).toBe(2);
    expect(byCategory.get('Character')?.length).toBe(2);
    expect(byCategory.get('Context')?.length).toBe(6);
    expect(byCategory.get('Time')?.length).toBe(4);
    expect(byCategory.get('Random')?.length).toBe(2);
    expect(byCategory.get('Variables')?.length).toBe(4);
    expect(byCategory.get('Formatting')?.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filter logic
// ═══════════════════════════════════════════════════════════════════════════

describe('macro_autocomplete — filter logic', () => {
  test('empty trigger returns all macros', () => {
    const result = filterMacros('');
    expect(result.length).toBe(23);
  });

  test('partial prefix filter matches expected macros', () => {
    // "us" should match "user"
    const result = filterMacros('us');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('user');
  });

  test('exact prefix filter matches single result', () => {
    // "char" prefix matches "char" (character name), not "character" stuff
    const result = filterMacros('char');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('char');
  });

  test('filter is case-insensitive', () => {
    const lower = filterMacros('us');
    const upper = filterMacros('US');
    expect(lower).toEqual(upper);
  });

  test('filter with "sc" matches "scenario"', () => {
    const result = filterMacros('sc');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('scenario');
  });

  test('filter with "t" matches time-related macros', () => {
    const result = filterMacros('t');
    const names = result.map((m) => m.name).sort();
    expect(names).toContain('time');
    expect(names).toContain('timestamp');
    expect(names).toContain('trim');
  });

  test('filter with "d" matches expected', () => {
    const result = filterMacros('d');
    const names = result.map((m) => m.name).sort();
    expect(names).toContain('date');
    expect(names).toContain('datetime');
    expect(names).toContain('decvar');
    expect(names).toContain('description');
    expect(names).toContain('dice');
  });

  test('filter with "p" matches expected', () => {
    const result = filterMacros('p');
    const names = result.map((m) => m.name);
    expect(names).toContain('personality');
    expect(names).toContain('persona');
  });

  test('filter with "v" prefix matches nothing (no var- prefix, vars use setvar/getvar)', () => {
    // "var" doesn't start any macro name
    const result = filterMacros('var');
    expect(result.length).toBe(0);
  });

  test('filter with "s" matches setvar and scenario', () => {
    const result = filterMacros('s');
    const names = result.map((m) => m.name);
    expect(names).toContain('scenario');
    expect(names).toContain('setvar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Zero-match handling
// ═══════════════════════════════════════════════════════════════════════════

describe('macro_autocomplete — zero-match', () => {
  test('"zzz" returns empty array', () => {
    const result = filterMacros('zzz');
    expect(result.length).toBe(0);
  });

  test('"xyz" returns empty array', () => {
    const result = filterMacros('xyz');
    expect(result.length).toBe(0);
  });

  test('"{{" (literal braces) returns empty array', () => {
    // The trigger is what comes after `{{`, so `{{` itself wouldn't be the trigger
    // but if someone types nonsense after {{...
    const result = filterMacros('{{');
    expect(result.length).toBe(0);
  });

  test('empty string returns all, not zero', () => {
    const result = filterMacros('');
    expect(result.length).toBe(23);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category grouping
// ═══════════════════════════════════════════════════════════════════════════

describe('macro_autocomplete — category grouping', () => {
  test('all macros are grouped into 7 categories', () => {
    const grouped = categorizeMacros(ALL_MACROS);
    expect(grouped.size).toBe(7);
  });

  test('empty array produces empty map', () => {
    const grouped = categorizeMacros([]);
    expect(grouped.size).toBe(0);
  });

  test('filtered results preserve category grouping', () => {
    const filtered = filterMacros('t');
    const grouped = categorizeMacros(filtered);
    // "time", "timestamp" = Time category; "trim" = Formatting category
    expect(grouped.has('Time')).toBe(true);
    expect(grouped.has('Formatting')).toBe(true);
    expect(grouped.get('Time')?.length).toBe(2); // time, timestamp
    expect(grouped.get('Formatting')?.length).toBe(1); // trim
  });

  test('single match is still grouped into its category', () => {
    const filtered = filterMacros('user');
    const grouped = categorizeMacros(filtered);
    expect(grouped.size).toBe(1);
    expect(grouped.has('Identity')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('macro_autocomplete — edge cases', () => {
  test('filter with special characters returns empty', () => {
    expect(filterMacros('!@#').length).toBe(0);
  });

  test('filter with number prefix returns empty (no macros start with digits)', () => {
    expect(filterMacros('1').length).toBe(0);
  });

  test('filter with underscore matches other_characters', () => {
    const result = filterMacros('other_');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('other_characters');
  });

  test('every macro has a non-empty description', () => {
    for (const macro of ALL_MACROS) {
      expect(macro.description.trim().length).toBeGreaterThan(0);
    }
  });

  test('every macro belongs to exactly one category (no uncategorized)', () => {
    for (const macro of ALL_MACROS) {
      expect(macro.category).toBeDefined();
      expect(macro.category.trim().length).toBeGreaterThan(0);
      expect([
        'Identity',
        'Character',
        'Context',
        'Time',
        'Random',
        'Variables',
        'Formatting',
      ]).toContain(macro.category);
    }
  });
});
