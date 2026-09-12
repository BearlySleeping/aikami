// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.test.ts
//
// Unit tests for TalkToPartyViewModel — companion greeting tone, dialogue
// streaming delegation, and overlay navigation. Exercises the ViewModel
// through feature-owned capability fixtures — no global `$services` barrel
// mock / `mock.module`.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { PartyRosterEntry } from '@aikami/types';
import {
  createTalkToPartyViewModel,
  type TalkToPartyDialogueCapabilities,
  type TalkToPartyOverlayCapabilities,
  type TalkToPartyRosterCapabilities,
  type TalkToPartyViewModelOptions,
} from './talk_to_party_view_model.svelte';

// ── Fixtures ──────────────────────────────────────────────────────────────

const createMember = (overrides: Partial<PartyRosterEntry> = {}): PartyRosterEntry => ({
  npcId: 'lydia',
  name: 'Lydia',
  classId: 'cleric',
  level: 1,
  approval: 0,
  recruitedAt: '2026-01-01T00:00:00.000Z',
  personalQuestActive: false,
  equipmentSlotIds: [],
  ...overrides,
});

const createDialogue = (
  overrides: Partial<TalkToPartyDialogueCapabilities> = {},
): TalkToPartyDialogueCapabilities => ({
  generateTurn: async () => ({ narrative: 'Lydia smiles and nods.' }),
  ...overrides,
});

const createRoster = (
  overrides: Partial<TalkToPartyRosterCapabilities> = {},
): TalkToPartyRosterCapabilities => ({
  getMember: () => undefined,
  getApproval: () => 0,
  ...overrides,
});

const createOverlays = (
  overrides: Partial<TalkToPartyOverlayCapabilities> = {},
): TalkToPartyOverlayCapabilities => ({
  clearStack: () => {},
  openPartyRoster: () => {},
  ...overrides,
});

const createViewModel = (
  options: {
    npcId?: string;
    npcName?: string;
    npcDialogueService?: TalkToPartyDialogueCapabilities;
    partyRoster?: TalkToPartyRosterCapabilities;
    overlays?: TalkToPartyOverlayCapabilities;
  } = {},
) =>
  createTalkToPartyViewModel({
    className: 'TalkToPartyViewModelTest',
    npcId: options.npcId ?? 'lydia',
    npcName: options.npcName ?? 'Lydia',
    npcDialogueService: options.npcDialogueService ?? createDialogue(),
    partyRoster: options.partyRoster ?? createRoster(),
    overlays: options.overlays ?? createOverlays(),
  } satisfies TalkToPartyViewModelOptions);

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TalkToPartyViewModel — greeting tone', () => {
  test('greets neutrally when the companion is unknown', () => {
    const viewModel = createViewModel();

    expect(viewModel.messages).toHaveLength(1);
    expect(viewModel.messages[0]?.role).toBe('npc');
    expect(viewModel.messages[0]?.content).toContain('turns to you attentively');
    expect(viewModel.messages[0]?.content).not.toContain('happy');
    expect(viewModel.messages[0]?.content).not.toContain('warily');
  });

  test('adds a warm note when approval is high', () => {
    const viewModel = createViewModel({
      partyRoster: createRoster({ getMember: () => createMember({ approval: 80 }) }),
    });

    expect(viewModel.messages[0]?.content).toContain('particularly happy');
  });

  test('adds a wary note when approval is low', () => {
    const viewModel = createViewModel({
      partyRoster: createRoster({ getMember: () => createMember({ approval: -80 }) }),
    });

    expect(viewModel.messages[0]?.content).toContain('eye you warily');
  });
});

describe('TalkToPartyViewModel — approval and input', () => {
  test('approval delegates to the roster capability', () => {
    const viewModel = createViewModel({
      partyRoster: createRoster({ getApproval: () => 42 }),
    });

    expect(viewModel.approval).toBe(42);
  });

  test('setInput updates the bound input text', () => {
    const viewModel = createViewModel();

    viewModel.setInput('Hello there');

    expect(viewModel.inputText).toBe('Hello there');
  });
});

