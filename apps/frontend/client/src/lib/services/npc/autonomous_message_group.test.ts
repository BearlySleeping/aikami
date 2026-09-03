// apps/frontend/client/src/lib/services/npc/autonomous_message_group.test.ts
//
// Unit tests for AutonomousMessageService group-turn capabilities —
// multi-NPC selection (AC-3), bounded cap (AC-5), and regression
// guard for idle-chat behavior (AC-4).
//
// Contract: C-456 Group Chat & Systemic NPC Interactions (AC-3, AC-4, AC-5)

import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime, vi } from 'bun:test';
import { DEFAULT_POLLER_INTERVAL_MS, MAX_GROUP_PARTICIPANTS } from '@aikami/constants';
import type { TextGenerationServiceInterface } from '../ai/text_generation_service.svelte.ts';
import type { AutonomousMessageServiceInterface } from './autonomous_message_service.svelte.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

const idleDetectionServiceMock = {
  isDnd: false,
  isIdle: mock(() => true),
};
const gameOverlayServiceMock = { activeOverlay: 'NONE' };
const worldStateServiceMock: {
  worldGenOutput: { npcs: Array<{ name: string }> };
} = { worldGenOutput: { npcs: [] } };

mock.module('$services', () => ({
  idleDetectionService: idleDetectionServiceMock,
  gameOverlayService: gameOverlayServiceMock,
  worldStateService: worldStateServiceMock,
}));

const chatServiceMock = {
  isTyping: false,
  isSending: false,
  messages: [],
  addMessage: mock(() => {}),
};
mock.module('../chat/chat.svelte.ts', () => ({
  chatService: chatServiceMock,
}));

const scheduleTalkativeness = new Map<string, number>();
const createMockSchedule = (npcId: string) => ({
  npcId,
  days: [],
  autonomousEnabled: true,
  talkativeness: scheduleTalkativeness.get(npcId) ?? 0.5,
  cooldownMinutes: 15,
  generated: false,
  updatedAt: new Date().toISOString(),
});
const npcScheduleServiceMock = {
  getSchedule: mock((npcId: string) => Promise.resolve(createMockSchedule(npcId))),
  getCachedSchedule: mock((npcId: string) => createMockSchedule(npcId)),
  isAvailable: mock(() => Promise.resolve(true)),
  getCurrentStatus: mock(() => 'online'),
};
mock.module('./npc_schedule_service.svelte.ts', () => ({
  npcScheduleService: npcScheduleServiceMock,
}));

const streamChatMock = mock(
  async (options: Parameters<TextGenerationServiceInterface['streamChat']>[0]) => {
    options.onChunk('NPC response');
  },
);
mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    streamChat: streamChatMock,
    extractStructure: mock(() => {}),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

let autonomousMessageService: AutonomousMessageServiceInterface;
let textGenerationService: TextGenerationServiceInterface;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setSystemTime(new Date('2026-09-02T12:00:00Z'));
  scheduleTalkativeness.clear();
  worldStateServiceMock.worldGenOutput.npcs = [];
  gameOverlayServiceMock.activeOverlay = 'NONE';
  idleDetectionServiceMock.isDnd = false;
  chatServiceMock.isTyping = false;
  chatServiceMock.isSending = false;
  chatServiceMock.messages = [];
  streamChatMock.mockImplementation(async (options) => {
    options.onChunk('NPC response');
  });
  ({ autonomousMessageService } = await import('./autonomous_message_service.svelte.ts'));
  ({ textGenerationService } = await import('../ai/text_generation_service.svelte.ts'));
});

afterEach(() => {
  autonomousMessageService.stop();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AutonomousMessageService — AC-5 (Bounded Cap)', () => {
  it('should cap selection at MAX_GROUP_PARTICIPANTS', () => {
    const npcIds = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: MAX_GROUP_PARTICIPANTS + 2,
    });

    expect(selected.length).toBe(MAX_GROUP_PARTICIPANTS);

    // Each selected NPC should be from the original pool
    for (const id of selected) {
      expect(npcIds).toContain(id);
    }
  });

  it('should return all NPCs when pool is smaller than cap', () => {
    const npcIds = ['npc_a', 'npc_b'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: 5,
    });

    expect(selected.length).toBe(2);
  });

  it('should return empty array for empty pool', () => {
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: [],
      count: 3,
    });

    expect(selected).toEqual([]);
  });

  it('should not select duplicates from a pool containing repeated IDs', () => {
    const npcIds = ['npc_a', 'npc_a', 'npc_b', 'npc_b', 'npc_c', 'npc_c'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: 3,
    });

    const unique = new Set(selected);
    expect(unique.size).toBe(selected.length);
    expect(selected.length).toBe(MAX_GROUP_PARTICIPANTS);
  });

  it('should use live cached talkativeness for weighted selection', () => {
    scheduleTalkativeness.set('npc_silent', 0);
    scheduleTalkativeness.set('npc_talkative', 1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: ['npc_silent', 'npc_talkative'],
      count: 1,
    });

    expect(selected).toEqual(['npc_talkative']);
  });
});

