// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_stage_presentation.test.ts
//
// Behavioural tests for the C-547 dialogue-stage presentation helpers. These
// cover the mappings that used to live inline in the View: the RichMessage
// projection, the chip class/icon mapping, the row-action dispatch table, the
// fullscreen stage state and the Escape-scope handler.
//
// Run with:
//   bun moon run client:test

import { describe, expect, mock, test } from 'bun:test';
import {
  chipClassFor,
  chipIconFor,
  createDialogueStageState,
  createStageEscapeHandler,
  type DialogueRowActionTarget,
  type DialogueStageMessage,
  dispatchDialogueRowAction,
  findDialogueMessage,
  isPartyMateMessage,
  toRichMessages,
} from './dialogue_stage_presentation.svelte';

const message = (
  overrides: Partial<DialogueStageMessage> & Pick<DialogueStageMessage, 'id' | 'role' | 'content'>,
): DialogueStageMessage => overrides;

describe('toRichMessages', () => {
  test('maps player to user and npc to ai, preserving id and text', () => {
    const rows = toRichMessages([
      message({ id: 'm1', role: 'player', content: 'Hello there.' }),
      message({ id: 'm2', role: 'npc', content: 'Well met.' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'm1', text: 'Hello there.', sender: 'user' });
    expect(rows[1]).toMatchObject({ id: 'm2', text: 'Well met.', sender: 'ai' });
    expect(rows[0]?.timestamp).toBeInstanceOf(Date);
  });

  test('returns an empty list for an empty transcript', () => {
    expect(toRichMessages([])).toEqual([]);
  });
});

describe('findDialogueMessage', () => {
  test('finds a message by id', () => {
    const messages = [
      message({ id: 'a', role: 'npc', content: 'one' }),
      message({ id: 'b', role: 'player', content: 'two' }),
    ];
    expect(findDialogueMessage(messages, 'b')?.content).toBe('two');
  });

  test('returns undefined for an unknown id', () => {
    expect(
      findDialogueMessage([message({ id: 'a', role: 'npc', content: 'x' })], 'zz'),
    ).toBeUndefined();
  });
});

describe('isPartyMateMessage', () => {
  test('is true when the sender name differs from the NPC', () => {
    expect(
      isPartyMateMessage(
        message({ id: 'a', role: 'npc', content: '', senderName: 'Companion' }),
        'Elder Thrain',
      ),
    ).toBe(true);
  });

  test('is false when the sender name matches the NPC', () => {
    expect(
      isPartyMateMessage(
        message({ id: 'a', role: 'npc', content: '', senderName: 'Elder Thrain' }),
        'Elder Thrain',
      ),
    ).toBe(false);
  });

  test('is false when there is no sender name or no message', () => {
    expect(isPartyMateMessage(message({ id: 'a', role: 'npc', content: '' }), 'Elder Thrain')).toBe(
      false,
    );
    expect(isPartyMateMessage(undefined, 'Elder Thrain')).toBe(false);
  });
});

describe('chipClassFor / chipIconFor', () => {
  test('maps each known intent to its game role', () => {
    expect(chipClassFor('combat')).toBe('game-chip--danger');
    expect(chipClassFor('skill_check')).toBe('game-chip--check');
    expect(chipClassFor('trade')).toBe('game-chip--trade');
    expect(chipClassFor('quest')).toBe('game-chip--quest');
  });

  test('falls back to the neutral role for unknown intents', () => {
    expect(chipClassFor('dialogue')).toBe('game-chip--neutral');
    expect(chipClassFor('')).toBe('game-chip--neutral');
  });

  test('maps intents to distinct icons', () => {
    expect(chipIconFor('skill_check')).toBe('🎲');
    expect(chipIconFor('combat')).toBe('⚔️');
    expect(chipIconFor('trade')).toBe('💰');
    expect(chipIconFor('quest')).toBe('📋');
    expect(chipIconFor('dialogue')).toBe('💬');
  });
});

describe('dispatchDialogueRowAction', () => {
  const createTarget = (isCampaignPlay: boolean) => {
    const calls: string[] = [];
    const target: DialogueRowActionTarget = {
      isCampaignPlay,
      messages: [
        message({ id: 'npc-1', role: 'npc', content: 'The ward is fading.' }),
        message({ id: 'player-1', role: 'player', content: 'I will help.' }),
      ],
      copyMessage: async (text) => {
        calls.push(`copy:${text}`);
      },
      rephraseResponse: (id) => calls.push(`rephrase:${id}`),
      speakMessage: (text) => calls.push(`speak:${text}`),
      createBranch: (options) => calls.push(`branch:${options.parentMessageId}`),
      startEdit: (id) => calls.push(`edit:${id}`),
      deleteMessage: (id) => calls.push(`delete:${id}`),
    };
    return { target, calls };
  };

  test('copy uses the resolved message text', () => {
    const { target, calls } = createTarget(false);
    dispatchDialogueRowAction(target, 'npc-1', 'copy');
    expect(calls).toEqual(['copy:The ward is fading.']);
  });

  test('retry is dispatched as a presentation-only rephrase', () => {
    const { target, calls } = createTarget(false);
    dispatchDialogueRowAction(target, 'npc-1', 'retry');
    expect(calls).toEqual(['rephrase:npc-1']);
  });

  test('speak uses the resolved message text', () => {
    const { target, calls } = createTarget(false);
    dispatchDialogueRowAction(target, 'npc-1', 'speak');
    expect(calls).toEqual(['speak:The ward is fading.']);
  });

  test('non-campaign play dispatches branch, edit and delete', () => {
    const { target, calls } = createTarget(false);
    dispatchDialogueRowAction(target, 'player-1', 'branch');
    dispatchDialogueRowAction(target, 'player-1', 'edit');
    dispatchDialogueRowAction(target, 'player-1', 'delete');
    expect(calls).toEqual(['branch:player-1', 'edit:player-1', 'delete:player-1']);
  });

  test('campaign play gates out transcript rewinding but keeps copy and speak', () => {
    const { target, calls } = createTarget(true);
    dispatchDialogueRowAction(target, 'npc-1', 'branch');
    dispatchDialogueRowAction(target, 'npc-1', 'edit');
    dispatchDialogueRowAction(target, 'npc-1', 'delete');
    dispatchDialogueRowAction(target, 'npc-1', 'copy');
    dispatchDialogueRowAction(target, 'npc-1', 'retry');
    expect(calls).toEqual(['copy:The ward is fading.', 'rephrase:npc-1']);
  });

  test('ignores an unknown message id', () => {
    const { target, calls } = createTarget(false);
    dispatchDialogueRowAction(target, 'missing', 'copy');
    expect(calls).toEqual([]);
  });
});

describe('createDialogueStageState', () => {
  test('starts compact and toggles fullscreen', () => {
    const stage = createDialogueStageState();
    expect(stage.isFullscreen).toBe(false);
    stage.toggleFullscreen();
    expect(stage.isFullscreen).toBe(true);
    stage.toggleFullscreen();
    expect(stage.isFullscreen).toBe(false);
  });

  test('each instance owns its own state', () => {
    const a = createDialogueStageState();
    const b = createDialogueStageState();
    a.toggleFullscreen();
    expect(a.isFullscreen).toBe(true);
    expect(b.isFullscreen).toBe(false);
  });
});

describe('createStageEscapeHandler', () => {
  const createEvent = (
    key: string,
  ): { event: KeyboardEvent; preventDefault: ReturnType<typeof mock> } => {
    const preventDefault = mock(() => {});
    return { event: { key, preventDefault } as unknown as KeyboardEvent, preventDefault };
  };

  test('Escape cancels a pending deletion and prevents default', () => {
    let cancelled = 0;
    const handler = createStageEscapeHandler({
      pendingDeleteMessageId: 'msg-1',
      cancelDelete: () => {
        cancelled += 1;
      },
    });
    const { event, preventDefault } = createEvent('Escape');
    handler(event);
    expect(cancelled).toBe(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test('Escape without a pending deletion is left to the composer handler', () => {
    let cancelled = 0;
    const handler = createStageEscapeHandler({
      pendingDeleteMessageId: null,
      cancelDelete: () => {
        cancelled += 1;
      },
    });
    const { event, preventDefault } = createEvent('Escape');
    handler(event);
    expect(cancelled).toBe(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('non-Escape keys never cancel', () => {
    let cancelled = 0;
    const handler = createStageEscapeHandler({
      pendingDeleteMessageId: 'msg-1',
      cancelDelete: () => {
        cancelled += 1;
      },
    });
    handler(createEvent('Enter').event);
    expect(cancelled).toBe(0);
  });
});
