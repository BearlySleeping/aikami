// packages/shared/schemas/src/lib/studio/studio.test.ts

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { LibraryEntrySchema, StudioDraftSchema } from './studio.ts';

describe('Creator Studio schemas', () => {
  test('StudioDraft requires an ISO date-time update timestamp', () => {
    const draft = {
      id: 'draft-1',
      recipeId: 'prop',
      positivePrompt: 'A lantern',
      updatedAt: '2026-09-13T12:00:00.000Z',
    };

    expect(Value.Check(StudioDraftSchema, draft)).toBe(true);
    expect(Value.Check(StudioDraftSchema, { ...draft, updatedAt: 'yesterday' })).toBe(false);
  });

  test('LibraryEntry accepts an empty createdAt and only lowercase dotted extensions', () => {
    const entry = {
      tag: 'props:lantern',
      category: 'props',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
      ext: '.png',
      provenance: { source: 'generated:sdcpp' },
      createdAt: '',
      localGenerated: true,
    };

    expect(Value.Check(LibraryEntrySchema, entry)).toBe(true);
    expect(Value.Check(LibraryEntrySchema, { ...entry, ext: 'png' })).toBe(false);
    expect(Value.Check(LibraryEntrySchema, { ...entry, ext: '.PNG' })).toBe(false);
    expect(Value.Check(LibraryEntrySchema, { ...entry, createdAt: 'not-a-date' })).toBe(false);
  });
});
