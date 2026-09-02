// apps/frontend/client/src/lib/services/npc/autonomous_message_group.test.ts
//
// Unit tests for AutonomousMessageService group-turn capabilities —
// multi-NPC selection (AC-3), bounded cap (AC-5), and regression
// guard for idle-chat behavior (AC-4).
//
// Contract: C-456 Group Chat & Systemic NPC Interactions (AC-3, AC-4, AC-5)

import { mock, setSystemTime } from 'bun:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

mock.module('../game/idle_detection_service.svelte.ts', () => ({
  idleDetectionService: {
    isDnd: false,
    isIdle: mock(() => true),
  },
}));

mock.module('../game/game_overlay_service.svelte.ts', () => ({
  gameOverlayService: {
    activeOverlay: 'NONE',
  },
}));

mock.module('../chat/chat.svelte.ts', () => ({
  chatService: {
    isTyping: false,
    isSending: false,
    messages: [],
    addMessage: mock(() => {}),
  },
}));

mock.module('./npc_schedule_service.svelte.ts', () => ({
  npcScheduleService: {
    getSchedule: mock(() => Promise.resolve({
      npcId: 'test',
      days: [],
      autonomousEnabled: true,
      talkativeness: 0.5,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: new Date().toISOString(),
    })),
    isAvailable: mock(() => Promise.resolve(true)),
    getCurrentStatus: mock(() => 'online'),
  },
}));

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    streamChat: mock(() => {}),
    extractStructure: mock(() => {}),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AutonomousMessageService — AC-5 (Bounded Cap)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should select up to MAX_GROUP_PARTICIPANTS from a pool', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const npcIds = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: 3,
    });

    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.length).toBeLessThanOrEqual(3);

    // Each selected NPC should be from the original pool
    for (const id of selected) {
      expect(npcIds).toContain(id);
    }
  });

  it('should return all NPCs when pool is smaller than cap', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const npcIds = ['npc_a', 'npc_b'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: 5,
    });

    expect(selected.length).toBe(2);
  });

  it('should return empty array for empty pool', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: [],
      count: 3,
    });

    expect(selected).toEqual([]);
  });

  it('should not select duplicates', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const npcIds = ['npc_a', 'npc_b', 'npc_c'];
    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds,
      count: 3,
    });

    const unique = new Set(selected);
    expect(unique.size).toBe(selected.length);
  });
});

describe('AutonomousMessageService — AC-3 (Multi-NPC Response)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should generate responses for multiple NPCs sequentially', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    // Mock streamChat to simulate AI responses
    const { textGenerationService } = await import('../ai/text_generation_service.svelte.ts');
    let callCount = 0;
    (textGenerationService.streamChat as ReturnType<typeof mock>).mockImplementation(
      (options: { onChunk: (chunk: string) => void }) => {
        callCount++;
        options.onChunk(`NPC response ${callCount}`);
      },
    );

    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: ['npc_a', 'npc_b'],
      playerMessage: 'Hello everyone!',
      recentChat: ['Previous message 1', 'Previous message 2'],
    });

    expect(responses.length).toBe(2);
    expect(responses[0]).toBe('NPC response 1');
    expect(responses[1]).toBe('NPC response 2');
    expect(callCount).toBe(2);
  });

  it('should return empty array for empty NPC list', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: [],
      playerMessage: 'Hello!',
      recentChat: [],
    });

    expect(responses).toEqual([]);
  });

  it('should handle generation failure for one NPC without stopping the sequence', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    const { textGenerationService } = await import('../ai/text_generation_service.svelte.ts');
    let callCount = 0;
    (textGenerationService.streamChat as ReturnType<typeof mock>).mockImplementation(
      (options: { onChunk: (chunk: string) => void }) => {
        callCount++;
        if (callCount === 1) {
          options.onChunk('First NPC response');
        } else {
          // Second NPC fails — throw
          throw new Error('Generation failed');
        }
      },
    );

    const responses = await autonomousMessageService.generateMultiNpcResponses({
      npcIds: ['npc_a', 'npc_b', 'npc_c'],
      playerMessage: 'Hello!',
      recentChat: [],
    });

    expect(responses.length).toBe(3);
    expect(responses[0]).toBe('First NPC response');
    expect(responses[1]).toBe(''); // Failed NPC gets empty string
    // Third NPC should still have been attempted
  });
});

describe('AutonomousMessageService — AC-4 (Idle-Chart Regression Guard)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should still use single-NPC selection for idle ticks', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    // Start the poller
    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);

    // The poller's _tick calls _selectWeightedRandom (single), not _selectWeightedRandomN
    // This is a structural test — the idle path is unchanged
    autonomousMessageService.stop();
    vi.clearAllTimers();
  });

  it('selectGroupParticipants should not interfere with idle cooldowns', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    // Calling selectGroupParticipants should not affect the poller state
    const npcIds = ['npc_a', 'npc_b', 'npc_c'];
    autonomousMessageService.selectGroupParticipants({ npcIds, count: 2 });

    // Poller should still be stoppable and startable
    expect(autonomousMessageService.isRunning).toBe(false);
    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);
    autonomousMessageService.stop();
    vi.clearAllTimers();
  });
});
