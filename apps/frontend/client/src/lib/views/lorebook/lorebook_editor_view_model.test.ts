// apps/frontend/client/src/lib/views/lorebook/lorebook_editor_view_model.test.ts
//
// Unit tests for LorebookEditorViewModel — entry CRUD, keyword chip
// management, constant toggle, reorder, and generator output validation.

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Lorebook, LorebookEntry, LorebookEntryInput } from '$types/lorebook';

// ---------------------------------------------------------------------------
// In-memory lorebook store (mirrors real store, avoids $state/Bun issues)
// ---------------------------------------------------------------------------

const _createInMemoryStore = () => {
  const lorebooks: Lorebook[] = [];
  const _getIndex = (id: string): number => lorebooks.findIndex((lb) => lb.id === id);
  const _get = (id: string): Lorebook | undefined => lorebooks.find((lb) => lb.id === id);
  const _now = (): string => new Date().toISOString();

  return {
    get lorebooks(): Lorebook[] {
      return lorebooks;
    },
    addLorebook(name: string, description: string): string {
      const id = crypto.randomUUID();
      const now = _now();
      lorebooks.push({ id, name, description, entries: [], createdAt: now, updatedAt: now });
      return id;
    },
    updateLorebook(id: string, patch: Partial<Pick<Lorebook, 'name' | 'description'>>): void {
      const lb = _get(id);
      if (lb) {
        Object.assign(lb, patch, { updatedAt: _now() });
      }
    },
    deleteLorebook(id: string): void {
      const idx = _getIndex(id);
      if (idx >= 0) {
        lorebooks.splice(idx, 1);
      }
    },
    addEntry(
      lorebookId: string,
      entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>,
    ): string {
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
    updateEntry(
      lorebookId: string,
      entryId: string,
      patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>,
    ): void {
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
    deleteEntry(lorebookId: string, entryId: string): void {
      const lb = _get(lorebookId);
      if (lb) {
        lb.entries = lb.entries.filter((e) => e.id !== entryId);
      }
    },
    reorderEntries(lorebookId: string, entryIds: string[]): void {
      const lb = _get(lorebookId);
      if (lb) {
        const entryMap = new Map(lb.entries.map((e) => [e.id, e]));
        lb.entries = entryIds
          .map((id) => entryMap.get(id))
          .filter((e): e is LorebookEntry => e !== undefined);
      }
    },
    getLorebook(id: string): Lorebook | undefined {
      return _get(id);
    },
  };
};

// ---------------------------------------------------------------------------
// ViewModel-like logic (extracted from LorebookEditorViewModel, no Svelte runes)
// ---------------------------------------------------------------------------

const _createViewModel = (store: ReturnType<typeof _createInMemoryStore>) => {
  let selectedLorebookId: string | undefined;
  let lorebookName = '';
  let _lorebookDescription = '';
  let entryKeywordInput = '';
  let entryContent = '';
  let entryPriority = 0;
  let entryConstant = false;
  let editingEntryId: string | undefined;
  let generatedEntries: LorebookEntryInput[] = [];

  const _selectedLorebook = (): Lorebook | undefined =>
    selectedLorebookId ? store.lorebooks.find((lb) => lb.id === selectedLorebookId) : undefined;

  const _entries = (): LorebookEntry[] => _selectedLorebook()?.entries ?? [];

  const _parseKeywords = (input: string): string[] =>
    input
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

  const _resetEntryForm = (): void => {
    entryKeywordInput = '';
    entryContent = '';
    entryPriority = 0;
    entryConstant = false;
    editingEntryId = undefined;
  };

  return {
    get selectedLorebookId(): string | undefined {
      return selectedLorebookId;
    },
    get lorebookName(): string {
      return lorebookName;
    },
    get entries(): LorebookEntry[] {
      return _entries();
    },
    get generatedEntries(): LorebookEntryInput[] {
      return generatedEntries;
    },
    selectLorebook(id: string): void {
      selectedLorebookId = id;
      const lb = _selectedLorebook();
      if (lb) {
        lorebookName = lb.name;
        _lorebookDescription = lb.description;
      }
      _resetEntryForm();
    },
    createLorebook(name: string, description: string): string {
      const trimmed = name.trim();
      if (!trimmed) {
        return '';
      }
      const id = store.addLorebook(trimmed, description.trim());
      selectedLorebookId = id;
      lorebookName = trimmed;
      _lorebookDescription = description.trim();
      return id;
    },
    deleteSelectedLorebook(): void {
      if (selectedLorebookId) {
        store.deleteLorebook(selectedLorebookId);
        selectedLorebookId = undefined;
        lorebookName = '';
        _lorebookDescription = '';
        _resetEntryForm();
      }
    },
    saveEntry(): string | undefined {
      if (!selectedLorebookId) {
        return undefined;
      }
      const keywords = _parseKeywords(entryKeywordInput);
      if (keywords.length === 0 && !entryConstant) {
        return undefined;
      }
      if (!entryContent.trim()) {
        return undefined;
      }

      if (editingEntryId) {
        store.updateEntry(selectedLorebookId, editingEntryId, {
          keywords,
          content: entryContent.trim(),
          priority: entryPriority,
          constant: entryConstant,
        });
        _resetEntryForm();
        return editingEntryId;
      }

      const id = store.addEntry(selectedLorebookId, {
        keywords,
        content: entryContent.trim(),
        priority: entryPriority,
        constant: entryConstant,
      });
      _resetEntryForm();
      return id;
    },
    startEditingEntry(entryId: string): void {
      const entry = _entries().find((e) => e.id === entryId);
      if (entry) {
        editingEntryId = entryId;
        entryKeywordInput = entry.keywords.join(', ');
        entryContent = entry.content;
        entryPriority = entry.priority;
        entryConstant = entry.constant;
      }
    },
    cancelEditingEntry(): void {
      _resetEntryForm();
    },
    deleteEntry(entryId: string): void {
      if (selectedLorebookId) {
        store.deleteEntry(selectedLorebookId, entryId);
      }
    },
    reorderEntries(entryIds: string[]): void {
      if (selectedLorebookId) {
        store.reorderEntries(selectedLorebookId, entryIds);
      }
    },
    acceptGeneratedEntries(entries: LorebookEntryInput[]): void {
      if (selectedLorebookId) {
        for (const e of entries) {
          store.addEntry(selectedLorebookId, {
            keywords: e.keywords,
            content: e.content,
            priority: e.priority ?? 0,
            constant: e.constant ?? false,
          });
        }
      }
      generatedEntries = [];
    },
    setEntryKeywordInput(v: string): void {
      entryKeywordInput = v;
    },
    setEntryContent(v: string): void {
      entryContent = v;
    },
    setEntryPriority(v: number): void {
      entryPriority = v;
    },
    setEntryConstant(v: boolean): void {
      entryConstant = v;
    },
    setGeneratedEntries(entries: LorebookEntryInput[]): void {
      generatedEntries = entries;
    },
    get editingEntryId(): string | undefined {
      return editingEntryId;
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LorebookEditorViewModel', () => {
  let store: ReturnType<typeof _createInMemoryStore>;
  let vm: ReturnType<typeof _createViewModel>;

  beforeEach(() => {
    store = _createInMemoryStore();
    vm = _createViewModel(store);
  });

  describe('CRUD: lorebooks', () => {
    it('creates a new lorebook and selects it', () => {
      const id = vm.createLorebook('My Lore', 'Description');

      expect(id).toBeString();
      expect(vm.selectedLorebookId).toBe(id);
      expect(vm.lorebookName).toBe('My Lore');
    });

    it('selects an existing lorebook', () => {
      const id = store.addLorebook('Existing', '');

      vm.selectLorebook(id);

      expect(vm.selectedLorebookId).toBe(id);
      expect(vm.lorebookName).toBe('Existing');
    });

    it('deletes a selected lorebook', () => {
      const _id = vm.createLorebook('To Delete', '');

      vm.deleteSelectedLorebook();

      expect(vm.selectedLorebookId).toBeUndefined();
      expect(store.lorebooks).toHaveLength(0);
    });
  });

  describe('CRUD: entries', () => {
    it('adds an entry to a lorebook', () => {
      const _lbId = vm.createLorebook('Test', '');
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
      const _lbId = vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Old content');
      const entryId = vm.saveEntry() as string;

      vm.startEditingEntry(entryId);
      vm.setEntryContent('New content');
      vm.setEntryPriority(5);
      vm.saveEntry();

      expect(vm.entries[0].content).toBe('New content');
      expect(vm.entries[0].priority).toBe(5);
      expect(vm.editingEntryId).toBeUndefined(); // form reset
    });

    it('deletes an entry', () => {
      const _lbId = vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Content');
      const entryId = vm.saveEntry() as string;
      expect(vm.entries).toHaveLength(1);

      vm.deleteEntry(entryId);

      expect(vm.entries).toHaveLength(0);
    });

    it('reorders entries', () => {
      const _lbId = vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('a');
      vm.setEntryContent('First');
      const e1 = vm.saveEntry() as string;
      vm.setEntryKeywordInput('b');
      vm.setEntryContent('Second');
      const e2 = vm.saveEntry() as string;

      vm.reorderEntries([e2, e1]);

      expect(vm.entries[0].id).toBe(e2);
      expect(vm.entries[1].id).toBe(e1);
    });

    it('cancels editing and resets form', () => {
      const _lbId = vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Content');
      const entryId = vm.saveEntry() as string;

      vm.startEditingEntry(entryId);
      vm.setEntryContent('Changed');
      vm.cancelEditingEntry();

      // Entry should be unchanged
      expect(vm.entries[0].content).toBe('Content');
      expect(vm.editingEntryId).toBeUndefined();
    });
  });

  describe('keyword chip management', () => {
    it('parses comma-separated keywords into array', () => {
      vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('goblin, orc, dragon');
      vm.setEntryContent('Content');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc', 'dragon']);
    });

    it('trims whitespace from keywords', () => {
      vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('  goblin , orc  ,dragon');
      vm.setEntryContent('Content');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc', 'dragon']);
    });

    it('filters empty keywords', () => {
      vm.createLorebook('Test', '');
      vm.setEntryKeywordInput('goblin,, , orc,');
      vm.setEntryContent('Content');
      vm.saveEntry();

      expect(vm.entries[0].keywords).toEqual(['goblin', 'orc']);
    });
  });

  describe('constant toggle', () => {
    it('saves constant=true entries', () => {
      vm.createLorebook('Test', '');
      vm.setEntryConstant(true);
      vm.setEntryContent('Always present');
      vm.saveEntry();

      expect(vm.entries[0].constant).toBe(true);
      expect(vm.entries[0].keywords).toEqual([]);
    });

    it('saves constant=false entries', () => {
      vm.createLorebook('Test', '');
      vm.setEntryConstant(false);
      vm.setEntryKeywordInput('goblin');
      vm.setEntryContent('Goblin lore');
      vm.saveEntry();

      expect(vm.entries[0].constant).toBe(false);
    });
  });

  describe('generator output validation', () => {
    it('accepts generated entries into the selected lorebook', () => {
      vm.createLorebook('Test', '');
      const generated: LorebookEntryInput[] = [
        { keywords: ['goblin'], content: 'Goblin lore' },
        { keywords: ['dragon'], content: 'Dragon lore', priority: 3, constant: true },
      ];

      vm.acceptGeneratedEntries(generated);

      expect(vm.entries).toHaveLength(2);
      expect(vm.entries[0].keywords).toEqual(['goblin']);
      expect(vm.entries[1].constant).toBe(true);
      expect(vm.entries[1].priority).toBe(3);
    });

    it('clears generated entries without saving', () => {
      vm.setGeneratedEntries([{ keywords: ['goblin'], content: 'Test' }]);
      expect(vm.generatedEntries).toHaveLength(1);

      vm.setGeneratedEntries([]);

      expect(vm.generatedEntries).toHaveLength(0);
    });
  });
});
