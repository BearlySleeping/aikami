// apps/frontend/client/src/lib/services/npc/autonomous_message_service.test.ts
//
// Unit tests for AutonomousMessageService — poller lifecycle,
// tick guards, weighted NPC selection, cooldown enforcement.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { afterEach, beforeEach, describe, expect, it, jest, mock, setSystemTime } from 'bun:test';
import type { CharacterRelationship } from '@aikami/types';
import type { AutonomousMessageServiceInterface } from './autonomous_message_service.svelte.ts';

// Mock dependencies — bun:test mock.module (vitest's vi.mock is not
// available under the bun test runner).
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

const npcScheduleServiceMock = {
  getSchedule: mock(() => {}),
  getCachedSchedule: mock((npcId: string) => ({
    npcId,
    days: [],
    autonomousEnabled: true,
    talkativeness: 0.5,
    cooldownMinutes: 15,
    generated: false,
    updatedAt: new Date().toISOString(),
  })),
  isAvailable: mock(() => {}),
  getCurrentStatus: mock(() => {}),
};

mock.module('./npc_schedule_service.svelte.ts', () => ({
  npcScheduleService: npcScheduleServiceMock,
}));

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    streamChat: mock(() => {}),
    extractStructure: mock(() => {}),
  },
}));

const relationshipServiceMock = {
  getRelationship: mock((_characterId: string): CharacterRelationship | undefined => undefined),
  getStanding: mock((_factionId: string) => undefined),
};

mock.module('../game/relationship_service.svelte.ts', () => ({
  relationshipService: relationshipServiceMock,
}));

let autonomousMessageService: AutonomousMessageServiceInterface;

describe('AutonomousMessageService', () => {
  afterEach(() => {
    autonomousMessageService.stop();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    setSystemTime(new Date('2026-07-10T12:00:00Z'));

    // Reset idleDetectionService.isIdle mock to default true value
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    idleDetectionService.isIdle.mockReturnValue(true);

    relationshipServiceMock.getRelationship.mockReturnValue(undefined);

    ({ autonomousMessageService } = await import('./autonomous_message_service.svelte.ts'));
  });

  it('should start and stop the poller', async () => {
    expect(autonomousMessageService.isRunning).toBe(false);

    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);

    autonomousMessageService.stop();
    expect(autonomousMessageService.isRunning).toBe(false);

    jest.clearAllTimers();
  });

  it('should not tick when DND is active', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');

    // @ts-expect-error: mock mutation
    idleDetectionService.isDnd = true;

    autonomousMessageService.start();
    jest.advanceTimersByTime(60_000);

    // No messages should be generated
    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    idleDetectionService.isDnd = false;
    jest.clearAllTimers();
  });

  it('should not tick when player is not idle', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');

    idleDetectionService.isIdle.mockReturnValue(false);

    autonomousMessageService.start();
    jest.advanceTimersByTime(60_000);

    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    jest.clearAllTimers();
  });

  it('should not tick during combat', async () => {
    const { gameOverlayService } = await import('../game/game_overlay_service.svelte.ts');

    // @ts-expect-error: mock mutation
    gameOverlayService.activeOverlay = 'COMBAT';

    autonomousMessageService.start();
    jest.advanceTimersByTime(60_000);

    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    gameOverlayService.activeOverlay = 'NONE';
    jest.clearAllTimers();
  });

  it('should not tick when chat is actively streaming', async () => {
    const { chatService } = await import('../chat/chat.svelte.ts');

    // @ts-expect-error: mock mutation
    chatService.isTyping = true;

    autonomousMessageService.start();
    jest.advanceTimersByTime(60_000);

    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    chatService.isTyping = false;
    jest.clearAllTimers();
  });

  it('should favor a friendly NPC during weighted selection', () => {
    relationshipServiceMock.getRelationship.mockImplementation((characterId) =>
      characterId === 'npc-friendly'
        ? {
            id: 'rel_test_1',
            uid: 'test',
            characterId: 'npc-friendly',
            relationshipType: 'friend',
            trust: 60,
            affinity: 40,
            history: [],
            notes: '',
            updatedAt: new Date().toISOString(),
          }
        : undefined,
    );
    jest.spyOn(Math, 'random').mockReturnValue(0.45);

    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: ['npc-unknown', 'npc-friendly'],
      count: 1,
    });

    expect(selected).toEqual(['npc-friendly']);
  });

  it('should preserve talkativeness-only selection for unknown relationships', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.25);

    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: ['npc-unknown', 'npc-other'],
      count: 1,
    });

    expect(selected).toEqual(['npc-unknown']);
  });

  it('should reduce a hostile NPC weighting during selection', () => {
    relationshipServiceMock.getRelationship.mockImplementation((characterId) =>
      characterId === 'npc-hostile'
        ? {
            id: 'rel_test_2',
            uid: 'test',
            characterId: 'npc-hostile',
            relationshipType: 'enemy',
            trust: -80,
            affinity: -60,
            history: [],
            notes: '',
            updatedAt: new Date().toISOString(),
          }
        : undefined,
    );
    jest.spyOn(Math, 'random').mockReturnValue(0.25);

    const selected = autonomousMessageService.selectGroupParticipants({
      npcIds: ['npc-hostile', 'npc-unknown'],
      count: 1,
    });

    expect(selected).toEqual(['npc-unknown']);
  });

  it('should pause and resume the poller', async () => {
    expect(autonomousMessageService.isPaused).toBe(false);
    autonomousMessageService.pause();
    expect(autonomousMessageService.isPaused).toBe(true);
    autonomousMessageService.resume();
    expect(autonomousMessageService.isPaused).toBe(false);

    jest.clearAllTimers();
  });
});