describe('TalkToPartyViewModel — sendMessage', () => {
  test('appends the player message and the generated NPC reply', async () => {
    const generateTurn = mock(async () => ({ narrative: 'She waves back.' }));
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({ generateTurn }),
    });
    viewModel.setInput('  Greetings  ');

    await viewModel.sendMessage();

    expect(generateTurn).toHaveBeenCalledTimes(1);
    const call = generateTurn.mock.calls[0]?.[0];
    expect(call?.npcId).toBe('lydia');
    expect(call?.npcName).toBe('Lydia');
    expect(call?.messages.at(-1)).toEqual({ role: 'player', content: 'Greetings' });

    expect(viewModel.inputText).toBe('');
    expect(viewModel.isStreaming).toBe(false);
    expect(viewModel.messages.at(-1)?.content).toBe('She waves back.');
    expect(viewModel.messages.at(-1)?.role).toBe('npc');
  });

  test('projects the conversation into the shared RichMessage shape', async () => {
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({
        generateTurn: async () => ({ narrative: 'Hello there.' }),
      }),
    });
    viewModel.setInput('Hi');
    await viewModel.sendMessage();

    const rich = viewModel.richMessages;
    expect(rich).toHaveLength(3);
    expect(rich[0]?.sender).toBe('ai');
    expect(rich[1]?.sender).toBe('user');
    expect(rich[1]?.text).toBe('Hi');
    expect(rich[2]?.sender).toBe('ai');
    expect(rich[2]?.text).toBe('Hello there.');
  });

  test('ignores empty input', async () => {
    const generateTurn = mock(async () => ({ narrative: 'unused' }));
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({ generateTurn }),
    });
    viewModel.setInput('   ');

    await viewModel.sendMessage();

    expect(generateTurn).not.toHaveBeenCalled();
    expect(viewModel.messages).toHaveLength(1);
  });

  test('falls back to an authored shrug when generation fails', async () => {
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({
        generateTurn: async () => {
          throw new Error('model offline');
        },
      }),
    });
    viewModel.setInput('Are you okay?');

    await viewModel.sendMessage();

    expect(viewModel.isStreaming).toBe(false);
    expect(viewModel.messages.at(-1)?.content).toContain('shrugs');
  });

  test('cancelStream aborts the turn without appending a fallback', async () => {
    const generateTurn = mock(
      (options: { signal: AbortSignal }) =>
        new Promise<{ narrative: string }>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({ generateTurn }),
    });
    viewModel.setInput('Hold on');

    const pending = viewModel.sendMessage();
    expect(viewModel.isStreaming).toBe(true);

    viewModel.cancelStream();
    await pending;

    expect(viewModel.isStreaming).toBe(false);
    expect(viewModel.messages.at(-1)?.content).toBe('Hold on');
    expect(viewModel.messages.some((message) => message.content.includes('shrugs'))).toBe(false);
  });
});

describe('TalkToPartyViewModel — overlay navigation', () => {
  test('close clears the stack and opens the party roster', () => {
    const clearStack = mock(() => {});
    const openPartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlays: createOverlays({ clearStack, openPartyRoster }),
    });

    viewModel.close();

    expect(clearStack).toHaveBeenCalledTimes(1);
    expect(openPartyRoster).toHaveBeenCalledTimes(1);
  });

  test('Escape closes the overlay', () => {
    const clearStack = mock(() => {});
    const openPartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlays: createOverlays({ clearStack, openPartyRoster }),
    });

    viewModel.handleKeyDown({
      key: 'Escape',
      preventDefault: () => {},
    } as KeyboardEvent);

    expect(clearStack).toHaveBeenCalledTimes(1);
    expect(openPartyRoster).toHaveBeenCalledTimes(1);
  });

  test('Enter without shift submits the current input', async () => {
    const generateTurn = mock(async () => ({ narrative: 'A reply.' }));
    const preventDefault = mock(() => {});
    const viewModel = createViewModel({
      npcDialogueService: createDialogue({ generateTurn }),
    });
    viewModel.setInput('Hi');

    viewModel.handleKeyDown({ key: 'Enter', shiftKey: false, preventDefault } as KeyboardEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(generateTurn).toHaveBeenCalledTimes(1);
  });
});

describe('TalkToPartyViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
