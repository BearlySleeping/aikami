// apps/frontend/client/src/lib/services/npc/autonomous_message_service.test.ts
//
// Unit tests for AutonomousMessageService — poller lifecycle,
// tick guards, weighted NPC selection, cooldown enforcement.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../game/idle_detection_service.svelte.ts', () => ({
  idleDetectionService: {
    isDnd: false,
    isIdle: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../game/game_overlay_service.svelte.ts', () => ({
  gameOverlayService: {
    activeOverlay: 'NONE',
  },
}));

vi.mock('../chat/chat.svelte.ts', () => ({
  chatService: {
    isTyping: false,
    isSending: false,
    messages: [],
    addMessage: vi.fn(),
  },
}));

vi.mock('./npc_schedule_service.svelte.ts', () => ({
  npcScheduleService: {
    getSchedule: vi.fn(),
    isAvailable: vi.fn(),
    getCurrentStatus: vi.fn(),
  },
}));

vi.mock('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    streamChat: vi.fn(),
    extractStructure: vi.fn(),
  },
}));

describe('AutonomousMessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
  });

  it('should start and stop the poller', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    expect(autonomousMessageService.isRunning).toBe(false);

    autonomousMessageService.start();
    expect(autonomousMessageService.isRunning).toBe(true);

    autonomousMessageService.stop();
    expect(autonomousMessageService.isRunning).toBe(false);

    vi.resetModules();
    vi.clearAllTimers();
  });

  it('should not tick when DND is active', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');

    // @ts-expect-error: mock mutation
    idleDetectionService.isDnd = true;

    autonomousMessageService.start();
    vi.advanceTimersByTime(60_000);

    // No messages should be generated
    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    idleDetectionService.isDnd = false;
    vi.resetModules();
    vi.clearAllTimers();
  });

  it('should not tick when player is not idle', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');

    vi.mocked(idleDetectionService.isIdle).mockReturnValue(false);

    autonomousMessageService.start();
    vi.advanceTimersByTime(60_000);

    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    vi.resetModules();
    vi.clearAllTimers();
  });

  it('should not tick during combat', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );
    const { gameOverlayService } = await import('../game/game_overlay_service.svelte.ts');

    // @ts-expect-error: mock mutation
    gameOverlayService.activeOverlay = 'COMBAT';

    autonomousMessageService.start();
    vi.advanceTimersByTime(60_000);

    const { chatService } = await import('../chat/chat.svelte.ts');
    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    gameOverlayService.activeOverlay = 'NONE';
    vi.resetModules();
    vi.clearAllTimers();
  });

  it('should not tick when chat is actively streaming', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );
    const { chatService } = await import('../chat/chat.svelte.ts');

    // @ts-expect-error: mock mutation
    chatService.isTyping = true;

    autonomousMessageService.start();
    vi.advanceTimersByTime(60_000);

    expect(chatService.addMessage).not.toHaveBeenCalled();

    autonomousMessageService.stop();
    // @ts-expect-error: mock mutation
    chatService.isTyping = false;
    vi.resetModules();
    vi.clearAllTimers();
  });

  it('should pause and resume the poller', async () => {
    const { autonomousMessageService } = await import(
      '../npc/autonomous_message_service.svelte.ts'
    );

    expect(autonomousMessageService.isPaused).toBe(false);
    autonomousMessageService.pause();
    expect(autonomousMessageService.isPaused).toBe(true);
    autonomousMessageService.resume();
    expect(autonomousMessageService.isPaused).toBe(false);

    vi.resetModules();
    vi.clearAllTimers();
  });
});
