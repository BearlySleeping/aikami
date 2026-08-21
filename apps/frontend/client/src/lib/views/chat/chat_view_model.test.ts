// apps/frontend/client/src/lib/views/chat/chat_view_model.test.ts
//
// Unit tests for C-421 AC-1: the `/roll` slash command routes through
// DiceService (not the engine bridge), parses modifiers and `vs <dc>`, and
// adds a dice chat message. Malformed notation produces an inline error.
// biome-ignore-all lint/style/useNamingConvention: mock property mirrors the PascalCase class name
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const addMessageMock = mock(() => {});
const rollCardMock = mock(() => ({}));

mock.module('$services', () => ({
  __esModule: true,
  aiService: {},
  authService: {},
  chatService: { addMessage: addMessageMock, messages: [] },
  chatStorage: {},
  choiceHistoryStore: {},
  connectedChatsService: {},
  diceService: { rollCard: rollCardMock },
  draftStore: {},
  imageGenerationService: {},
  impersonationService: {},
  messageBranchStore: {},
  npcService: {},
  personaService: {},
  SentenceBoundaryChunker: class {},
  ttsService: {},
}));

import type { ChatViewModelInterface, ChatViewModelOptions } from './chat_view_model.svelte.ts';

const createViewModel = async (): Promise<ChatViewModelInterface> => {
  const { ChatViewModel } = await import('./chat_view_model.svelte.ts');
  const options: ChatViewModelOptions = {
    className: 'ChatViewModelTest',
    chatId: 'chat-1',
  };
  return ChatViewModel.create(options);
};

/** Exposes the private roll handler for focused unit testing. */
const handleRoll = (vm: ChatViewModelInterface, input: string): void =>
  (vm as unknown as { _handleRollCommand: (i: string) => void })._handleRollCommand(input);

describe('ChatViewModel /roll (C-421 AC-1)', () => {
  beforeEach(() => {
    addMessageMock.mockClear();
    rollCardMock.mockClear();
  });

  test('routes a plain roll through DiceService and adds a dice message', async () => {
    const vm = await createViewModel();
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
    const msg = addMessageMock.mock.calls[0]?.[0];
    expect(msg.kind).toBe('dice');
    expect(msg.dice.notation).toBe('1d20+3');
  });

  test('parses a trailing vs <dc> into check context', async () => {
    const vm = await createViewModel();
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

  test('malformed notation produces an inline error and no roll', async () => {
    const vm = await createViewModel();
    handleRoll(vm, 'foo');
    expect(rollCardMock).not.toHaveBeenCalled();
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    const msg = addMessageMock.mock.calls[0]?.[0];
    expect(msg.text).toContain('Invalid dice notation');
    expect(msg.kind).toBeUndefined();
  });

  test('out-of-bounds notation produces an inline error and no roll', async () => {
    const vm = await createViewModel();
    handleRoll(vm, '99999d6');
    expect(rollCardMock).not.toHaveBeenCalled();
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    expect(addMessageMock.mock.calls[0]?.[0].text).toContain('Invalid dice notation');
  });
});
