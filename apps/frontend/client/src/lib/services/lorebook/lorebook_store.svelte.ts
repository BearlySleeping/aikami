// apps/frontend/client/src/lib/services/lorebook/lorebook_store.svelte.ts
//
// Singleton service providing reactive lorebook CRUD and keyword scanning.
// Thin wrapper over ConfigService — delegates all persistence.
// Token budget enforcement: warns >2KB, caps at 5KB.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { configService } from '$services';
import type { KeywordMatch, Lorebook, LorebookEntry } from '$types';
import { scanKeywords } from './keyword_scanner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Soft warning threshold for world info token budget in bytes. */
const TOKEN_BUDGET_WARN = 2048;
/** Hard cap for world info token budget in bytes. */
const TOKEN_BUDGET_CAP = 5120;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LorebookStoreOptions = BaseFrontendClassOptions;

export type LorebookStoreInterface = BaseFrontendClassInterface & {
  /** Reactive list of all lorebooks. */
  readonly lorebooks: Lorebook[];

  /** IDs of lorebooks assigned to the active chat session. */
  readonly activeLorebookIds: string[];

  /**
   * Scans the user message against all entries in the active lorebooks.
   * Entries are matched via keyword_scanner, counted toward a token budget,
   * and returned sorted by priority.
   *
   * @returns Deduplicated, priority-sorted keyword matches.
   */
  scanActiveEntries: (options: { message: string }) => KeywordMatch[];

  // ── Lorebook CRUD (delegates to ConfigService) ────────────────────

  /** Creates a new lorebook. Returns the new ID. */
  addLorebook: (options: { name: string; description: string }) => string;

  /** Updates a lorebook's name or description. */
  updateLorebook: (options: {
    id: string;
    patch: Partial<Pick<Lorebook, 'name' | 'description'>>;
  }) => void;

  /** Deletes a lorebook and all its entries. */
  deleteLorebook: (options: { id: string }) => void;

  /** Adds an entry to a lorebook. Returns the entry ID. */
  addEntry: (options: {
    lorebookId: string;
    entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>;
  }) => string;

  /** Updates an entry within a lorebook. */
  updateEntry: (options: {
    lorebookId: string;
    entryId: string;
    patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>;
  }) => void;

  /** Deletes an entry from a lorebook. */
  deleteEntry: (options: { lorebookId: string; entryId: string }) => void;

  /** Reorders entries within a lorebook. */
  reorderEntries: (options: { lorebookId: string; entryIds: string[] }) => void;

  /** Sets the lorebook IDs assigned to the active chat session. */
  setActiveLorebookIds: (options: { ids: string[] }) => void;
};

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class LorebookStore
  extends BaseFrontendClass<LorebookStoreOptions>
  implements LorebookStoreInterface
{
  /** Reactive list of all lorebooks from ConfigService. */
  get lorebooks(): Lorebook[] {
    return configService.state.lorebooks;
  }

  /** Reactive list of active lorebook IDs. */
  get activeLorebookIds(): string[] {
    return configService.state.activeLorebookIds;
  }

  // ── Keyword scanning ─────────────────────────────────────────────────

  scanActiveEntries(options: { message: string }): KeywordMatch[] {
    const { message } = options;

    if (!message.trim()) {
      return [];
    }

    // Collect entries from all active lorebooks
    const activeIds = new Set(this.activeLorebookIds);
    const entries: LorebookEntry[] = [];
    for (const lb of this.lorebooks) {
      if (activeIds.has(lb.id)) {
        entries.push(...lb.entries);
      }
    }

    if (entries.length === 0) {
      return [];
    }

    // Run keyword scanner
    let matches = scanKeywords({ entries, message });

    // Token budget enforcement
    const encoder = new TextEncoder();
    let totalBytes = 0;
    const withinBudget: KeywordMatch[] = [];
    let warned = false;

    for (const match of matches) {
      const entryBytes = encoder.encode(match.entry.content).length;
      totalBytes += entryBytes;

      if (totalBytes > TOKEN_BUDGET_CAP) {
        this.warn('scanActiveEntries:token-budget-exceeded', {
          totalBytes,
          cap: TOKEN_BUDGET_CAP,
          matchesDropped: matches.length - withinBudget.length,
        });
        break;
      }

      if (totalBytes > TOKEN_BUDGET_WARN && !warned) {
        warned = true;
        this.debug('scanActiveEntries:token-budget-warning', {
          totalBytes,
          warn: TOKEN_BUDGET_WARN,
        });
      }

      withinBudget.push(match);
    }

    return withinBudget;
  }

  // ── Lorebook CRUD ────────────────────────────────────────────────────

  addLorebook(options: { name: string; description: string }): string {
    return configService.addLorebook(options);
  }

  updateLorebook(options: {
    id: string;
    patch: Partial<Pick<Lorebook, 'name' | 'description'>>;
  }): void {
    configService.updateLorebook(options);
  }

  deleteLorebook(options: { id: string }): void {
    configService.deleteLorebook(options);
  }

  addEntry(options: {
    lorebookId: string;
    entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>;
  }): string {
    return configService.addEntry(options);
  }

  updateEntry(options: {
    lorebookId: string;
    entryId: string;
    patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>;
  }): void {
    configService.updateEntry(options);
  }

  deleteEntry(options: { lorebookId: string; entryId: string }): void {
    configService.deleteEntry(options);
  }

  reorderEntries(options: { lorebookId: string; entryIds: string[] }): void {
    configService.reorderEntries(options);
  }

  setActiveLorebookIds(options: { ids: string[] }): void {
    configService.setActiveLorebookIds(options);
  }
}

export { LorebookStore };

/**
 * Shared singleton instance of the lorebook store.
 */
export const lorebookStore: LorebookStoreInterface = LorebookStore.create({
  className: 'LorebookStore',
}) as LorebookStoreInterface;
