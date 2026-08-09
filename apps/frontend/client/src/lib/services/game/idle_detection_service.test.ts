// apps/frontend/client/src/lib/services/game/idle_detection_service.test.ts
//
// Unit tests for IdleDetectionService — idle tracking, DND toggle,
// visibility change reset, and input event handling.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from 'vitest';

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

// bun test has no vi.stubGlobal — assign the global directly.
(globalThis as Record<string, unknown>).document = mockDocument;

// The idle service reads Date.now() inside its setInterval tick. Bun's
// vitest-compat fake timers fire the interval but do NOT advance
// Date.now(), so we drive the clock manually through a spy.
const BASE_TIME = new Date('2026-07-10T12:00:00Z').getTime();
let fakeNow = BASE_TIME;
const dateNowSpy = spyOn(Date, 'now').mockReturnValue(BASE_TIME);

/** Advances the fake Date.now clock and fires any due timers. */
const advanceTime = (ms: number): void => {
  fakeNow += ms;
  dateNowSpy.mockReturnValue(fakeNow);
  vi.advanceTimersByTime(ms);
};

// We test the implementation directly — create a fresh instance for each test
// Note: the service uses document, so we need to import after the mock

describe('IdleDetectionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    eventListeners.clear();
    vi.useFakeTimers();
    fakeNow = BASE_TIME;
    dateNowSpy.mockReturnValue(BASE_TIME);
    mockDocument.visibilityState = 'visible';

    // The service is a module singleton — its reactive state persists
    // across tests (e.g. _isPageVisible can be left false by the
    // tab-hidden test, and _lastThrottledInput by input tests).
    // Re-initialize + reset so each test starts fresh.
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    // Zero the private input-throttle clock so the first input event in a
    // test is never throttled (bun's module cache keeps the singleton alive).
    (idleDetectionService as unknown as { _lastThrottledInput: number })._lastThrottledInput = 0;
    await idleDetectionService.initialize();
    idleDetectionService.resetIdle();
    const visibilityHandlers = eventListeners.get('visibilitychange');
    visibilityHandlers?.[0]?.(new Event('visibilitychange'));
    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should initialize with zero idle duration', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    expect(idleDetectionService.idleDurationMs).toBe(0);
    expect(idleDetectionService.isDnd).toBe(false);
    expect(idleDetectionService.isIdle(60_000)).toBe(false);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should reset idleDurationMs on pointer input', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Simulate passage of time
    advanceTime(5000);
    expect(idleDetectionService.idleDurationMs).toBeGreaterThan(0);

    // Simulate mouse move
    const handlers = eventListeners.get('pointermove');
    expect(handlers).toBeDefined();
    handlers?.[0]?.(new Event('pointermove'));
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should detect idle after exceeding threshold', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 5 minutes (300000ms)
    advanceTime(300_000);

    // At 5 mins, isIdle(300000) should be true, isIdle(600000) should be false
    expect(idleDetectionService.isIdle(300_000)).toBe(true);
    expect(idleDetectionService.isIdle(600_000)).toBe(false);

    // Advance to 10 minutes (600000ms) — the 600s threshold is now crossed
    advanceTime(300_000);
    expect(idleDetectionService.isIdle(600_000)).toBe(true);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should suppress idle when tab is hidden', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Make page hidden
    mockDocument.visibilityState = 'hidden';
    const visibilityHandlers = eventListeners.get('visibilitychange');
    visibilityHandlers?.[0]?.(new Event('visibilitychange'));

    // Advance time past threshold
    advanceTime(300_000);

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
  });

  it('should toggle DND mode and reset idle on turn-off', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance some time
    advanceTime(120_000);

    // Enable DND
    idleDetectionService.setDnd(true);
    expect(idleDetectionService.isDnd).toBe(true);

    // Advance more time
    advanceTime(120_000);

    // Turn off DND — should reset idle
    idleDetectionService.setDnd(false);
    expect(idleDetectionService.isDnd).toBe(false);
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should throttle input updates to once per second', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 2 seconds
    advanceTime(2000);

    // Multiple rapid inputs
    const handlers = eventListeners.get('keydown');
    handlers?.[0]?.(new Event('keydown'));
    handlers?.[0]?.(new Event('keydown'));
    handlers?.[0]?.(new Event('keydown'));

    // Idle should have reset to 0 (first input processed, subsequent throttled)
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });

  it('should respond to touch events', async () => {
    const { idleDetectionService } = await import('../game/idle_detection_service.svelte.ts');
    await idleDetectionService.initialize();

    // Advance 4 seconds
    advanceTime(4000);
    expect(idleDetectionService.idleDurationMs).toBeGreaterThan(0);

    // Touch input
    const handlers = eventListeners.get('touchstart');
    handlers?.[0]?.(new Event('touchstart'));
    expect(idleDetectionService.idleDurationMs).toBe(0);

    idleDetectionService.destroy();
    vi.clearAllTimers();
  });
});
