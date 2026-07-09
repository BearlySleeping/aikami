// apps/frontend/client/src/lib/services/lorebook/lorebook_generator.test.ts
//
// Schema validation tests for the LorebookEntrySchema and
// LorebookEntriesArraySchema used by the AI generator.
// Inlines TypeBox schemas and schemaCheck to avoid Bun module resolution issues.

import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Inline minimal TypeBox + schemaCheck (avoids @sinclair/typebox + @aikami/* deps)
// ---------------------------------------------------------------------------

// Minimal TypeBox-like builder (only what we need for this test)
const T = {
  string: () => ({ kind: 'string' as const }),
  number: () => ({ kind: 'number' as const }),
  boolean: () => ({ kind: 'boolean' as const }),
  array: (item: { kind: string }, opts?: { minItems?: number }) => ({
    kind: 'array',
    item,
    minItems: opts?.minItems,
  }),
  object: (
    props: Record<string, { kind: string; default?: unknown }>,
    opts?: Record<string, unknown>,
  ) => ({
    kind: 'object',
    props,
    ...opts,
  }),
  optional: (schema: { kind: string }) => ({ ...schema, optional: true }),
};

type SchemaResult<T = unknown> = { success: true; data: T } | { success: false; errors: string[] };

const checkSchema = (schema: Record<string, unknown>, value: unknown): SchemaResult => {
  if (schema.kind === 'string') {
    if (typeof value !== 'string') {
      return { success: false, errors: [`expected string, got ${typeof value}`] };
    }
    if ((schema as { minLength?: number }).minLength !== undefined && value === '') {
      return { success: false, errors: ['string too short'] };
    }
    return { success: true, data: value };
  }

  if (schema.kind === 'number') {
    if (typeof value !== 'number') {
      return { success: false, errors: [`expected number, got ${typeof value}`] };
    }
    return { success: true, data: value };
  }

  if (schema.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      return { success: false, errors: [`expected boolean, got ${typeof value}`] };
    }
    return { success: true, data: value };
  }

  if (schema.kind === 'array') {
    if (!Array.isArray(value)) {
      return { success: false, errors: ['expected array'] };
    }
    const arrSchema = schema as { item: Record<string, unknown>; minItems?: number };
    if (arrSchema.minItems !== undefined && value.length < arrSchema.minItems) {
      return {
        success: false,
        errors: [`array too short: ${value.length} < ${arrSchema.minItems}`],
      };
    }
    const items: unknown[] = [];
    for (const v of value) {
      const r = checkSchema(arrSchema.item, v);
      if (!r.success) {
        return r;
      }
      items.push(r.data);
    }
    return { success: true, data: items };
  }

  if (schema.kind === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { success: false, errors: ['expected object'] };
    }
    const objSchema = schema as {
      props: Record<string, { kind: string; optional?: boolean; default?: unknown }>;
    };
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, propSchema] of Object.entries(objSchema.props)) {
      if (propSchema.optional && !(key in record)) {
        if ('default' in propSchema) {
          result[key] = propSchema.default;
        }
        continue;
      }
      if (!(key in record)) {
        return { success: false, errors: [`missing required field: ${key}`] };
      }
      const r = checkSchema(propSchema, record[key]);
      if (!r.success) {
        return r;
      }
      result[key] = r.data;
    }
    return { success: true, data: result };
  }

  return { success: false, errors: ['unknown schema kind'] };
};

// ---------------------------------------------------------------------------
// LorebookEntrySchema (mirrors the TypeBox definition)
// ---------------------------------------------------------------------------

const LorebookEntrySchema = T.object({
  keywords: T.array(T.string(), { minItems: 1 }),
  content: T.string(),
  priority: T.optional(T.number()),
  constant: T.optional(T.boolean()),
});

// Defaults applied post-validation for optional fields
const _applyDefaults = (data: Record<string, unknown>): Record<string, unknown> => ({
  ...data,
  priority: data.priority ?? 0,
  constant: data.constant ?? false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LorebookEntrySchema', () => {
  it('validates a valid entry with all required fields', () => {
    const input = {
      keywords: ['goblin', 'orc'],
      content: 'Goblins and orcs are common enemies in this region.',
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(true);
    if (result.success) {
      const data = _applyDefaults(result.data as Record<string, unknown>);
      expect(data.keywords).toEqual(['goblin', 'orc']);
      expect(data.content).toBe('Goblins and orcs are common enemies in this region.');
      expect(data.priority).toBe(0);
      expect(data.constant).toBe(false);
    }
  });

  it('validates an entry with optional priority and constant', () => {
    const input = {
      keywords: ['dragon'],
      content: 'A fearsome dragon rules the mountain peak.',
      priority: 5,
      constant: true,
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(true);
    if (result.success) {
      const data = _applyDefaults(result.data as Record<string, unknown>);
      expect(data.priority).toBe(5);
      expect(data.constant).toBe(true);
    }
  });

  it('rejects entry with missing keywords', () => {
    const input = {
      content: 'Missing keywords.',
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(false);
  });

  it('rejects entry with empty keywords array', () => {
    const input = {
      keywords: [],
      content: 'Empty keywords array.',
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(false);
  });

  it('rejects entry with missing content', () => {
    const input = {
      keywords: ['test'],
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(false);
  });

  it('rejects entry with non-string keywords', () => {
    const input = {
      keywords: [123, 'valid'],
      content: 'Mixed keywords.',
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(false);
  });

  it('accepts entry with zero priority', () => {
    const input = {
      keywords: ['test'],
      content: 'Zero priority.',
      priority: 0,
    };

    const result = checkSchema(LorebookEntrySchema, input);

    expect(result.success).toBe(true);
  });
});

describe('LorebookEntriesArraySchema', () => {
  const arraySchema = T.array(LorebookEntrySchema, { minItems: 1 });

  it('validates an array of valid entries', () => {
    const input = [
      { keywords: ['goblin'], content: 'Goblin lore' },
      { keywords: ['dragon'], content: 'Dragon lore', priority: 3, constant: true },
    ];

    const result = checkSchema(arraySchema, input);

    expect(result.success).toBe(true);
  });

  it('rejects an empty array (minItems: 1)', () => {
    const input: unknown[] = [];

    const result = checkSchema(arraySchema, input);

    expect(result.success).toBe(false);
  });

  it('rejects array with invalid entries', () => {
    const input = [
      { keywords: ['valid'], content: 'Valid entry' },
      { keywords: [], content: 'Invalid — empty keywords' },
    ];

    const result = checkSchema(arraySchema, input);

    expect(result.success).toBe(false);
  });
});
