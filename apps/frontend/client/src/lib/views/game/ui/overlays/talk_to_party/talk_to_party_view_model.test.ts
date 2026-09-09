// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.test.ts
//
// Unit tests for TalkToPartyViewModel group-turn routing (C-493 AC-1).
// When two or more companions are present, addressing the party routes
// through generateMultiNpcResponses (group path); with fewer than two it
// falls back to the single-companion generateTurn path.

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { MAX_GROUP_PARTICIPANTS } from '@aikami/constants';
import type { TalkToPartyViewModelInterface } from './talk_to_party_view_model.svelte';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type MockMember = { npcId: string; name: string; classId: string; level: number; approval: number };

const membersArr: MockMember[] = [];

const clearStackMock = mock(() => {});
const openPartyRosterMock = mock(() => {});
const selectGroupParticipantsMock = mock((): string[] => []);
const generateMultiNpcResponsesMock = mock(async (): Promise<string[]> => []);
const generateTurnMock = mock(async () => ({ narrative: 'single response' }));

const getMemberMock = mock((npcId: string) => membersArr.find((m) => m.npcId === npcId));
const getApprovalMock = mock(() => 0);

mock.module('$services', () => ({
  gameOverlayService: {
    clearStack: clearStackMock,
    openPartyRoster: openPartyRosterMock,
  },
  partyRosterService: {
    members: membersArr,
    getMember: getMemberMock,
    getApproval: getApprovalMock,
  },
  autonomousMessageService: {
    selectGroupParticipants: selectGroupParticipantsMock,
    generateMultiNpcResponses: generateMultiNpcResponsesMock,
  },
}));

const npcDialogueService = { generateTurn: generateTurnMock };

const setRoster = (names: string[]): void => {
  membersArr.length = 0;
  for (const [index, name] of names.entries()) {
    membersArr.push({ npcId: `npc_${index}`, name, classId: 'fighter', level: 1, approval: 0 });
  }
};

let getTalkToPartyViewModel: (
  options: Parameters<
    typeof import('./talk_to_party_view_model.svelte').getTalkToPartyViewModel
  >[0],
) => TalkToPartyViewModelInterface;

const createViewModel = (npcId = 'npc_0', npcName = 'Alpha'): TalkToPartyViewModelInterface =>
  getTalkToPartyViewModel({
    className: 'TalkToPartyViewModel',
    npcId,
    npcName,
    npcDialogueService: npcDialogueService as never,
  });

beforeEach(async () => {
  membersArr.length = 0;
  clearStackMock.mockClear();
  openPartyRosterMock.mockClear();
  selectGroupParticipantsMock.mockClear();
  generateMultiNpcResponsesMock.mockClear();
  generateTurnMock.mockClear();

  // Dynamic import AFTER mock.module so the '$services' mock is applied
  // (mirrors party_roster_view_model.test.ts).
  const mod = await import('./talk_to_party_view_model.svelte');
  getTalkToPartyViewModel = mod.getTalkToPartyViewModel;
});

describe('TalkToPartyViewModel — C-493 AC-1 (group turn)', () => {
  it('routes through generateMultiNpcResponses when two companions are present', async () => {
    setRoster(['Alpha', 'Beta']);
    selectGroupParticipantsMock.mockReturnValue(['npc_1']);
    generateMultiNpcResponsesMock.mockResolvedValue(['Alpha responds', 'Beta responds']);

    const viewModel = createViewModel('npc_0', 'Alpha');
    viewModel.setInput('Hello party!');
    await viewModel.sendMessage();

    expect(selectGroupParticipantsMock).toHaveBeenCalledWith({
      npcIds: ['npc_1'],
      count: MAX_GROUP_PARTICIPANTS - 1,
    });
    expect(generateMultiNpcResponsesMock).toHaveBeenCalledWith({
      npcIds: ['npc_0', 'npc_1'],
      playerMessage: 'Hello party!',
      recentChat: expect.any(Array) as unknown as readonly string[],
    });
    // Group path must NOT fall through to the single-companion path.
    expect(generateTurnMock).not.toHaveBeenCalled();

    // Greeting + two group replies, each labelled with its sender.
    const npcMessages = viewModel.messages.filter((m) => m.role === 'npc');
    expect(npcMessages.length).toBe(3);
    expect(npcMessages[1]?.content).toBe('Alpha responds');
    expect(npcMessages[1]?.senderName).toBe('Alpha');
    expect(npcMessages[2]?.content).toBe('Beta responds');
    expect(npcMessages[2]?.senderName).toBe('Beta');
  });

  it('uses the raw NPC ID when a selected responder is missing from the roster', async () => {
    setRoster(['Alpha', 'Beta']);
    selectGroupParticipantsMock.mockReturnValue(['npc_missing']);
    generateMultiNpcResponsesMock.mockResolvedValue(['Alpha responds', 'Unknown responds']);

    const viewModel = createViewModel('npc_0', 'Alpha');
    viewModel.setInput('Hello party!');
    await viewModel.sendMessage();

    const npcMessages = viewModel.messages.filter((message) => message.role === 'npc');
    expect(npcMessages[2]?.senderName).toBe('npc_missing');
  });

  it('falls back to generateTurn when only one companion is present', async () => {
    setRoster(['Alpha']);
    generateTurnMock.mockResolvedValue({ narrative: 'Alpha alone responds' });

    const viewModel = createViewModel('npc_0', 'Alpha');
    viewModel.setInput('Hello!');
    await viewModel.sendMessage();

    expect(selectGroupParticipantsMock).not.toHaveBeenCalled();
    expect(generateMultiNpcResponsesMock).not.toHaveBeenCalled();
    expect(generateTurnMock).toHaveBeenCalledTimes(1);
    expect(viewModel.messages[viewModel.messages.length - 1]?.content).toBe('Alpha alone responds');
  });

  it('does not select a group when no companions are in the party', async () => {
    setRoster([]);
    generateTurnMock.mockResolvedValue({ narrative: 'no party response' });

    const viewModel = createViewModel('npc_0', 'Alpha');
    viewModel.setInput('Anyone there?');
    await viewModel.sendMessage();

    expect(selectGroupParticipantsMock).not.toHaveBeenCalled();
    expect(generateTurnMock).toHaveBeenCalledTimes(1);
  });
});
