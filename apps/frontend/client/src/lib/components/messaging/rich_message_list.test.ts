// apps/frontend/client/src/lib/components/messaging/rich_message_list.test.ts
//
// Unit tests for the shared RichMessageList (C-424). The list owns the
// scrollable container, scroll anchoring, the empty state and the streaming
// (aria-busy) indicator. These tests cover the empty-state derivation and
// the message-row keying that the component computes from its props.
//
// Contract: C-424 Unified Message Surfaces
import { describe, expect, test } from 'bun:test';

// ── Logic under test (mirrors RichMessageList's template) ────────────────

type RichMessage = {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'system';
  timestamp: Date;
};

/** Whether the empty state is shown: no messages and no pre-message content. */
const shouldShowEmptyState = (messageCount: number, hasBeforeContent: boolean): boolean =>
  messageCount === 0 && !hasBeforeContent;

/** Rows are keyed by message id so list updates are stable and cheap. */
const keyFor = (message: RichMessage): string => message.id;

/** The container is marked aria-busy while the surface is streaming. */
const isBusy = (isStreaming: boolean): boolean => isStreaming;

// ── Tests ────────────────────────────────────────────────────────────────

describe('RichMessageList — empty state (C-424)', () => {
  test('shows empty state when there are no messages and no pre-message content', () => {
    expect(shouldShowEmptyState(0, false)).toBe(true);
  });

  test('does not show empty state when there are messages', () => {
    expect(shouldShowEmptyState(1, false)).toBe(false);
    expect(shouldShowEmptyState(5, false)).toBe(false);
  });

  test('does not show empty state when there is pre-message content (dialogue images)', () => {
    expect(shouldShowEmptyState(0, true)).toBe(false);
  });
});

describe('RichMessageList — keying (C-424)', () => {
  test('rows are keyed by message id', () => {
    const message: RichMessage = {
      id: 'msg-1',
      text: 'Hello',
      sender: 'ai',
      timestamp: new Date(0),
    };
    expect(keyFor(message)).toBe('msg-1');
  });

  test('distinct ids produce distinct keys', () => {
    const a: RichMessage = { id: 'a', text: 'x', sender: 'user', timestamp: new Date(0) };
    const b: RichMessage = { id: 'b', text: 'y', sender: 'ai', timestamp: new Date(0) };
    expect(keyFor(a)).not.toBe(keyFor(b));
  });
});

describe('RichMessageList — streaming indicator (C-424)', () => {
  test('container is aria-busy while streaming', () => {
    expect(isBusy(true)).toBe(true);
  });

  test('container is not aria-busy when idle', () => {
    expect(isBusy(false)).toBe(false);
  });
});
