// apps/frontend/client/src/lib/services/agent/cyoa_agent.test.ts
//
// Unit tests for the CYOA agent — schema validation and choice
// sanitization (duplicates, malformed skill checks, cap at 4).
//
// Contract: C-245 CYOA Choices Branching Narrative

import { describe, expect, it } from 'bun:test';
import { type CyoaChoice, CyoaChoiceResultSchema, schemaCheck } from '@aikami/schemas';
import { sanitizeChoices } from './agents/cyoa_agent.ts';

describe('CyoaChoiceResult schema validation', () => {
  it('should validate a well-formed 3-choice result', () => {
    const input = {
      choices: [
        { id: 'c1', label: 'Investigate the ruins' },
        { id: 'c2', label: 'Follow the river trail', description: 'The trail winds north.' },
        {
          id: 'c3',
          label: 'Persuade the guard',
          skillCheck: { ability: 'Persuasion', dc: 15 },
        },
      ],
    };

    expect(schemaCheck(CyoaChoiceResultSchema, input)).toBe(true);
  });

  it('should validate an empty choices array (valid no-op)', () => {
    expect(schemaCheck(CyoaChoiceResultSchema, { choices: [] })).toBe(true);
  });

  it('should reject a result missing the choices field', () => {
    expect(schemaCheck(CyoaChoiceResultSchema, {})).toBe(false);
  });

  it('should reject choices with empty labels', () => {
    const input = { choices: [{ id: 'c1', label: '' }] };
    expect(schemaCheck(CyoaChoiceResultSchema, input)).toBe(false);
  });

  it('should reject more than 4 choices', () => {
    const input = {
      choices: [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, label: `Choice ${n}` })),
    };
    expect(schemaCheck(CyoaChoiceResultSchema, input)).toBe(false);
  });

  it('should reject skill check without dc', () => {
    const input = {
      choices: [{ id: 'c1', label: 'Sneak past', skillCheck: { ability: 'Stealth' } }],
    };
    expect(schemaCheck(CyoaChoiceResultSchema, input)).toBe(false);
  });
});

describe('sanitizeChoices', () => {
  it('should drop duplicate labels (case-insensitive)', () => {
    const input: CyoaChoice[] = [
      { id: 'a', label: 'Go left' },
      { id: 'b', label: 'go LEFT' },
      { id: 'c', label: 'Go right' },
    ];

    const result = sanitizeChoices(input);
    expect(result.length).toBe(2);
    expect(result.map((c) => c.label)).toEqual(['Go left', 'Go right']);
  });

  it('should regenerate empty or duplicate ids', () => {
    const input: CyoaChoice[] = [
      { id: 'same', label: 'First' },
      { id: 'same', label: 'Second' },
      { id: '', label: 'Third' },
    ];

    const result = sanitizeChoices(input);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('should hide malformed skill checks (dc <= 0)', () => {
    const input: CyoaChoice[] = [
      { id: 'a', label: 'Climb the wall', skillCheck: { ability: 'Athletics', dc: 0 } },
      { id: 'b', label: 'Talk it out', skillCheck: { ability: 'Persuasion', dc: 12 } },
    ];

    const result = sanitizeChoices(input);
    expect(result[0].skillCheck).toBeUndefined();
    expect(result[1].skillCheck).toEqual({ ability: 'Persuasion', dc: 12 });
  });

  it('should drop entries with whitespace-only labels', () => {
    const input: CyoaChoice[] = [
      { id: 'a', label: '   ' },
      { id: 'b', label: 'Valid choice' },
    ];

    expect(sanitizeChoices(input).length).toBe(1);
  });

  it('should cap the list at 4 choices', () => {
    const input: CyoaChoice[] = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `c${n}`,
      label: `Choice ${n}`,
    }));

    expect(sanitizeChoices(input).length).toBe(4);
  });

  it('should return empty array for empty input (no-op)', () => {
    expect(sanitizeChoices([])).toEqual([]);
  });
});
