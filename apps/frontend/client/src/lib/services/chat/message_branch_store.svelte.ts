// apps/frontend/client/src/lib/services/chat/message_branch_store.svelte.ts
//
// Reactive store for message alternative (branching/swiping) tracking.
// Each AI message can have multiple alternative responses stored as an
// array of text strings. The active alternative index controls which
// response is displayed.
//
// Contract: C-231 AC-1 Message Branching & Swiping

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { EnhancedChatMessage, MessageAlternatives } from '$types/rich_chat';

// ── Constants ────────────────────────────────────────────────────────────

/** Maximum alternatives stored per message to prevent IndexedDB bloat. */
const MAX_ALTERNATIVES = 20;

// ── Service Interface ────────────────────────────────────────────────────

export type MessageBranchStoreOptions = BaseFrontendClassOptions;

export type MessageBranchStoreInterface = BaseFrontendClassInterface & {
  /** Map of message ID → alternative tracking data. */
  readonly alternatives: ReadonlyMap<string, MessageAlternatives>;

  /**
   * Adds a new alternative text for the given message.
   * If the message has no existing alternatives, creates a new entry
   * with the current text as the first alternative.
   *
   * @param options.messageId — The message to add an alternative to.
   * @param options.currentText — The text that was displayed before regeneration.
   * @param options.newText — The newly generated alternative text.
   */
  addAlternative(options: { messageId: string; currentText: string; newText: string }): void;

  /**
   * Switches the active alternative for a message.
   *
   * @param options.messageId — The message to switch.
   * @param options.direction — 'left' for previous, 'right' for next.
   */
  swipeAlternative(options: { messageId: string; direction: 'left' | 'right' }): void;

  /**
   * Regenerates an AI message: stores the current response as an
   * alternative and returns the index where the new response should
   * be inserted. The caller must update the message text separately.
   *
   * @param options.messageId — The AI message being regenerated.
   * @param options.currentText — The current response text to archive.
   * @returns The alternatives array (current text as first alternative
   *          if new, or appended to existing). The new text will be at
   *          index `alternatives.length`.
   */
  prepareRegeneration(options: { messageId: string; currentText: string }): {
    alternatives: string[];
  };

  /**
   * Returns the currently active alternative text for a message.
   * If no alternatives exist, returns undefined.
   */
  getActiveAlternative(messageId: string): string | undefined;

  /**
   * Returns all alternatives for a message.
   * If no alternatives exist, returns an empty array.
   */
  getAlternatives(messageId: string): string[];

  /**
   * Removes all alternatives for a message (e.g. on message delete).
   */
  clearAlternatives(messageId: string): void;

  /**
   * Enriches a raw message with alternative tracking data for the View.
   */
  enrichMessage(options: {
    id: string;
    text: string;
    sender: 'user' | 'ai' | 'system';
    timestamp: Date;
  }): EnhancedChatMessage;
};

// ── Implementation ───────────────────────────────────────────────────────

class MessageBranchStore
  extends BaseFrontendClass<MessageBranchStoreOptions>
  implements MessageBranchStoreInterface
{
  /**
   * Reactive map of message ID → alternative tracking.
   * Uses a reactive array of entries so Svelte 5 $state tracks changes.
   */
  private _alternativesMap = $state(new Map<string, MessageAlternatives>());

  get alternatives(): ReadonlyMap<string, MessageAlternatives> {
    return this._alternativesMap;
  }

  addAlternative(options: { messageId: string; currentText: string; newText: string }): void {
    const { messageId, currentText, newText } = options;

    const existing = this._alternativesMap.get(messageId);
    if (existing) {
      // Cap at MAX_ALTERNATIVES — evict oldest if exceeded
      const texts =
        existing.texts.length >= MAX_ALTERNATIVES
          ? [...existing.texts.slice(1), newText]
          : [...existing.texts, newText];

      const newMap = new Map(this._alternativesMap);
      newMap.set(messageId, {
        texts,
        activeIndex: texts.length - 1,
      });
      this._alternativesMap = newMap;
    } else {
      // First regeneration — store current text as alternative [0] and new as [1]
      const newMap = new Map(this._alternativesMap);
      newMap.set(messageId, {
        texts: [currentText, newText],
        activeIndex: 1,
      });
      this._alternativesMap = newMap;
    }
  }

  swipeAlternative(options: { messageId: string; direction: 'left' | 'right' }): void {
    const { messageId, direction } = options;
    const existing = this._alternativesMap.get(messageId);
    if (!existing) {
      return;
    }

    const newIndex =
      direction === 'left'
        ? Math.max(0, existing.activeIndex - 1)
        : Math.min(existing.texts.length - 1, existing.activeIndex + 1);

    if (newIndex === existing.activeIndex) {
      return;
    }

    const newMap = new Map(this._alternativesMap);
    newMap.set(messageId, { ...existing, activeIndex: newIndex });
    this._alternativesMap = newMap;
  }

  prepareRegeneration(options: { messageId: string; currentText: string }): {
    alternatives: string[];
  } {
    const { messageId, currentText } = options;
    const existing = this._alternativesMap.get(messageId);

    if (existing) {
      const texts =
        existing.texts.length >= MAX_ALTERNATIVES
          ? [...existing.texts.slice(1), currentText]
          : [...existing.texts, currentText];
      return { alternatives: texts };
    }

    return { alternatives: [currentText] };
  }

  getActiveAlternative(messageId: string): string | undefined {
    const entry = this._alternativesMap.get(messageId);
    if (!entry) {
      return undefined;
    }
    return entry.texts[entry.activeIndex];
  }

  getAlternatives(messageId: string): string[] {
    return this._alternativesMap.get(messageId)?.texts ?? [];
  }

  clearAlternatives(messageId: string): void {
    const newMap = new Map(this._alternativesMap);
    newMap.delete(messageId);
    this._alternativesMap = newMap;
  }

  enrichMessage(options: {
    id: string;
    text: string;
    sender: 'user' | 'ai' | 'system';
    timestamp: Date;
  }): EnhancedChatMessage {
    const { id, text, sender, timestamp } = options;
    const entry = this._alternativesMap.get(id);
    const count = entry?.texts.length ?? (sender === 'ai' ? 1 : 0);
    const activeIndex = entry?.activeIndex ?? 0;

    return {
      id,
      text,
      sender,
      timestamp,
      alternativeCount: count,
      alternativeLabel: count > 1 ? `${activeIndex + 1}/${count}` : '',
      canSwipeLeft: count > 1 && activeIndex > 0,
      canSwipeRight: count > 1 && activeIndex < count - 1,
      showActions: true,
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const messageBranchStore: MessageBranchStoreInterface = MessageBranchStore.create({
  className: 'MessageBranchStore',
});
