// apps/frontend/client/src/lib/services/lorebook/lorebook_store.test.ts
//
// Unit tests for LorebookStore-like logic — CRUD operations on in-memory
// state and integration with the real keyword_scanner.
// Avoids importing services that depend on Svelte 5 $state runes (unavailable in Bun).

import { describe, expect, it } from 'bun:test';
import type { KeywordMatch, Lorebook, LorebookEntry } from '$types/lorebook';
import { scanKeywords } from './keyword_scanner';

// ---------------------------------------------------------------------------
// In-memory lorebook store (mirrors LorebookStore logic without BaseFrontendClass)
// ---------------------------------------------------------------------------

const _createInMemoryStore = () => {
  const lorebooks: Lorebook[] = [];
  const activeIds = new Set<string>();

  const addLorebook = (name: string, description: string): string => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    lorebooks.push({ id, name, description, entries: [], createdAt: now, updatedAt: now });
    return id;
  };

  const addEntry = (
    lorebookId: string,
    entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): string => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const lb = lorebooks.find((l) => l.id === lorebookId);
    if (lb) {
      lb.entries.push({ ...entry, id, createdAt: now, updatedAt: now });
      lb.updatedAt = now;
    }
    return id;
  };

  const getLorebook = (id: string): Lorebook | undefined => lorebooks.find((lb) => lb.id === id);

  const updateEntry = (
    lorebookId: string,
    entryId: string,
    patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>,
  ): void => {
    const lb = lorebooks.find((l) => l.id === lorebookId);
    if (lb) {
      const now = new Date().toISOString();
      for (const e of lb.entries) {
        if (e.id === entryId) {
          Object.assign(e, patch, { updatedAt: now });
          lb.updatedAt = now;
          break;
        }
      }
    }
  };

  const deleteEntry = (lorebookId: string, entryId: string): void => {
    const lb = lorebooks.find((l) => l.id === lorebookId);
    if (lb) {
      lb.entries = lb.entries.filter((e) => e.id !== entryId);
    }
  };

  const reorderEntries = (lorebookId: string, entryIds: string[]): void => {
    const lb = lorebooks.find((l) => l.id === lorebookId);
    if (lb) {
      const entryMap = new Map(lb.entries.map((e) => [e.id, e]));
      lb.entries = entryIds
        .map((id) => entryMap.get(id))
        .filter((e): e is LorebookEntry => e !== undefined);
    }
  };

  const setActive = (ids: string[]): void => {
    activeIds.clear();
    for (const id of ids) {
      activeIds.add(id);
    }
  };

  const scanActiveEntries = (message: string): KeywordMatch[] => {
    if (!message.trim()) {
      return [];
    }

    const entries: LorebookEntry[] = [];
    for (const lb of lorebooks) {
      if (activeIds.has(lb.id)) {
        entries.push(...lb.entries);
      }
    }

    if (entries.length === 0) {
      return [];
    }

    return scanKeywords({ entries, message });
  };

  return {
    lorebooks,
    addLorebook,
    addEntry,
    getLorebook,
    updateEntry,
    deleteEntry,
    reorderEntries,
    setActive,
    scanActiveEntries,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LorebookStore', () => {
  describe('CRUD: lorebooks', () => {
    it('creates a lorebook', () => {
      const store = _createInMemoryStore();
      const id = store.addLorebook('My Lore', 'Test');

      expect(id).toBeString();
      expect(store.lorebooks).toHaveLength(1);
      expect(store.lorebooks[0].name).toBe('My Lore');
      expect(store.lorebooks[0].entries).toEqual([]);
    });

    it('creates multiple lorebooks', () => {
      const store = _createInMemoryStore();
      store.addLorebook('A', '');
      store.addLorebook('B', '');

      expect(store.lorebooks).toHaveLength(2);
    });
  });

  describe('CRUD: entries', () => {
    it('adds an entry to a lorebook', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      const entryId = store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Goblin lore',
        priority: 0,
        constant: false,
      });

      expect(entryId).toBeString();
      const lb = store.getLorebook(lbId);
      expect(lb?.entries).toHaveLength(1);
      expect(lb?.entries[0].keywords).toEqual(['goblin']);
      expect(lb?.entries[0].content).toBe('Goblin lore');
    });

    it('updates an entry', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      const entryId = store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Old',
        priority: 0,
        constant: false,
      });

      store.updateEntry(lbId, entryId, { content: 'New', priority: 5 });

      const lb = store.getLorebook(lbId);
      expect(lb?.entries[0].content).toBe('New');
      expect(lb?.entries[0].priority).toBe(5);
    });

    it('deletes an entry', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      const entryId = store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Content',
        priority: 0,
        constant: false,
      });
      expect(store.getLorebook(lbId)?.entries).toHaveLength(1);

      store.deleteEntry(lbId, entryId);

      expect(store.getLorebook(lbId)?.entries).toHaveLength(0);
    });

    it('reorders entries', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      const e1 = store.addEntry(lbId, {
        keywords: ['a'],
        content: 'First',
        priority: 0,
        constant: false,
      });
      const e2 = store.addEntry(lbId, {
        keywords: ['b'],
        content: 'Second',
        priority: 0,
        constant: false,
      });

      store.reorderEntries(lbId, [e2, e1]);

      const lb = store.getLorebook(lbId);
      expect(lb?.entries[0].id).toBe(e2);
      expect(lb?.entries[1].id).toBe(e1);
    });
  });

  describe('scanActiveEntries (integration with keyword_scanner)', () => {
    it('returns matches for active lorebook entries', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Goblin lore',
        priority: 0,
        constant: false,
      });
      store.setActive([lbId]);

      const matches = store.scanActiveEntries('I see a goblin');

      expect(matches).toHaveLength(1);
      expect(matches[0].entry.content).toBe('Goblin lore');
      expect(matches[0].matchReason).toBe("matched: 'goblin'");
    });

    it('returns empty when no lorebooks are active', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Lore',
        priority: 0,
        constant: false,
      });

      const matches = store.scanActiveEntries('goblin');

      expect(matches).toHaveLength(0);
    });

    it('returns empty for empty message', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      store.addEntry(lbId, {
        keywords: ['goblin'],
        content: 'Lore',
        priority: 0,
        constant: false,
      });
      store.setActive([lbId]);

      const matches = store.scanActiveEntries('');

      expect(matches).toHaveLength(0);
    });

    it('includes constant entries even without keyword match', () => {
      const store = _createInMemoryStore();
      const lbId = store.addLorebook('Test', '');
      store.addEntry(lbId, {
        keywords: [],
        content: 'Always included',
        priority: 0,
        constant: true,
      });
      store.setActive([lbId]);

      const matches = store.scanActiveEntries('hello world');

      expect(matches).toHaveLength(1);
      expect(matches[0].matchReason).toBe('constant');
    });

    it('only scans active lorebooks, not all', () => {
      const store = _createInMemoryStore();
      const lb1 = store.addLorebook('Active', '');
      const lb2 = store.addLorebook('Inactive', '');

      store.addEntry(lb1, {
        keywords: ['dragon'],
        content: 'Active dragon lore',
        priority: 0,
        constant: false,
      });
      store.addEntry(lb2, {
        keywords: ['dragon'],
        content: 'Inactive dragon lore',
        priority: 0,
        constant: false,
      });
      store.setActive([lb1]);

      const matches = store.scanActiveEntries('a dragon appears');

      expect(matches).toHaveLength(1);
      expect(matches[0].entry.content).toBe('Active dragon lore');
    });
  });
});
