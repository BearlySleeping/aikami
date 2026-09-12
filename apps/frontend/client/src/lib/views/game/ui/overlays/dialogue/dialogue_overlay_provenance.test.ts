// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_provenance.test.ts
//
// Integration tests for dialogue check provenance (design §8): the ViewModel
// opens a durable operation before the roll animation and settles it from the
// authoritative resolution. Kept in its own file so the main ViewModel suite
// stays within the test size budget.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { BeginGameOperationOptions, GameOperation } from '@aikami/types';
import { createDefaultSheet } from '@aikami/utils';
import type { NpcDialogueServiceInterface } from '$services';
import {
  createDialogueOverlayViewModel,
  type DialogueOverlayViewModelInterface,
  type DialogueOverlayViewModelOptions,
} from './dialogue_overlay_view_model.svelte';

const createOperationLedger = () => ({
  begin: mock(
    async (options: BeginGameOperationOptions): Promise<GameOperation> => ({
      schemaVersion: 1,
      operationId: 'op-1',
      kind: options.kind,
      status: 'pending',
      campaignId: options.campaignId,
      conversationId: options.conversationId,
      checkId: options.checkId,
      request: JSON.stringify(options.request ?? {}),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  ),
  complete: mock(async () => {}),
  fail: mock(async () => {}),
});

const createVm = (options?: {
  omitOperations?: boolean;
  resolveRoll?: () => Promise<unknown>;
}): {
  vm: DialogueOverlayViewModelInterface;
  operations: ReturnType<typeof createOperationLedger>;
} => {
  const operations = createOperationLedger();
  const npcDialogueService = {
    useFreeTextFirst: true,
    turnState: { kind: 'idle' },
    activeNpc: undefined,
    resolveRoll:
      options?.resolveRoll ??
      mock(async () => ({ narrativeResult: 'Resolved.', stateDeltas: [], suggestedChips: [] })),
  } as unknown as NpcDialogueServiceInterface;

  const vm = createDialogueOverlayViewModel({
    className: 'DialogueOverlayProvenanceTest',
    npcData: { npcId: 'npc-001', npcName: 'Elder Thrain', dialog: '' },
    onEndChat: () => {},
    npcDialogueService,
    ...(options?.omitOperations ? {} : { operations, campaign: { campaignId: 'camp-1' } }),
    combat: { lastCombatOptions: undefined },
    dice: { rollD20: () => ({ natural: 14, total: 14 }) },
    draft: { saveDraft: async () => {}, loadDraft: async () => '', clearDraft: async () => {} },
    expression: {
      detectExpression: async () => ({ expressionMap: {}, detectionTier: 'keyword' as const }),
    },
    gameMode: { currentMode: 'DIALOGUE' },
    image: { generateImage: async () => ({ url: '', isDemo: true }) },
    messageBranch: {
      swipeAlternative: () => {},
      clearAlternatives: () => {},
      addAlternative: () => {},
      enrichMessage: (message: { id: string; text: string; sender: string; timestamp: Date }) => ({
        ...message,
        alternativeCount: 1,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
        showActions: true,
      }),
    },
    quest: { acceptQuest: () => true, declineQuest: () => {}, getOfferableQuests: () => [] },
    router: { goToHref: async () => {} },
    tts: {
      status: 'uninitialized',
      isPlaying: false,
      initialize: async () => {},
      speak: async () => {},
      stop: () => {},
    },
    chunker: class {
      onSentence(): void {}
      feed(): void {}
      close(): void {}
    },
    gameStateFacts: () => [],
    playerState: {
      characterSheet: createDefaultSheet(),
      isCharacterSheetAuthored: true,
      classId: 'fighter',
    },
  } satisfies DialogueOverlayViewModelOptions);

  return { vm, operations };
};

const setAwaitingCheck = (vm: DialogueOverlayViewModelInterface): void => {
  vm.skillCheckState = {
    checkType: 'Persuasion',
    difficultyClass: 12,
    breakdown: {
      ability: 'charisma',
      abilityLabel: 'CHA',
      abilityModifier: 3,
      isProficient: true,
      isExpertise: false,
      proficiencyBonus: 2,
      totalModifier: 5,
    },
    stakes: { success: 'Convinced.', failure: 'Trust drops.' },
    targetNumber: 7,
    rollValue: null,
    phase: 'declared',
    isSuccess: null,
  };
  vm.acknowledgeDeclaration();
};

afterEach(() => {
  mock.restore();
});

describe('DialogueOverlayViewModel — check provenance', () => {
  test('rollDice opens and completes a durable skill-check operation', async () => {
    const { vm, operations } = createVm();
    setAwaitingCheck(vm);

    await vm.rollDice();

    const beginOptions = operations.begin.mock.calls[0]?.[0];
    expect(beginOptions).toMatchObject({
      kind: 'skill_check',
      campaignId: 'camp-1',
      conversationId: 'npc-001',
    });
    expect(beginOptions?.request).toMatchObject({
      checkType: 'Persuasion',
      difficultyClass: 12,
      natural: 14,
      total: 14,
      isSuccess: true,
    });
    expect(operations.complete).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({ natural: 14, total: 14, isSuccess: true }),
    );
    expect(operations.fail).not.toHaveBeenCalled();
  });

  test('a resolution failure settles the check operation as failed', async () => {
    const { vm, operations } = createVm({
      resolveRoll: async () => {
        throw new Error('provider down');
      },
    });
    setAwaitingCheck(vm);

    await vm.rollDice();

    expect(operations.fail).toHaveBeenCalledWith('op-1', 'provider down');
    expect(operations.complete).not.toHaveBeenCalled();
  });

  test('without a ledger capability the check still resolves', async () => {
    const { vm } = createVm({ omitOperations: true });
    setAwaitingCheck(vm);

    await vm.rollDice();

    // The dice flow completes normally; provenance is simply skipped.
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
  });
});
