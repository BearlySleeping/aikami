// apps/frontend/pwa/src/lib/services/media/context_builder.ts
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// ConversationMessage — lightweight dialogue turn for context window
// ---------------------------------------------------------------------------

/** A single turn in a conversation history. */
export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ---------------------------------------------------------------------------
// Sliding Window Context Builder
// ---------------------------------------------------------------------------

export type SlidingWindowContextOptions = {
  /** The full conversation history, oldest messages first. */
  messages: ConversationMessage[];
  /**
   * Maximum number of messages to include.
   * @default 10
   */
  maxMessages?: number;
  /**
   * Approximate character budget for the combined message content.
   * Truncation stops once the window exceeds this budget.
   * @default 4_000
   */
  maxCharacters?: number;
  /**
   * Number of characters reserved for the system prompt that the
   * backend will inject.  The context builder will leave this much
   * headroom so the total (system + history) fits the LLM context.
   * @default 1_500
   */
  systemPromptReservation?: number;
};

/**
 * Builds a sliding-window context from a full conversation history.
 *
 * Returns the last `maxMessages` entries that fit within the configured
 * character budget, after reserving space for the NPC persona / system
 * prompt that the backend injects.
 *
 * Messages are expected in chronological order (oldest first).  The
 * returned slice is always the *tail* of the array — older messages are
 * dropped to make room.
 */
export const buildSlidingWindowContext = (
  options: SlidingWindowContextOptions,
): ConversationMessage[] => {
  logger.debug('buildSlidingWindowContext', {
    messageCount: options.messages.length,
    maxMessages: options.maxMessages,
    maxCharacters: options.maxCharacters,
  });

  const {
    messages,
    maxMessages = 10,
    maxCharacters = 4_000,
    systemPromptReservation = 1_500,
  } = options;

  const effectiveBudget = maxCharacters - systemPromptReservation;

  // Start from the most recent message and walk backwards
  const window: ConversationMessage[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Stop if we hit the message count cap
    if (window.length >= maxMessages) {
      break;
    }

    const messageChars = message.content.length;
    if (totalChars + messageChars > effectiveBudget) {
      break;
    }

    window.unshift(message);
    totalChars += messageChars;
  }

  logger.debug('buildSlidingWindowContext:result', {
    windowSize: window.length,
    totalChars,
  });

  return window;
};
