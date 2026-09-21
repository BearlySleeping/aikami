// apps/frontend/client/src/lib/components/chat/message_actions.test.ts
//
// C-490 AC-1 / AC-2: the message-action bar's offered actions and labels are
// gated BY MODE. In campaign play (`disableRewind`) branch/edit/delete are
// never offered (AC-1) and retry reads "Rephrase" (AC-2). They remain
// available in the dev sandbox and non-campaign chat modes.
//
// Run: bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json \
//   src/lib/components/chat/message_actions.test.ts

import { describe, expect, test } from 'bun:test';
import { availableMessageActions, messageActionIcon, messageActionLabel } from './message_actions';

describe('availableMessageActions (C-490 AC-1)', () => {
  test('campaign AI message offers copy/retry but NOT branch', () => {
    const actions = availableMessageActions({ sender: 'ai', disableRewind: true });
    expect(actions).toEqual(['copy', 'retry']);
    expect(actions).not.toContain('branch');
  });

  test('campaign AI message keeps speak when TTS is available', () => {
    const actions = availableMessageActions({
      sender: 'ai',
      ttsAvailable: true,
      disableRewind: true,
    });
    expect(actions).toEqual(['copy', 'retry', 'speak']);
  });

  test('non-campaign AI message keeps branch', () => {
    const actions = availableMessageActions({ sender: 'ai' });
    expect(actions).toEqual(['copy', 'retry', 'branch']);
  });

  test('campaign user message offers copy ONLY (no edit/delete/branch)', () => {
    const actions = availableMessageActions({ sender: 'user', disableRewind: true });
    expect(actions).toEqual(['copy']);
  });

  test('non-campaign user message keeps edit/delete/branch', () => {
    const actions = availableMessageActions({ sender: 'user' });
    expect(actions).toEqual(['copy', 'edit', 'delete', 'branch']);
  });

  test('system sender is treated like a user message', () => {
    const campaign = availableMessageActions({ sender: 'system', disableRewind: true });
    const normal = availableMessageActions({ sender: 'system' });
    expect(campaign).toEqual(['copy']);
    expect(normal).toEqual(['copy', 'edit', 'delete', 'branch']);
  });

  test('copy always stays in every mode', () => {
    for (const sender of ['ai', 'user', 'system'] as const) {
      for (const disableRewind of [false, true]) {
        expect(availableMessageActions({ sender, disableRewind })).toContain('copy');
      }
    }
  });
});

describe('messageActionLabel (C-490 AC-2)', () => {
  test('retry is relabelled "Rephrase"', () => {
    expect(messageActionLabel('retry')).toBe('Rephrase');
    expect(messageActionLabel('retry')).not.toBe('Retry');
  });

  test('other actions keep their labels', () => {
    expect(messageActionLabel('copy')).toBe('Copy');
    expect(messageActionLabel('edit')).toBe('Edit');
    expect(messageActionLabel('delete')).toBe('Delete');
    expect(messageActionLabel('branch')).toBe('Branch');
    expect(messageActionLabel('speak')).toBe('Speak');
  });
});

describe('messageActionIcon', () => {
  test('every action has an icon', () => {
    for (const action of ['copy', 'retry', 'edit', 'delete', 'branch', 'speak'] as const) {
      expect(messageActionIcon(action).length).toBeGreaterThan(0);
    }
  });
});
