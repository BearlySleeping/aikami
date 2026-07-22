// packages/shared/schemas/src/lib/game/pack_index.test.ts
//
// Schema validation tests for PackIndex and PackIndexEntry schemas.
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { PackIndexEntrySchema, PackIndexSchema } from './pack_index.ts';

// ---------------------------------------------------------------------------
// PackIndexEntrySchema
// ---------------------------------------------------------------------------

describe('PackIndexEntrySchema', () => {
  test('accepts a valid pack index entry with all required fields', () => {
    const entry = {
      id: 'emberwatch',
      name: 'Emberwatch: The Fading Ward',
      version: '2.1.0',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    expect(Value.Check(PackIndexEntrySchema, entry)).toBe(true);
  });

  test('accepts a valid entry with optional description', () => {
    const entry = {
      id: 'whispering-caves',
      name: 'Whispering Caves',
      version: '1.0.0',
      updatedAt: '2026-07-20T00:00:00.000Z',
      description: 'Deep beneath the foothills.',
    };
    expect(Value.Check(PackIndexEntrySchema, entry)).toBe(true);
  });

  test('rejects entry with missing id', () => {
    const entry = { name: 'Test', version: '1.0.0', updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(Value.Check(PackIndexEntrySchema, entry)).toBe(false);
  });

  test('rejects entry with invalid semver version', () => {
    const entry = {
      id: 'test',
      name: 'Test',
      version: 'not-a-version',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(Value.Check(PackIndexEntrySchema, entry)).toBe(false);
  });

  test('rejects entry with empty id', () => {
    const entry = {
      id: '',
      name: 'Test',
      version: '1.0.0',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(Value.Check(PackIndexEntrySchema, entry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PackIndexSchema
// ---------------------------------------------------------------------------

describe('PackIndexSchema', () => {
  test('accepts a valid pack index with two packs', () => {
    const index = {
      schemaVersion: 1,
      packs: [
        {
          id: 'emberwatch',
          name: 'Emberwatch',
          version: '2.1.0',
          updatedAt: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 'whispering-caves',
          name: 'Whispering Caves',
          version: '1.0.0',
          updatedAt: '2026-07-20T00:00:00.000Z',
          description: 'Caves adventure.',
        },
      ],
    };
    expect(Value.Check(PackIndexSchema, index)).toBe(true);
  });

  test('rejects index with wrong schemaVersion', () => {
    const index = {
      schemaVersion: 2,
      packs: [],
    };
    expect(Value.Check(PackIndexSchema, index)).toBe(false);
  });

  test('rejects index with missing packs array', () => {
    const index = { schemaVersion: 1 };
    expect(Value.Check(PackIndexSchema, index)).toBe(false);
  });

  test('accepts empty packs array', () => {
    const index = { schemaVersion: 1, packs: [] };
    expect(Value.Check(PackIndexSchema, index)).toBe(true);
  });

  test('rejects packs with invalid entry inside valid index', () => {
    const index = {
      schemaVersion: 1,
      packs: [{ id: 'test', name: 'Test', version: 'bad', updatedAt: '2026-01-01T00:00:00.000Z' }],
    };
    expect(Value.Check(PackIndexSchema, index)).toBe(false);
  });
});
