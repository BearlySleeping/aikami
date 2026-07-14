// apps/frontend/client/src/lib/services/chat/choice_history_store.svelte.ts
//
// Reactive per-chat store for CYOA choice history. Tracks which choices
// the player selected so the GM prompt can reference past decisions.
// History is capped per chat to avoid prompt bloat and survives
// client-side navigation (module singleton, not route-scoped).
//
// Contract: C-245 CYOA Choices Branching Narrative

import { CYOA_HISTORY_CAP, CYOA_HISTORY_HEADING } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { CyoaChoiceHistoryEntry } from '@aikami/types';

// ── Service Interface ────────────────────────────────────────────────────

export type ChoiceHistoryStoreOptions = BaseFrontendClassOptions;

export type ChoiceHistoryStoreInterface = BaseFrontendClassInterface & {
  /**
   * Records a selected choice for the given chat. Oldest entries are
   * evicted once the per-chat cap is exceeded.
   *
   * @param options.chatId - The chat the choice belongs to.
   * @param options.entry - The choice history entry to record.
   */
  recordChoice(options: { chatId: string; entry: CyoaChoiceHistoryEntry }): void;

  /**
   * Returns the recorded choices for a chat (oldest first), capped at
   * the last CYOA_HISTORY_CAP entries.
   */
  getHistory(chatId: string): ReadonlyArray<CyoaChoiceHistoryEntry>;

  /**
   * Formats the chat's choice history as a GM prompt section.
   * Returns an empty string when there is no history.
   */
  formatHistorySection(chatId: string): string;

  /** Clears the history for a single chat. */
  clearHistory(chatId: string): void;
};

// ── Implementation ───────────────────────────────────────────────────────

class ChoiceHistoryStore
  extends BaseFrontendClass<ChoiceHistoryStoreOptions>
  implements ChoiceHistoryStoreInterface
{
  /** Per-chat choice history — chatId → ordered entries (oldest first). */
  private _history = $state<Map<string, CyoaChoiceHistoryEntry[]>>(new Map());

  /** @inheritdoc */
  recordChoice({ chatId, entry }: { chatId: string; entry: CyoaChoiceHistoryEntry }): void {
    const existing = this._history.get(chatId) ?? [];
    const next = [...existing, entry].slice(-CYOA_HISTORY_CAP);

    // Reassign the Map to trigger Svelte 5 reactivity
    const updated = new Map(this._history);
    updated.set(chatId, next);
    this._history = updated;
  }

  /** @inheritdoc */
  getHistory(chatId: string): ReadonlyArray<CyoaChoiceHistoryEntry> {
    return this._history.get(chatId) ?? [];
  }

  /** @inheritdoc */
  formatHistorySection(chatId: string): string {
    const entries = this.getHistory(chatId);
    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = [CYOA_HISTORY_HEADING];
    for (const entry of entries) {
      const suffix = entry.context ? ` (${entry.context})` : '';
      lines.push(`- ${entry.label}${suffix}`);
    }

    return lines.join('\n');
  }

  /** @inheritdoc */
  clearHistory(chatId: string): void {
    if (!this._history.has(chatId)) {
      return;
    }
    const updated = new Map(this._history);
    updated.delete(chatId);
    this._history = updated;
  }
}

export { ChoiceHistoryStore };

/**
 * Shared singleton instance of the choice history store.
 */
export const choiceHistoryStore: ChoiceHistoryStoreInterface = ChoiceHistoryStore.create({
  className: 'ChoiceHistoryStore',
}) as ChoiceHistoryStoreInterface;
