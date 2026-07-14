// apps/frontend/client/src/lib/types/rich_chat.ts
//
// Client-local types for Rich Chat Streaming enhancements — message
// branching/swiping, input drafts, inline action bars, and streaming TTS.
//
// Contract: C-231 Rich Chat Streaming

// ── Enhanced Message ────────────────────────────────────────────────────

/**
 * Extends the standard chat message with alternative tracking for
 * message branching/swiping and fork support.
 *
 * Stored locally in IndexedDB alongside existing chat persistence.
 */
export type EnhancedMessage = {
  /** Unique message identifier. */
  id: string;
  /** Message text content. */
  text: string;
  /** Who sent the message. */
  sender: 'user' | 'ai' | 'system';
  /** When the message was created. */
  timestamp: Date;
  /** Previous AI-generated responses stored as alternatives for swiping. */
  alternatives: string[];
  /** Which alternative index is currently displayed (0 = active/current). */
  activeAlternativeIndex: number;
  /** For branching: which message ID was this a response to. */
  parentMessageId?: string;
  /**
   * Character-to-expression mapping for this message alternative.
   * Undefined for messages created before this feature was added —
   * consumers should treat undefined as 'neutral' for all characters.
   */
  expressionMap?: Record<string, string>;
};

// ── Input Draft Store ─────────────────═══════════════════════════════════

/**
 * Per-chat input draft persisted to IndexedDB.
 * Restored when the user opens a chat, cleared on send.
 */
export type ChatInputDraft = {
  /** ID of the chat/conversation this draft belongs to. */
  chatId: string;
  /** Current input text. */
  text: string;
  /** Timestamp of last update (Date.now()). */
  updatedAt: number;
};

// ── Message Action Bar ─────────────────══════════════════════════════════

/**
 * Actions available on each message via the hover-visible action bar.
 * Context-appropriate: AI messages show copy/retry/speak/branch;
 * user messages show copy/edit/delete/branch.
 */
export type MessageAction =
  | 'copy' // Copy text to clipboard
  | 'retry' // Regenerate (for AI messages)
  | 'edit' // Inline edit (for user messages)
  | 'delete' // Delete with confirmation
  | 'branch' // Fork a new chat from this message
  | 'speak'; // Play TTS for this message

// ── Streaming TTS Config ─═════════════════════════════════════════════════

/**
 * Per-chat configuration for streaming TTS.
 * When enabled, tokens arriving via SSE are fed through
 * SentenceBoundaryChunker and dispatched to ttsService.speak()
 * on sentence boundaries.
 */
export type StreamingTtsConfig = {
  /** Whether streaming TTS is enabled for this chat. */
  enabled: boolean;
  /** Voice ID to use for speech synthesis. */
  voiceId: string;
  /** Chunking strategy: sentence, word, or paragraph boundaries. */
  chunkBy: 'sentence' | 'word' | 'paragraph';
};

// ── Message Branch Store ─═════════════════════════════════════════════════

/**
 * Alternative tracking for a single message.
 * Keyed by message ID in the MessageBranchStore.
 */
export type MessageAlternatives = {
  /** All alternative text responses (including the active one). */
  texts: string[];
  /** Index of the currently displayed alternative. */
  activeIndex: number;
};

// ── Enhanced Chat Message (View Model) ─══════════════════════════════════

/**
 * A chat message enriched with alternative tracking and action bar state.
 * Used by the ViewModel to expose enhanced message data to the View.
 */
export type EnhancedChatMessage = {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'system';
  timestamp: Date;
  /** Total number of alternatives (0 for user messages, >= 1 for AI). */
  alternativeCount: number;
  /** Display label for the alternative counter (e.g. "2/3"). Only non-empty when count > 1. */
  alternativeLabel: string;
  /** Whether swipe left is available. */
  canSwipeLeft: boolean;
  /** Whether swipe right is available. */
  canSwipeRight: boolean;
  /** Whether the inline action bar can be shown. */
  showActions: boolean;
};
