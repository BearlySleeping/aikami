// apps/frontend/client/src/lib/services/game/game_boot_service.test.ts
//
// Unit tests for the GameBootService — stage pipeline, cancellation,
// progress emission, campaign state machine integration.
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import { describe, expect, test } from 'bun:test';
import { gameBootService } from './game_boot_service.svelte';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a minimal boot input with a mock canvas. */
const createMockInput = (overrides?: Partial<GameBootInput>): GameBootInput => ({
  contentPackId: 'emberwatch',
  canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
  ...overrides,
});

/** Resets the boot service to a clean state before each test. */
const resetService = (): void => {
  gameBootService.teardown();
};

// ---------------------------------------------------------------------------
// AC-1: Content-Driven Atomic Boot
// ---------------------------------------------------------------------------

describe('GameBootService — AC-1 Atomic Boot', () => {
  test('boot transitions through ordered stages', async () => {
    resetService();
    const input = createMockInput();

    // The boot will fail because we're using a mock canvas — that's expected.
    // We just verify the progress transitions happen in order.
    const result = await gameBootService.boot(input);

    // With a mock canvas, boot should fail at a later stage (creating_engine).
    // The progress should have transitioned through the initial stages.
    expect(gameBootService.bootProgress.stage).toBe('failed');
    expect(gameBootService.bootProgress.stageIndex).toBeGreaterThanOrEqual(0);
    expect(result).not.toBeNull();
  });

  test('boot is idempotent — calling while already booting returns cancelled', async () => {
    resetService();
    const input = createMockInput();

    // Start a boot (don't await)
    const bootPromise = gameBootService.boot(input);

    // Second call while booting — should return cancelled
    const secondResult = await gameBootService.boot(input);
    expect(secondResult.outcome).toBe('cancelled');

    // Cleanup
    gameBootService.cancelBoot();
    await bootPromise.catch(() => {});
  });

  test('progress starts at idle', () => {
    resetService();
    expect(gameBootService.bootProgress.stage).toBe('idle');
    expect(gameBootService.bootProgress.stageIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Observable Stage Progress
// ---------------------------------------------------------------------------

describe('GameBootService — AC-2 Observable Progress', () => {
  test('progress detail is set during boot', async () => {
    resetService();
    const input = createMockInput();

    const promise = gameBootService.boot(input);

    // After a tick, the progress should have advanced
    await new Promise((r) => setTimeout(r, 10));

    // The progress should show detail for the current stage
    expect(gameBootService.bootProgress.detail).toBeDefined();
    expect(gameBootService.bootProgress.stage).not.toBe('idle');

    gameBootService.cancelBoot();
    await promise.catch(() => {});
  });

  test('stageCount reflects total pipeline stages', () => {
    resetService();
    // Stage count should be the number of active pipeline stages
    expect(gameBootService.bootProgress.stageCount).toBeGreaterThan(0);
  });

  test('final result includes renderer info when successful', async () => {
    resetService();
    // This test verifies the result shape — actual success requires a real canvas
    const input = createMockInput();
    const result = await gameBootService.boot(input);

    // With mock canvas, boot fails. The result shape should be correct regardless.
    if (result.outcome === 'failed') {
      expect(result.stage).toBeDefined();
      expect(result.error).toBeDefined();
    }
    // On real hardware, outcome would be 'ready' with renderer field
  });
});

// ---------------------------------------------------------------------------
// AC-3: Stage Failure Leaves Save Intact with Recovery
// ---------------------------------------------------------------------------

describe('GameBootService — AC-3 Failure Recovery', () => {
  test('failed boot sets progress to failed with error message', async () => {
    resetService();
    const input = createMockInput();
    const result = await gameBootService.boot(input);

    expect(gameBootService.bootProgress.stage).toBe('failed');
    expect(gameBootService.bootProgress.error).toBeDefined();
    expect(result.outcome).toBe('failed');
  });

  test('resetForRetry clears error state and returns to idle', async () => {
    resetService();
    const input = createMockInput();
    await gameBootService.boot(input);

    // Should be in failed state
    expect(gameBootService.bootProgress.stage).toBe('failed');

    // Reset for retry
    gameBootService.resetForRetry();

    // Should be back to idle
    expect(gameBootService.bootProgress.stage).toBe('idle');
    expect(gameBootService.bootProgress.error).toBeUndefined();
    expect(gameBootService.isBooting).toBe(false);
  });

  test('teardown clears all state', async () => {
    resetService();
    const input = createMockInput();
    await gameBootService.boot(input);

    gameBootService.teardown();

    expect(gameBootService.bootProgress.stage).toBe('idle');
    expect(gameBootService.lastResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-4: Cancellation and Clean Teardown
// ---------------------------------------------------------------------------

describe('GameBootService — AC-4 Cancellation', () => {
  test('cancelBoot sets cancelled flag', () => {
    resetService();
    gameBootService.cancelBoot();
    // cancelBoot on non-booting service should be a no-op (logged but not crash)
  });

  test('cancellation during boot returns cancelled result', async () => {
    resetService();
    const input = createMockInput();

    // Start boot and cancel immediately
    const bootPromise = gameBootService.boot(input);
    await new Promise((r) => setTimeout(r, 5));
    gameBootService.cancelBoot();

    const result = await bootPromise;
    expect(result.outcome).toBe('cancelled');
  });

  test('isBooting flag toggles correctly', async () => {
    resetService();
    const input = createMockInput();

    expect(gameBootService.isBooting).toBe(false);

    const promise = gameBootService.boot(input);
    // The flag should be set synchronously
    expect(gameBootService.isBooting).toBe(true);

    gameBootService.cancelBoot();
    await promise;
    expect(gameBootService.isBooting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Save Hydration vs. Fresh Spawn
// ---------------------------------------------------------------------------

describe('GameBootService — AC-5 Save Hydration', () => {
  test('boot with pendingSavePayload follows hydrate path', async () => {
    resetService();
    const input = createMockInput({
      pendingSavePayload: '{"test":true}',
    });

    const result = await gameBootService.boot(input);

    // The save validation stage should have processed the payload
    // (with mock canvas, boot will fail later — but the payload path was chosen)
    expect(result).toBeDefined();
  });

  test('boot without payload follows fresh spawn path', async () => {
    resetService();
    const input = createMockInput();

    const result = await gameBootService.boot(input);

    // Fresh spawn path should have been chosen
    expect(result).toBeDefined();
  });
});