describe('AutonomousMessageService — AC-3 (Multi-NPC Response)', () => {
  it('should generate responses for multiple NPCs sequentially', async () => {
    const firstStream = createDeferred();
    const secondStream = createDeferred();
    const secondStreamStarted = createDeferred();
    const prompts: string[] = [];
    let callCount = 0;
    streamChatMock.mockImplementation((options) => {
      callCount++;
      const responseNumber = callCount;
      prompts.push(options.messages[1]?.content ?? '');
      if (responseNumber === 1) {
        return firstStream.promise.then(() => {
          options.onChunk('NPC response 1');
        });
      }
      secondStreamStarted.resolve();
      return secondStream.promise.then(() => {
        options.onChunk('NPC response 2');
      });
    });

    const responsesPromise = autonomousMessageService.generateMultiNpcResponses({
      npcIds: ['npc_a', 'npc_b'],
      playerMessage: 'Hello everyone!',
      recentChat: ['Previous message 1', 'Previous message 2'],
    });

    expect(callCount).toBe(1);
    firstStream.resolve();
    await secondStreamStarted.promise;
    expect(callCount).toBe(2);
    expect(prompts[1]).toContain('NPC response 1');
    secondStream.resolve();

    const responses = await responsesPromise;
    expect(responses.length).toBe(2);
    expect(responses[0]).toBe('NPC response 1');
    expect(responses[1]).toBe('NPC response 2');
    expect(callCount).toBe(2);
  });

  it('should return empty array for empty NPC list', async () => {
    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: [],
      playerMessage: 'Hello!',
      recentChat: [],
    });

    expect(responses).toEqual([]);
  });

  it('should handle generation failure for one NPC without stopping the sequence', async () => {
    let callCount = 0;
    streamChatMock.mockImplementation(async (options) => {
      callCount++;
      if (callCount === 1) {
        options.onChunk('First NPC response');
      } else if (callCount === 2) {
        throw new Error('Generation failed');
      } else {
        options.onChunk('Third NPC response');
      }
    });

    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: ['npc_a', 'npc_b', 'npc_c'],
      playerMessage: 'Hello!',
      recentChat: [],
    });

    expect(responses.length).toBe(3);
    expect(responses[0]).toBe('First NPC response');
    expect(responses[1]).toBe(''); // Failed NPC gets empty string
    expect(responses[2]).toBe('Third NPC response');
    expect(callCount).toBe(3);
  });

  it('should cap generated responses at MAX_GROUP_PARTICIPANTS', async () => {
    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'],
      playerMessage: 'Hello!',
      recentChat: [],
    });

    expect(responses.length).toBe(MAX_GROUP_PARTICIPANTS);
    expect(textGenerationService.streamChat).toHaveBeenCalledTimes(MAX_GROUP_PARTICIPANTS);
  });
});

describe('AutonomousMessageService — AC-4 (Idle-Chart Regression Guard)', () => {
  it('should still use single-NPC selection for idle ticks', async () => {
    const messageAdded = createDeferred();
    worldStateServiceMock.worldGenOutput.npcs = [{ name: 'npc_idle' }];
    chatServiceMock.addMessage.mockImplementation(() => {
      messageAdded.resolve();
    });

    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);
    vi.advanceTimersByTime(DEFAULT_POLLER_INTERVAL_MS);
    await messageAdded.promise;

    expect(textGenerationService.streamChat).toHaveBeenCalledTimes(1);
    expect(chatServiceMock.addMessage).toHaveBeenCalledTimes(1);
    expect(chatServiceMock.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'NPC response' }),
    );
    autonomousMessageService.stop();
    expect(autonomousMessageService.isRunning).toBe(false);
  });

  it('selectGroupParticipants should not interfere with idle cooldowns', () => {
    // Calling selectGroupParticipants should not affect the poller state
    const npcIds = ['npc_a', 'npc_b', 'npc_c'];
    autonomousMessageService.selectGroupParticipants({ npcIds, count: 2 });

    // Poller should still be stoppable and startable
    expect(autonomousMessageService.isRunning).toBe(false);
    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);
    autonomousMessageService.stop();
  });
});

const createDeferred = (): { promise: Promise<void>; resolve(): void } => {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
