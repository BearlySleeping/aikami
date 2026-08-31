// packages/frontend/engine/src/__tests__/frame_pacing.test.ts
//
// Unit tests for C-380: Frame Pacing & Point-and-Click Movement

import { describe, expect, it } from 'bun:test';
import {
  computeInterpolationAlpha,
  copyRenderState,
  interpolateValue,
  unprojectScreenPoint,
  updateFixedStepAccumulator,
} from '../frame_pacing.ts';

describe('C-380 AC-1: Fixed-timestep accumulator', () => {
  it('consumes exactly one step when elapsed equals step size', () => {
    const fixedStepMs = 1000 / 60;
    const result = updateFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: fixedStepMs,
      fixedStepMs,
      maxStepsPerWake: 6,
    });

    expect(result.stepCount).toBe(1);
    expect(result.accumulatorMs).toBeLessThan(fixedStepMs);
  });

  it('consumes multiple steps when elapsed exceeds step size', () => {
    const fixedStepMs = 1000 / 60;
    const result = updateFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: fixedStepMs * 3.5,
      fixedStepMs,
      maxStepsPerWake: 6,
    });

    expect(result.stepCount).toBe(3);
    expect(result.accumulatorMs).toBeGreaterThan(0);
    expect(result.accumulatorMs).toBeLessThan(fixedStepMs);
  });

  it('caps steps to maxStepsPerWake to prevent spiral-of-death', () => {
    const fixedStepMs = 16;
    const maxStepsPerWake = 6;
    const result = updateFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: 1000,
      fixedStepMs,
      maxStepsPerWake,
    });

    expect(result.stepCount).toBe(maxStepsPerWake);
    expect(result.accumulatorMs).toBe(0);
  });

  it('runs zero steps when accumulator is below step size', () => {
    const fixedStepMs = 1000 / 60;
    const result = updateFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: 1,
      fixedStepMs,
      maxStepsPerWake: 6,
    });

    expect(result.stepCount).toBe(0);
    expect(result.accumulatorMs).toBe(1);
  });
});

describe('C-380 AC-2: Interpolation alpha', () => {
  it('returns alpha = 0 at the start of a step', () => {
    expect(computeInterpolationAlpha({ elapsedMs: 0, stepMs: 16.667 })).toBe(0);
  });

  it('returns alpha = 1 at the end of a step', () => {
    const stepMs = 16.667;
    expect(computeInterpolationAlpha({ elapsedMs: stepMs, stepMs })).toBe(1);
  });

  it('returns alpha = 0.5 at the midpoint of a step', () => {
    const stepMs = 16.667;
    const alpha = computeInterpolationAlpha({ elapsedMs: stepMs / 2, stepMs });
    expect(alpha).toBeCloseTo(0.5, 3);
  });

  it('clamps alpha to 1 when elapsed exceeds step size', () => {
    const stepMs = 16.667;
    expect(computeInterpolationAlpha({ elapsedMs: stepMs * 2, stepMs })).toBe(1);
  });

  it('linearly interpolates a position', () => {
    expect(interpolateValue({ previous: 100, current: 200, alpha: 0.5 })).toBe(150);
  });

  it('matches endpoint at alpha = 0', () => {
    expect(interpolateValue({ previous: 100, current: 200, alpha: 0 })).toBe(100);
  });

  it('matches endpoint at alpha = 1', () => {
    expect(interpolateValue({ previous: 100, current: 200, alpha: 1 })).toBe(200);
  });
});

describe('C-380 AC-3: Buffer copy safety', () => {
  it('copying a Float32Array preserves the original values', () => {
    const source = new Float32Array([10, 20, 30, 40, 50]);
    const copy = copyRenderState(source);

    expect(copy.length).toBe(source.length);
    expect(copy[0]).toBe(10);
    expect(copy[4]).toBe(50);

    source[0] = 999;
    expect(copy[0]).toBe(10);
  });

  it('copy survives ArrayBuffer detachment', () => {
    const ab = new ArrayBuffer(20);
    const view = new Float32Array(ab);
    view.set([10, 20, 30, 40, 50]);
    const copy = copyRenderState(view);
    const channel = new MessageChannel();

    channel.port1.postMessage(ab, [ab]);

    expect(ab.byteLength).toBe(0);
    expect(copy[0]).toBe(10);
    expect(copy[1]).toBe(20);
    channel.port1.close();
    channel.port2.close();
  });
});

describe('C-380 AC-4: Screen→world unprojection', () => {
  it('inverts the camera transform for a centered point', () => {
    const world = unprojectScreenPoint({
      screenX: 400,
      screenY: 300,
      screenWidth: 800,
      screenHeight: 600,
      cameraX: 160,
      cameraY: 160,
      scale: 4,
    });

    expect(world.x).toBe(160);
    expect(world.y).toBe(160);
  });

  it('round-trips world→screen→world identity', () => {
    const screenWidth = 800;
    const screenHeight = 600;
    const cameraX = 160;
    const cameraY = 160;
    const scale = 4;
    const originalWorldX = 240;
    const originalWorldY = 176;
    const screenX = screenWidth / 2 + (originalWorldX - cameraX) * scale;
    const screenY = screenHeight / 2 + (originalWorldY - cameraY) * scale;
    const world = unprojectScreenPoint({
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      cameraX,
      cameraY,
      scale,
    });

    expect(world.x).toBe(originalWorldX);
    expect(world.y).toBe(originalWorldY);
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
      const world = unprojectScreenPoint({
        screenX,
        screenY,
        screenWidth,
        screenHeight,
        cameraX,
        cameraY,
        scale,
      });

      expect(world.x).toBeCloseTo(originalWorldX, 5);
      expect(world.y).toBeCloseTo(originalWorldY, 5);
    }
  });

  it('converts unprojected screen coords to tile cell correctly', () => {
    const world = unprojectScreenPoint({
      screenX: 720,
      screenY: 364,
      screenWidth: 800,
      screenHeight: 600,
      cameraX: 160,
      cameraY: 160,
      scale: 4,
    });

    expect(Math.floor(world.x / 32)).toBe(7);
    expect(Math.floor(world.y / 32)).toBe(5);
  });
});
