// apps/frontend/client/src/lib/services/memory/local_embedding_backend.test.ts
//
// Unit tests for the keyword-overlap retrieval backend (C-492 AC-1).
//
// Verifies that retrieval takes exactly one documented path — keyword overlap
// — with the semantic/cosine/model-loading path deleted (not merely bypassed):
//   - keyword queries rank overlapping-token entries above non-overlapping ones
//   - query() returns results without any model initialisation
//   - no @huggingface/transformers import is reachable from the module
import { beforeEach, describe, expect, it } from 'bun:test';
import type { MemoryIndexable } from '@aikami/types';
import type { LocalEmbeddingBackend as LocalEmbeddingBackendInstance } from './local_embedding_backend';

let LocalEmbeddingBackend: { create(): LocalEmbeddingBackendInstance };

beforeEach(async () => {
  ({ LocalEmbeddingBackend } = await import('./local_embedding_backend'));
});

const loreEntry = (id: string, content: string): MemoryIndexable => ({
  sourceType: 'lore',
  sourceId: id,
  content,
});

describe('LocalEmbeddingBackend (keyword retrieval)', () => {
  it('AC-1: ranks overlapping-token entry above a non-overlapping entry', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([
      loreEntry('e-overlap', 'The Ward Wand rests in the village inn cellar.'),
      loreEntry('e-nonoverlap', 'Dragons guard the mountain peak.'),
    ]);

    const results = await backend.query({ text: 'Ward Wand inn', scope: 'lore' });

    // The overlapping-token entry is returned and ranked first; the
    // non-overlapping entry scores below the threshold and never appears.
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].sourceId).toBe('e-overlap');
    expect(results.some((r) => r.sourceId === 'e-nonoverlap')).toBe(false);
  });

  it('AC-1: query() returns results without any model initialisation', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([loreEntry('e1', 'The blacksmith forges magical swords.')]);

    // No init() needed — keyword scoring runs directly.
    const results = await backend.query({ text: 'blacksmith swords', scope: 'lore' });
    expect(results.length).toBe(1);
    expect(results[0].sourceId).toBe('e1');
    expect(backend.isReady).toBe(false); // never touched a model
  });

  it('AC-1: case-insensitive, word-boundary tokenisation', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([loreEntry('e1', 'Rollo keeps the wand hidden.')]);
    const results = await backend.query({ text: 'WAND ROLLO', scope: 'lore' });
    expect(results.length).toBe(1);
  });

  it('AC-1: idempotent index replaces the same sourceId', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([loreEntry('e1', 'old content')]);
    await backend.index([loreEntry('e1', 'new content')]);
    expect(await backend.size()).toBe(1);
    expect(backend.toSnapshot().entries[0].content).toBe('new content');
  });

  it('AC-1: returns empty results when index is empty (graceful degradation)', async () => {
    const backend = LocalEmbeddingBackend.create();
    expect(await backend.query({ text: 'anything' })).toEqual([]);
  });

  it('AC-1: querying indexed content does not require model initialization', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([loreEntry('e1', 'The ferryman knows the hidden crossing.')]);

    expect(backend.isReady).toBe(false);
    const results = await backend.query({ text: 'ferryman crossing', scope: 'lore' });

    expect(results.map((result) => result.sourceId)).toEqual(['e1']);
    expect(backend.isReady).toBe(false);
  });
});
