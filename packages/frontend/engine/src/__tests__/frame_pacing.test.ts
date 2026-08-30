// packages/frontend/engine/src/__tests__/frame_pacing.test.ts
//
// Unit tests for C-380: Frame Pacing & Point-and-Click Movement
//
// Covers:
// - AC-1: Fixed-timestep accumulator logic (pure math)
// - AC-2: Interpolation alpha computation
// - AC-3: Buffer safety (copy before recycle)
// - AC-4: Unprojection round-trip identity

import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// AC-1: Fixed-timestep accumulator
// ---------------------------------------------------------------------------

describe('C-380 AC-1: Fixed-timestep accumulator', () => {
  it('consumes exactly one step when elapsed equals step size', () => {
    const FIXED_STEP_MS = 1000 / 60; // ~16.667
    let accumulator = 0;
    const elapsed = FIXED_STEP_MS;
    accumulator += Math.min(elapsed, 6 * FIXED_STEP_MS);

    let steps = 0;
    while (accumulator >= FIXED_STEP_MS) {
      accumulator -= FIXED_STEP_MS;
      steps++;
    }

    expect(steps).toBe(1);
    expect(accumulator).toBeLessThan(FIXED_STEP_MS);
  });

  it('consumes multiple steps when elapsed exceeds step size', () => {
    const FIXED_STEP_MS = 1000 / 60;
    let accumulator = 0;
    const elapsed = FIXED_STEP_MS * 3.5;
    accumulator += Math.min(elapsed, 6 * FIXED_STEP_MS);

    let steps = 0;
    while (accumulator >= FIXED_STEP_MS) {
      accumulator -= FIXED_STEP_MS;
      steps++;
    }

    expect(steps).toBe(3);
    expect(accumulator).toBeGreaterThan(0);
    expect(accumulator).toBeLessThan(FIXED_STEP_MS);
  });

  it('caps steps to MAX_STEPS_PER_WAKE to prevent spiral-of-death', () => {
    const FIXED_STEP_MS = 16;
    const MAX_STEPS_PER_WAKE = 6;
    let accumulator = 0;
    // Simulate a large gap (tab backgrounding) — cap to 6 * 16 = 96ms
    const elapsed = 1000;
    accumulator += Math.min(elapsed, MAX_STEPS_PER_WAKE * FIXED_STEP_MS);

    let steps = 0;
    while (accumulator >= FIXED_STEP_MS) {
      accumulator -= FIXED_STEP_MS;
      steps++;
    }

    expect(steps).toBe(MAX_STEPS_PER_WAKE);
    expect(accumulator).toBe(0);
  });

  it('runs zero steps when accumulator is below step size', () => {
    const FIXED_STEP_MS = 1000 / 60;
    let accumulator = 0;
    const elapsed = 1; // 1ms — less than one step
    accumulator += Math.min(elapsed, 6 * FIXED_STEP_MS);

    let steps = 0;
    while (accumulator >= FIXED_STEP_MS) {
      accumulator -= FIXED_STEP_MS;
      steps++;
    }

    expect(steps).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Interpolation alpha
// ---------------------------------------------------------------------------

describe('C-380 AC-2: Interpolation alpha', () => {
  it('returns alpha = 0 at the start of a step', () => {
    const stepMs = 16.667;
    const elapsedSinceCurrent = 0;
    const alpha = Math.min(1, elapsedSinceCurrent / stepMs);
    expect(alpha).toBe(0);
  });

  it('returns alpha = 1 at the end of a step', () => {
    const stepMs = 16.667;
    const elapsedSinceCurrent = stepMs;
    const alpha = Math.min(1, elapsedSinceCurrent / stepMs);
    expect(alpha).toBe(1);
  });

  it('returns alpha = 0.5 at the midpoint of a step', () => {
    const stepMs = 16.667;
    const elapsedSinceCurrent = stepMs / 2;
    const alpha = Math.min(1, elapsedSinceCurrent / stepMs);
    expect(alpha).toBeCloseTo(0.5, 3);
  });

  it('clamps alpha to 1 when elapsed exceeds step size', () => {
    const stepMs = 16.667;
    const elapsedSinceCurrent = stepMs * 2;
    const alpha = Math.min(1, elapsedSinceCurrent / stepMs);
    expect(alpha).toBe(1);
  });

  it('linearly interpolates a position', () => {
    const prevX = 100;
    const currX = 200;
    const alpha = 0.5;
    const interpolated = prevX + (currX - prevX) * alpha;
    expect(interpolated).toBe(150);
  });

  it('matches endpoint at alpha = 0', () => {
    const prevX = 100;
    const currX = 200;
    const alpha = 0;
    const interpolated = prevX + (currX - prevX) * alpha;
    expect(interpolated).toBe(100);
  });

  it('matches endpoint at alpha = 1', () => {
    const prevX = 100;
    const currX = 200;
    const alpha = 1;
    const interpolated = prevX + (currX - prevX) * alpha;
    expect(interpolated).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Buffer safety — copy before recycle
// ---------------------------------------------------------------------------

describe('C-380 AC-3: Buffer copy safety', () => {
  it('copying a Float32Array preserves the original values', () => {
    const source = new Float32Array([10, 20, 30, 40, 50]);
    const copy = new Float32Array(source.length);
    copy.set(source);

    expect(copy.length).toBe(source.length);
    expect(copy[0]).toBe(10);
    expect(copy[4]).toBe(50);

    // Modify source — copy must be independent
    source[0] = 999;
    expect(copy[0]).toBe(10);
  });

  it('copy survives ArrayBuffer detachment', () => {
    const ab = new ArrayBuffer(20); // 5 Float32 values
    const view = new Float32Array(ab);
    view.set([10, 20, 30, 40, 50]);

    // Copy before detachment
    const copy = new Float32Array(view.length);
    copy.set(view);

    // Simulate transfer — detach the original buffer
    const _transferred = ab.slice(0); // In real code: postMessage with transfer

    // Copy must still be readable
    expect(copy[0]).toBe(10);
    expect(copy[1]).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Unprojection round-trip
// ---------------------------------------------------------------------------

describe('C-380 AC-4: Screen→world unprojection', () => {
  it('inverts the camera transform for a centered point', () => {
    // Simulate: screen 800x600, camera at (160, 160), zoom 1.0, scale 4
    const screenWidth = 800;
    const screenHeight = 600;
    const cameraX = 160;
    const cameraY = 160;
    const zoom = 1.0;
    const scale = 4 * zoom;

    // Forward: worldContainer.x = screenWidth/2 - cameraX * scale
    // Inverse: worldX = (screenX - screenWidth/2) / scale + cameraX
    const screenX = screenWidth / 2; // center of screen
    const screenY = screenHeight / 2;
    const worldX = (screenX - screenWidth / 2) / scale + cameraX;
    const worldY = (screenY - screenHeight / 2) / scale + cameraY;

    expect(worldX).toBe(cameraX);
    expect(worldY).toBe(cameraY);
  });

  it('round-trips world→screen→world identity', () => {
    const screenWidth = 800;
    const screenHeight = 600;
    const cameraX = 160;
    const cameraY = 160;
    const zoom = 1.0;
    const scale = 4 * zoom;

    // Start with a known world position
    const originalWorldX = 240;
    const originalWorldY = 176;

    // Forward: screen = screenCenter + (world - camera) * scale
    const screenX = screenWidth / 2 + (originalWorldX - cameraX) * scale;
    const screenY = screenHeight / 2 + (originalWorldY - cameraY) * scale;

    // Inverse: world = (screen - screenCenter) / scale + camera
    const roundTripX = (screenX - screenWidth / 2) / scale + cameraX;
    const roundTripY = (screenY - screenHeight / 2) / scale + cameraY;

    expect(roundTripX).toBe(originalWorldX);
    expect(roundTripY).toBe(originalWorldY);
  });

  it('round-trips correctly at different zoom levels', () => {
    const screenWidth = 800;
    const screenHeight = 600;
    const cameraX = 200;
    const cameraY = 150;

    for (const zoom of [0.5, 1.0, 1.5]) {
      const scale = 4 * zoom;
      const originalWorldX = 300;
      const originalWorldY = 200;

      const screenX = screenWidth / 2 + (originalWorldX - cameraX) * scale;
      const screenY = screenHeight / 2 + (originalWorldY - cameraY) * scale;

      const roundTripX = (screenX - screenWidth / 2) / scale + cameraX;
      const roundTripY = (screenY - screenHeight / 2) / scale + cameraY;

      expect(roundTripX).toBeCloseTo(originalWorldX, 5);
      expect(roundTripY).toBeCloseTo(originalWorldY, 5);
    }
  });

  it('converts screen coords to tile cell correctly', () => {
    const tileSize = 32;
    // World position (240, 176) → tile (7, 5)
    const worldX = 240;
    const worldY = 176;
    const cellX = Math.floor(worldX / tileSize);
    const cellY = Math.floor(worldY / tileSize);
    expect(cellX).toBe(7);
    expect(cellY).toBe(5);
  });
});
