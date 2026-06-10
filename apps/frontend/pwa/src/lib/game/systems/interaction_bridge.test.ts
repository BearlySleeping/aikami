// apps/frontend/pwa/src/lib/game/systems/interaction_bridge.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  type DialogueGeneratorInterface,
  type DialogueGeneratorOptions,
  type InputLockTarget,
  InteractionBridge,
} from './interaction_bridge.ts';
import type { InteractableNpcEntry } from './interaction_system.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createMockNpc = (overrides?: Partial<InteractableNpcEntry>): InteractableNpcEntry => ({
  eid: 1,
  position: { x: 100, y: 200 },
  radius: 64,
  inRange: true,
  npcName: 'Elder Thrain',
  personaId: 'persona-elder-001',
  npcId: 'npc-elder-001',
  relationshipValue: 50,
  ...overrides,
});

const createMockGenerator = (): DialogueGeneratorInterface & {
  generateDialogueSpy: ReturnType<typeof mock>;
  cancelGenerationSpy: ReturnType<typeof mock>;
} => {
  let isGenerating = false;
  let currentText = '';

  const generateDialogueSpy = mock((_options: DialogueGeneratorOptions) => {
    isGenerating = true;
    currentText = '';
    return Promise.resolve();
  });

  const cancelGenerationSpy = mock(() => {
    isGenerating = false;
    currentText = '';
  });

  return {
    get isGenerating() {
      return isGenerating;
    },
    get currentText() {
      return currentText;
    },
    generateDialogue: generateDialogueSpy,
    cancelGeneration: cancelGenerationSpy,
    generateDialogueSpy,
    cancelGenerationSpy,
  };
};

const createMockInputLock = (): InputLockTarget & {
  lockCalls: boolean[];
} => {
  const lockCalls: boolean[] = [];

  return {
    setInputLocked(locked: boolean): void {
      lockCalls.push(locked);
    },
    lockCalls,
  };
};

// ---------------------------------------------------------------------------
// AC2: ECS Interaction Trigger
// ---------------------------------------------------------------------------

describe('InteractionBridge — AC2: ECS Interaction Trigger', () => {
  let bridge: InteractionBridge;
  let generator: ReturnType<typeof createMockGenerator>;
  let inputLock: ReturnType<typeof createMockInputLock>;

  beforeEach(() => {
    generator = createMockGenerator();
    inputLock = createMockInputLock();
    bridge = new InteractionBridge({ generator, inputLock });
  });

  test('should invoke generateDialogue with correct NPC metadata', () => {
    const npc = createMockNpc();

    const result = bridge.handleInteractStart(npc);

    expect(result).toBe(true);
    expect(generator.generateDialogueSpy).toHaveBeenCalledTimes(1);

    const callArg = generator.generateDialogueSpy.mock.calls[0][0] as DialogueGeneratorOptions;
    expect(callArg.npcId).toBe('npc-elder-001');
    expect(callArg.personaId).toBe('persona-elder-001');
  });

  test('should lock player input when interaction starts', () => {
    const npc = createMockNpc();

    bridge.handleInteractStart(npc);

    expect(inputLock.lockCalls).toEqual([true]);
  });

  test('should guard against rapid re-triggering when generator is active', () => {
    const npc = createMockNpc();

    // First interaction starts generation
    const firstResult = bridge.handleInteractStart(npc);
    expect(firstResult).toBe(true);

    // Simulate that generation is now in progress
    // The mock's isGenerating was set to true by the first call

    // Second interaction should be ignored
    const secondResult = bridge.handleInteractStart(npc);
    expect(secondResult).toBe(false);

    // generateDialogue should only have been called once
    expect(generator.generateDialogueSpy).toHaveBeenCalledTimes(1);
    // Input lock should have been set once
    expect(inputLock.lockCalls).toEqual([true]);
  });

  test('should allow new interaction after generation is cancelled', () => {
    const npc1 = createMockNpc();
    const npc2 = createMockNpc({ npcId: 'npc-merchant-002', personaId: 'persona-merchant-002' });

    // First interaction
    bridge.handleInteractStart(npc1);
    expect(generator.generateDialogueSpy).toHaveBeenCalledTimes(1);

    // Cancel the first generation (simulates user closing dialogue)
    generator.cancelGeneration();
    generator.generateDialogueSpy.mockClear();

    // Second interaction should work now
    const result = bridge.handleInteractStart(npc2);
    expect(result).toBe(true);
    expect(generator.generateDialogueSpy).toHaveBeenCalledTimes(1);
  });

  test('handleInteractEnd should cancel generation and unlock input', () => {
    const npc = createMockNpc();

    bridge.handleInteractStart(npc);

    // Clear the lockCalls from handleInteractStart
    inputLock.lockCalls.length = 0;

    bridge.handleInteractEnd();

    expect(generator.cancelGenerationSpy).toHaveBeenCalledTimes(1);
    expect(inputLock.lockCalls).toEqual([false]);
  });
});
