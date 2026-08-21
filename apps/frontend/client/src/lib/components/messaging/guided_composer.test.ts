// apps/frontend/client/src/lib/components/messaging/guided_composer.test.ts
//
// Unit tests for the shared GuidedComposer (C-424). The composer owns the
// textarea + send affordance + disabled state and calls back via onSend —
// it owns no send logic. These tests cover the send-affordance state
// derivation (enabled/disabled, send vs cancel vs spinner) that the
// component computes from its props.
//
// Contract: C-424 Unified Message Surfaces
import { describe, expect, test } from 'bun:test';

// ── Logic under test (mirrors GuidedComposer's $derived) ─────────────────
//
// The send affordance is enabled when it is not disabled and (when
// requireText is set) the input has content. When streaming with a cancel
// handler, the affordance becomes a cancel regardless of content.

type SendState = {
  sendDisabled?: boolean;
  disabled?: boolean;
  requireText?: boolean;
  value: string;
  isStreaming?: boolean;
  hasCancel?: boolean;
};

const canSend = (options: SendState): boolean => {
  const { sendDisabled, disabled, requireText = true, value } = options;
  return !(sendDisabled ?? disabled) && (!requireText || value.trim().length > 0);
};

const showCancel = (options: SendState): boolean =>
  (options.isStreaming ?? false) && (options.hasCancel ?? false);

// ── Tests ────────────────────────────────────────────────────────────────

describe('GuidedComposer — send affordance state (C-424)', () => {
  test('send is enabled when there is text and nothing is disabled', () => {
    expect(canSend({ value: 'hello' })).toBe(true);
  });

  test('send is disabled when the input is empty (requireText default)', () => {
    expect(canSend({ value: '' })).toBe(false);
    expect(canSend({ value: '   ' })).toBe(false);
  });

  test('send is disabled when sendDisabled is set', () => {
    expect(canSend({ value: 'hello', sendDisabled: true })).toBe(false);
  });

  test('send is disabled when the textarea is disabled', () => {
    expect(canSend({ value: 'hello', disabled: true })).toBe(false);
  });

  test('explicit sendDisabled=false overrides a disabled textarea', () => {
    expect(canSend({ value: 'hello', sendDisabled: false, disabled: true })).toBe(true);
  });

  test('requireText=false keeps send enabled with empty input (dialogue)', () => {
    expect(canSend({ value: '', requireText: false })).toBe(true);
  });

  test('requireText=false still respects an explicit disable', () => {
    expect(canSend({ value: '', requireText: false, sendDisabled: true })).toBe(false);
    expect(canSend({ value: '', requireText: false, disabled: true })).toBe(false);
  });

  test('whitespace-only input is treated as empty when requireText is set', () => {
    expect(canSend({ value: '   ', requireText: true })).toBe(false);
  });

  test('cancel affordance appears only when streaming and a cancel handler exists', () => {
    expect(showCancel({ value: '', isStreaming: true, hasCancel: true })).toBe(true);
    expect(showCancel({ value: '', isStreaming: true, hasCancel: false })).toBe(false);
    expect(showCancel({ value: '', isStreaming: false, hasCancel: true })).toBe(false);
  });
});
