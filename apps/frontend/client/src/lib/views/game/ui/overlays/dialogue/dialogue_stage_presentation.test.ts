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
  cancelDeleteAndRefocus,
  chipClassFor,
  chipIconFor,
  chipLabelFor,
  confirmDeleteAndRefocus,
  createDialogueStageState,
  type DialogueRowActionTarget,
  type DialogueStageMessage,
  dispatchDialogueRowAction,
  findDialogueMessage,
  focusOnMount,
  handleDialogueEscape,
  initialsFor,
  isPartyMateMessage,
  resolveDialogueEscapeScope,
  routeComposerKeyDown,
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

  test('exitFullscreen collapses full view without toggling back on', () => {
    const stage = createDialogueStageState();
    stage.toggleFullscreen();
    expect(stage.isFullscreen).toBe(true);
    stage.exitFullscreen();
    expect(stage.isFullscreen).toBe(false);
    stage.exitFullscreen();
    expect(stage.isFullscreen).toBe(false);
  });

  test('portraitFailed flips once and stays set', () => {
    const stage = createDialogueStageState();
    expect(stage.portraitFailed).toBe(false);
    stage.markPortraitFailed();
    expect(stage.portraitFailed).toBe(true);
  });

  test('each instance owns its own state', () => {
    const a = createDialogueStageState();
    const b = createDialogueStageState();
    a.toggleFullscreen();
    expect(a.isFullscreen).toBe(true);
    expect(b.isFullscreen).toBe(false);
  });
});

