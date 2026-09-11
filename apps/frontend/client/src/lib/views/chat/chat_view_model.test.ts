// apps/frontend/client/src/lib/views/chat/chat_view_model.test.ts
//
// Unit tests for C-421 AC-1: the `/roll` slash command routes through
// DiceService (not the engine bridge), parses modifiers and `vs <dc>`, and
// adds a dice chat message. Malformed notation produces an inline error.
//
// This suite constructs the ViewModel from feature-owned capability fixtures —
// no global `$services` barrel mock and no dependency on the preload mock
// inventory.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DiceCardData } from '@aikami/types';
import {
  type ChatViewModelInterface,
  type ChatViewModelOptions,
  createChatViewModel,
} from './chat_view_model.svelte.ts';
import {
  createChatStoreCapabilities,
  createDiceCapabilities,
  createInertChatCapabilities,
} from './testing/chat_fixtures.ts';

const addMessageMock = mock(() => {});
const rollCardMock = mock(() => ({}) as DiceCardData);

const createViewModel = (): ChatViewModelInterface => {
  const options: ChatViewModelOptions = {
    className: 'ChatViewModelTest',
    chatId: 'chat-1',
    ...createInertChatCapabilities({
      chat: createChatStoreCapabilities({ addMessage: addMessageMock }),
      dice: createDiceCapabilities({ rollCard: rollCardMock }),
    }),
  };
  return createChatViewModel(options);
};

type RollHarness = { _handleRollCommand(input: string): void };

/** Exposes the private roll handler for focused unit testing. */
const handleRoll = (vm: ChatViewModelInterface, input: string): void =>
  (vm as unknown as RollHarness)._handleRollCommand(input);

describe('ChatViewModel /roll (C-421 AC-1)', () => {
  beforeEach(() => {
    addMessageMock.mockClear();
    rollCardMock.mockClear();
  });

  test('routes a plain roll through DiceService and adds a dice message', () => {
    const vm = createViewModel();
    rollCardMock.mockReturnValue({
      id: 'card-1',
      notation: '1d20+3',
      dice: [{ sides: 20, value: 15 }],
      modifier: 3,
      total: 18,
      isCriticalSuccess: false,
      isCriticalFailure: false,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    handleRoll(vm, '1d20+3');

    expect(rollCardMock).toHaveBeenCalledWith({
      notation: '1d20+3',
      count: 1,
      sides: 20,
      modifier: 3,
    });
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    const msg = addMessageMock.mock.calls[0]?.[0] as { kind?: string; dice?: DiceCardData };
    expect(msg.kind).toBe('dice');
    expect(msg.dice?.notation).toBe('1d20+3');
  });

  test('parses a trailing vs <dc> into check context', () => {
    const vm = createViewModel();
    rollCardMock.mockReturnValue({
      id: 'card-2',
      notation: '1d20+3',
      dice: [{ sides: 20, value: 15 }],
      modifier: 3,
      total: 18,
      check: { dc: 15, success: true, difference: 3 },
      isCriticalSuccess: false,
      isCriticalFailure: false,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    handleRoll(vm, '1d20+3 vs 15');

    expect(rollCardMock).toHaveBeenCalledWith({
      notation: '1d20+3',
      count: 1,
      sides: 20,
      modifier: 3,
      dc: 15,
    });
  });

  test('malformed notation produces an inline error and no roll', () => {
    const vm = createViewModel();
    handleRoll(vm, 'foo');
    expect(rollCardMock).not.toHaveBeenCalled();
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    const msg = addMessageMock.mock.calls[0]?.[0] as { text?: string; kind?: string };
    expect(msg.text).toContain('Invalid dice notation');
    expect(msg.kind).toBeUndefined();
  });

  test('out-of-bounds notation produces an inline error and no roll', () => {
    const vm = createViewModel();
    handleRoll(vm, '99999d6');
    expect(rollCardMock).not.toHaveBeenCalled();
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    const msg = addMessageMock.mock.calls[0]?.[0] as { text?: string };
    expect(msg.text).toContain('Invalid dice notation');
  });
});
