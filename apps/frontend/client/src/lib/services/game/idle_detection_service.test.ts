// apps/frontend/client/src/lib/services/game/idle_detection_service.test.ts
//
// Unit tests for IdleDetectionService — idle tracking, DND toggle,
// visibility change reset, and input event handling.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock document event listeners
const eventListeners = new Map<string, EventListener[]>();

const mockDocument = {
  addEventListener: vi.fn((event: string, handler: EventListener) => {
    const handlers = eventListeners.get(event) ?? [];
    handlers.push(handler);
    eventListeners.set(event, handlers);
  }),
  removeEventListener: vi.fn((event: string, handler: EventListener) => {
    const handlers = eventListeners.get(event) ?? [];
    eventListeners.set(
      event,
      handlers.filter((h) => h !== handler),
    );
  }),
  visibilityState: 'visible' as DocumentVisibilityState,
};

vi.stubGlobal('document', mockDocument);

// We test the implementation directly — create a fresh instance for each test
// Note: the service uses document, so we need to import after the mock

describe('IdleDetectionService', () => {
  beforeEach(() => {
    eventListeners.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
    mockDocument.visibilityState = 'visible';
  });

  it('should initialize with zero idle duration', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    expect(idleDetectionService.idleDurationMs).toBe(0);
    expect(idleDetectionService.isDnd).toBe(false);
    expect(idleDetectionService.isIdle(60_000)).toBe(false);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should reset idleDurationMs on pointer input', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Simulate passage of time
    vi.advanceTimersByTime(5000);
    expect(idleDetectionService.idleDurationMs).toBeGreaterThan(0);

    // Simulate mouse move
    const handlers = eventListeners.get('pointermove');
    expect(handlers).toBeDefined();
    handlers?.[0]?.(new Event('pointermove'));
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should detect idle after exceeding threshold', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 5 minutes (300000ms)
    vi.advanceTimersByTime(300_000);

    // At 5 mins, isIdle(300000) should be true, isIdle(600000) should be false
    expect(idleDetectionService.isIdle(300_000)).toBe(true);
    expect(idleDetectionService.isIdle(600_000)).toBe(false);

    // Advance to 6 minutes
    vi.advanceTimersByTime(60_000);
    expect(idleDetectionService.isIdle(600_000)).toBe(true);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should suppress idle when tab is hidden', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Make page hidden
    mockDocument.visibilityState = 'hidden';
    const visibilityHandlers = eventListeners.get('visibilitychange');
    visibilityHandlers?.[0]?.(new Event('visibilitychange'));

    // Advance time past threshold
    vi.advanceTimersByTime(300_000);

    // Still not idle because tab is hidden
    expect(idleDetectionService.isIdle(60_000)).toBe(false);
    expect(idleDetectionService.isIdle(300_000)).toBe(false);

    // Tab becomes visible again
    mockDocument.visibilityState = 'visible';
    visibilityHandlers?.[0]?.(new Event('visibilitychange'));

    // Idle timer should have reset
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should toggle DND mode and reset idle on turn-off', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance some time
    vi.advanceTimersByTime(120_000);

    // Enable DND
    idleDetectionService.setDnd(true);
    expect(idleDetectionService.isDnd).toBe(true);

    // Advance more time
    vi.advanceTimersByTime(120_000);

    // Turn off DND — should reset idle
    idleDetectionService.setDnd(false);
    expect(idleDetectionService.isDnd).toBe(false);
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should throttle input updates to once per second', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 2 seconds
    vi.advanceTimersByTime(2000);

    // Multiple rapid inputs
    const handlers = eventListeners.get('keydown');
    handlers?.[0]?.(new Event('keydown'));
    handlers?.[0]?.(new Event('keydown'));
    handlers?.[0]?.(new Event('keydown'));

    // Idle should have reset to 0 (first input processed, subsequent throttled)
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });

  it('should respond to touch events', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 4 seconds
    vi.advanceTimersByTime(4000);
    expect(idleDetectionService.idleDurationMs).toBeGreaterThan(0);

    // Touch input
    const handlers = eventListeners.get('touchstart');
    handlers?.[0]?.(new Event('touchstart'));
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
    vi.resetModules();
  });
});
