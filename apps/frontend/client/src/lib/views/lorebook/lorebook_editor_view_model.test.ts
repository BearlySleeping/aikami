// apps/frontend/client/src/lib/views/lorebook/lorebook_editor_view_model.test.ts
//
// Unit tests for LorebookEditorViewModel — entry CRUD, keyword chip
// management, constant toggle, reorder, and generator output validation.
// The lorebook store is an injected capability, so no global `$services`
// mock is required.

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Lorebook, LorebookEntry, LorebookEntryInput } from '$types/lorebook';
import {
  createLorebookEditorViewModel,
  type LorebookEditorStoreCapabilities,
  type LorebookEditorViewModelInterface,
} from './lorebook_editor_view_model.svelte';

// ---------------------------------------------------------------------------
// In-memory lorebook store fixture
// ---------------------------------------------------------------------------

const createInMemoryStore = (): LorebookEditorStoreCapabilities => {
  const lorebooks: Lorebook[] = [];
  const _get = (id: string): Lorebook | undefined => lorebooks.find((lb) => lb.id === id);
  const _now = (): string => new Date().toISOString();

  return {
    get lorebooks(): Lorebook[] {
      return lorebooks;
    },
    addLorebook({ name, description }): string {
      const id = crypto.randomUUID();
      const now = _now();
      lorebooks.push({ id, name, description, entries: [], createdAt: now, updatedAt: now });
      return id;
    },
    updateLorebook({ id, patch }): void {
      const lb = _get(id);
      if (lb) {
        Object.assign(lb, patch, { updatedAt: _now() });
      }
    },
    deleteLorebook({ id }): void {
      const idx = lorebooks.findIndex((lb) => lb.id === id);
      if (idx >= 0) {
        lorebooks.splice(idx, 1);
      }
    },
    addEntry({ lorebookId, entry }): string {
      const lb = _get(lorebookId);
      if (!lb) {
        return '';
      }
      const id = crypto.randomUUID();
      const now = _now();
      lb.entries.push({ ...entry, id, createdAt: now, updatedAt: now });
      lb.updatedAt = now;
      return id;
    },
    updateEntry({ lorebookId, entryId, patch }): void {
      const lb = _get(lorebookId);
      if (lb) {
        const now = _now();
        for (const e of lb.entries) {
          if (e.id === entryId) {
            Object.assign(e, patch, { updatedAt: now });
            lb.updatedAt = now;
            break;
          }
        }
      }
    },
    deleteEntry({ lorebookId, entryId }): void {
      const lb = _get(lorebookId);
      if (lb) {
        lb.entries = lb.entries.filter((e) => e.id !== entryId);
      }
    },
    reorderEntries({ lorebookId, entryIds }): void {
      const lb = _get(lorebookId);
      if (lb) {
        const entryMap = new Map(lb.entries.map((e) => [e.id, e]));
        lb.entries = entryIds
          .map((id) => entryMap.get(id))
          .filter((e): e is LorebookEntry => e !== undefined);
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LorebookEditorViewModel', () => {
  let store: LorebookEditorStoreCapabilities;
  let vm: LorebookEditorViewModelInterface;

  beforeEach(() => {
    store = createInMemoryStore();
    vm = createLorebookEditorViewModel({ className: 'LorebookEditorViewModelTest', store });
  });

  describe('CRUD: lorebooks', () => {
    it('creates a new lorebook and selects it', () => {
      vm.setLorebookName('My Lore');
      vm.setLorebookDescription('Description');

      const id = vm.createLorebook();

      expect(id).toBeString();
      expect(vm.selectedLorebookId).toBe(id);
      expect(vm.lorebookName).toBe('My Lore');
    });

    it('selects an existing lorebook', () => {
      const id = store.addLorebook({ name: 'Existing', description: '' });

      vm.selectLorebook({ id });

      expect(vm.selectedLorebookId).toBe(id);
      expect(vm.lorebookName).toBe('Existing');
    });

    it('deletes a selected lorebook', () => {
      vm.setLorebookName('To Delete');
      vm.createLorebook();

      vm.deleteSelectedLorebook();

      expect(vm.selectedLorebookId).toBeUndefined();
      expect(store.lorebooks).toHaveLength(0);
    });
  });

  describe('CRUD: entries', () => {
    it('adds an entry to a lorebook', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('goblin, orc');
      vm.setEntryContent('Common enemies');
      vm.setEntryPriority(3);

      const entryId = vm.saveEntry();

      expect(entryId).toBeString();
      expect(vm.entries).toHaveLength(1);
      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc']);
      expect(vm.entries[0].content).toBe('Common enemies');
      expect(vm.entries[0].priority).toBe(3);
    });

    it('edits an existing entry', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Old content');
      const entryId = vm.saveEntry() as string;

      vm.startEditingEntry({ entryId });
      vm.setEntryContent('New content');
      vm.setEntryPriority(5);
      vm.saveEntry();

      expect(vm.entries[0].content).toBe('New content');
      expect(vm.entries[0].priority).toBe(5);
      expect(vm.editingEntryId).toBeUndefined(); // form reset
    });

    it('deletes an entry', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Content');
      const entryId = vm.saveEntry() as string;
      expect(vm.entries).toHaveLength(1);

      vm.deleteEntry({ entryId });

      expect(vm.entries).toHaveLength(0);
    });

    it('reorders entries', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('a');
      vm.setEntryContent('First');
      const e1 = vm.saveEntry() as string;
      vm.setEntryKeywordInput('b');
      vm.setEntryContent('Second');
      const e2 = vm.saveEntry() as string;

      vm.reorderEntries({ entryIds: [e2, e1] });

      expect(vm.entries[0].id).toBe(e2);
      expect(vm.entries[1].id).toBe(e1);
    });

    it('cancels editing and resets form', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Content');
      const entryId = vm.saveEntry() as string;

      vm.startEditingEntry({ entryId });
      vm.setEntryContent('Changed');
      vm.cancelEditingEntry();

      // Entry should be unchanged
      expect(vm.entries[0].content).toBe('Content');
      expect(vm.editingEntryId).toBeUndefined();
    });
  });

  describe('keyword chip management', () => {
    beforeEach(() => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryContent('Content');
    });

    it('parses comma-separated keywords into array', () => {
      vm.setEntryKeywordInput('goblin, orc, dragon');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc', 'dragon']);
    });

    it('trims whitespace from keywords', () => {
      vm.setEntryKeywordInput('  goblin , orc  ,dragon');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc', 'dragon']);
    });

    it('filters empty keywords', () => {
      vm.setEntryKeywordInput('goblin,, , orc,');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc']);
    });
  });

  describe('constant toggle', () => {
    it('saves constant=true entries', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.toggleEntryConstant();
      vm.setEntryContent('Always present');
      vm.saveEntry();

      expect(vm.entries[0].constant).toBe(true);
      expect(vm.entries[0].keywords).toEqual([]);
    });

    it('saves constant=false entries', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Goblin lore');
      vm.saveEntry();

      expect(vm.entries[0].constant).toBe(false);
    });
  });

  describe('generator output validation', () => {
    it('accepts generated entries into the selected lorebook and clears the preview', () => {
      vm.setLorebookName('Test');
      vm.createLorebook();
      const generated: LorebookEntryInput[] = [
        { keywords: ['goblin'], content: 'Goblin lore' },
        { keywords: ['dragon'], content: 'Dragon lore', priority: 3, constant: true },
      ];

      vm.acceptGeneratedEntries(generated);

      expect(vm.entries).toHaveLength(2);
      expect(vm.entries[0].keywords).toEqual(['goblin']);
      expect(vm.entries[1].constant).toBe(true);
      expect(vm.entries[1].priority).toBe(3);
      expect(vm.generatedEntries).toHaveLength(0);
    });

    it('clears generated entries without saving', () => {
      vm.clearGeneratedEntries();

      expect(vm.generatedEntries).toHaveLength(0);
    });
  });
});