describe('initialsFor', () => {
  test('uses the first letter of the first and last words', () => {
    expect(initialsFor('Elder Thrain')).toBe('ET');
    expect(initialsFor('Guard Captain Voss')).toBe('GV');
  });

  test('uses a single letter for a one-word name', () => {
    expect(initialsFor('Rollo')).toBe('R');
  });

  test('falls back to a neutral mark for an empty name', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('chipLabelFor', () => {
  test('strips a leading decorative emoji', () => {
    expect(chipLabelFor('⚔️ Offer your sword')).toBe('Offer your sword');
    expect(chipLabelFor('📜 Ask about arcane lore')).toBe('Ask about arcane lore');
    expect(chipLabelFor('🗡️ Quiet work')).toBe('Quiet work');
  });

  test('leaves a label without a leading emoji untouched', () => {
    expect(chipLabelFor('Ask about the ward')).toBe('Ask about the ward');
  });

  test('keeps a leading digit', () => {
    expect(chipLabelFor('20% off the wares')).toBe('20% off the wares');
  });
});

describe('resolveDialogueEscapeScope', () => {
  test('closes the innermost scope first: delete → slash → full → end', () => {
    expect(
      resolveDialogueEscapeScope({
        hasPendingDelete: true,
        hasSlashCompletions: true,
        isFullscreen: true,
      }),
    ).toBe('delete-confirm');
    expect(
      resolveDialogueEscapeScope({
        hasPendingDelete: false,
        hasSlashCompletions: true,
        isFullscreen: true,
      }),
    ).toBe('slash-autocomplete');
    expect(
      resolveDialogueEscapeScope({
        hasPendingDelete: false,
        hasSlashCompletions: false,
        isFullscreen: true,
      }),
    ).toBe('full-view');
    expect(
      resolveDialogueEscapeScope({
        hasPendingDelete: false,
        hasSlashCompletions: false,
        isFullscreen: false,
      }),
    ).toBe('end-chat');
  });
});

type FakeEscapeVm = {
  pendingDeleteMessageId: string | null;
  showSlashCompletions: boolean;
  inputElement: HTMLTextAreaElement | undefined;
  calls: string[];
  cancelDelete(): void;
  confirmDelete(): void;
  dismissSlashCompletions(): void;
  endChat(): void;
  handleKeyDown(event: KeyboardEvent): void;
};

const createFakeVm = (overrides?: Partial<FakeEscapeVm>): FakeEscapeVm => {
  const calls: string[] = [];
  return {
    pendingDeleteMessageId: null,
    showSlashCompletions: false,
    inputElement: {
      focus: () => calls.push('focus-input'),
    } as unknown as HTMLTextAreaElement,
    calls,
    cancelDelete: () => calls.push('cancel-delete'),
    confirmDelete: () => calls.push('confirm-delete'),
    dismissSlashCompletions: () => calls.push('dismiss-slash'),
    endChat: () => calls.push('end-chat'),
    handleKeyDown: () => calls.push('handle-key-down'),
    ...overrides,
  };
};

const createEvent = (
  key: string,
): {
  event: KeyboardEvent;
  preventDefault: ReturnType<typeof mock>;
  stopPropagation: ReturnType<typeof mock>;
} => {
  const preventDefault = mock(() => {});
  const stopPropagation = mock(() => {});
  return {
    event: { key, preventDefault, stopPropagation } as unknown as KeyboardEvent,
    preventDefault,
    stopPropagation,
  };
};

describe('handleDialogueEscape — one scope at a time', () => {
  test('delete-confirm wins over slash, full view and end chat', () => {
    const vm = createFakeVm({
      pendingDeleteMessageId: 'msg-1',
      showSlashCompletions: true,
    });
    const stage = createDialogueStageState();
    stage.toggleFullscreen();

    const { event, preventDefault, stopPropagation } = createEvent('Escape');
    const handled = handleDialogueEscape(event, vm, stage);

    expect(handled).toBe(true);
    expect(vm.calls).toEqual(['cancel-delete', 'focus-input']);
    expect(stage.isFullscreen).toBe(true); // untouched — only one scope closed
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('slash autocomplete is dismissed next, without ending the chat', () => {
    const vm = createFakeVm({ showSlashCompletions: true });
    const stage = createDialogueStageState();
    stage.toggleFullscreen();

    const { event, stopPropagation } = createEvent('Escape');
    expect(handleDialogueEscape(event, vm, stage)).toBe(true);

    expect(vm.calls).toEqual(['dismiss-slash']);
    expect(stage.isFullscreen).toBe(true);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('full view collapses before end chat', () => {
    const vm = createFakeVm();
    const stage = createDialogueStageState();
    stage.toggleFullscreen();

    const { event } = createEvent('Escape');
    expect(handleDialogueEscape(event, vm, stage)).toBe(true);

    expect(vm.calls).toEqual([]);
    expect(stage.isFullscreen).toBe(false);
  });

  test('with no inner scope open, Escape ends the chat', () => {
    const vm = createFakeVm();
    const stage = createDialogueStageState();

    const { event, stopPropagation } = createEvent('Escape');
    expect(handleDialogueEscape(event, vm, stage)).toBe(true);

    expect(vm.calls).toEqual(['end-chat']);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('non-Escape keys are not consumed', () => {
    const vm = createFakeVm({ pendingDeleteMessageId: 'msg-1' });
    const stage = createDialogueStageState();

    const { event, preventDefault, stopPropagation } = createEvent('Enter');
    expect(handleDialogueEscape(event, vm, stage)).toBe(false);

    expect(vm.calls).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});

describe('routeComposerKeyDown', () => {
  test('Escape goes through the scope ladder and never reaches the ViewModel', () => {
    const vm = createFakeVm({ showSlashCompletions: true });
    const stage = createDialogueStageState();

    routeComposerKeyDown(createEvent('Escape').event, vm, stage);

    expect(vm.calls).toEqual(['dismiss-slash']);
    expect(vm.calls).not.toContain('handle-key-down');
  });

  test('other keys are delegated to the ViewModel', () => {
    const vm = createFakeVm();
    const stage = createDialogueStageState();

    routeComposerKeyDown(createEvent('Enter').event, vm, stage);

    expect(vm.calls).toEqual(['handle-key-down']);
  });
});

describe('delete modal focus helpers', () => {
  test('cancelDeleteAndRefocus cancels and returns focus to the composer', () => {
    const vm = createFakeVm();
    cancelDeleteAndRefocus(vm);
    expect(vm.calls).toEqual(['cancel-delete', 'focus-input']);
  });

  test('confirmDeleteAndRefocus confirms and returns focus to the composer', () => {
    const vm = createFakeVm();
    confirmDeleteAndRefocus(vm);
    expect(vm.calls).toEqual(['confirm-delete', 'focus-input']);
  });

  test('focusOnMount focuses the node and returns a destroy hook', () => {
    const focus = mock(() => {});
    const node = { focus } as unknown as HTMLElement;
    const action = focusOnMount(node);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(typeof action.destroy).toBe('function');
  });
});
