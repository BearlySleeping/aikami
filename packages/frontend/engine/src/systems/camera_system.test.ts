// packages/frontend/engine/src/systems/camera_system.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { CameraFocus, registerCameraFocusObservers } from '../components/camera_focus.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import {
  getCameraPosition,
  resetCameraTracking,
  setMapBounds,
  setScreenSize,
  updateCameraSystem,
} from './camera_system.ts';

// ---------------------------------------------------------------------------
// AC: Lerp + Clamping Math
//
// Contract C-137 — Validates that the camera smoothly follows the entity
// tagged with CameraFocus and clamps to map boundaries when set.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates and registers a target entity at the given position.
 */
const _createTarget = (world: World, options: { x: number; y: number }): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, options));
  addComponent(world, eid, CameraFocus);
  return eid;
};

describe('camera_system', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerCameraFocusObservers(world);
    resetCameraTracking();
  });

  afterEach(() => {
    Position.x.length = 0;
    Position.y.length = 0;
    resetCameraTracking();
  });

  // ---------------------------------------------------------------------
  // Lerp
  // ---------------------------------------------------------------------

  describe('lerp', () => {
    it('snaps to target on first frame (no lerp)', () => {
      setScreenSize({ width: 1920, height: 1080 });
      _createTarget(world, { x: 400, y: 300 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      expect(camera.x).toBe(400);
      expect(camera.y).toBe(300);
    });

    it('moves toward target over multiple ticks', () => {
      setScreenSize({ width: 1920, height: 1080 });
      const eid = _createTarget(world, { x: 0, y: 0 });

      // First frame: snap to 0,0
      updateCameraSystem(world, 16);

      // Move target far away
      addComponent(world, eid, set(Position, { x: 1000, y: 500 }));

      // Run many ticks to let lerp converge
      for (let i = 0; i < 200; i++) {
        updateCameraSystem(world, 16);
      }

      const camera = getCameraPosition();

      // After 200 ticks, camera should be very close to target (within 1 pixel)
      expect(Math.abs(camera.x - 1000)).toBeLessThan(1);
      expect(Math.abs(camera.y - 500)).toBeLessThan(1);
    });

    it('lerp scales with delta time (faster movement at higher dt)', () => {
      setScreenSize({ width: 1920, height: 1080 });
      const eid = _createTarget(world, { x: 0, y: 0 });

      // Snap to origin
      updateCameraSystem(world, 16);

      // Move target
      addComponent(world, eid, set(Position, { x: 1000, y: 0 }));

      // One tick at 32ms should advance further than one tick at 16ms
      updateCameraSystem(world, 32);
      const after32ms = getCameraPosition().x;

      // Reset and compare
      resetCameraTracking();
      setScreenSize({ width: 1920, height: 1080 });
      const world2 = createWorld();
      registerPositionObservers(world2);
      registerCameraFocusObservers(world2);
      const eid2 = _createTarget(world2, { x: 0, y: 0 });
      updateCameraSystem(world2, 16); // snap
      addComponent(world2, eid2, set(Position, { x: 1000, y: 0 }));
      updateCameraSystem(world2, 16); // one tick at normal speed
      const after16ms = getCameraPosition().x;

      // 32ms tick should advance roughly 2× as far as 16ms tick
      // (scaled by dt/REFERENCE_FRAME_MS = 32/16.67 ≈ 1.92)
      expect(after32ms).toBeGreaterThan(after16ms * 1.5);
      expect(after32ms).toBeLessThan(after16ms * 2.5);
    });

    it('stays at last position when no target entity exists', () => {
      setScreenSize({ width: 1920, height: 1080 });

      // No entity with CameraFocus
      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });

    it('handles delta zero gracefully', () => {
      setScreenSize({ width: 1920, height: 1080 });
      _createTarget(world, { x: 400, y: 300 });

      updateCameraSystem(world, 0);
      updateCameraSystem(world, 0);

      const camera = getCameraPosition();
      expect(camera.x).toBe(400);
      expect(camera.y).toBe(300);
    });
  });

  // ---------------------------------------------------------------------
  // Clamping
  // ---------------------------------------------------------------------

  describe('clamping', () => {
    it('clamps camera at left/top edge (cannot go negative)', () => {
      setScreenSize({ width: 1920, height: 1080 });
      setMapBounds({ width: 3200, height: 2400 });

      // Place target at negative position (off-map left)
      _createTarget(world, { x: -100, y: -100 });

      // First frame: snap + clamp (clamping now applies on first tick too)
      updateCameraSystem(world, 16);

      const camera = getCameraPosition();

      // Camera should be clamped to at least half-screen from edges
      // halfScreenWorld = 1920 / (2 * 4) = 240 for x, 1080 / 8 = 135 for y
      expect(camera.x).toBeGreaterThanOrEqual(240);
      expect(camera.y).toBeGreaterThanOrEqual(135);
    });

    it('clamps camera at right/bottom edge', () => {
      setScreenSize({ width: 1920, height: 1080 });
      setMapBounds({ width: 3200, height: 2400 });

      // Place target far beyond map boundary
      _createTarget(world, { x: 9999, y: 9999 });

      updateCameraSystem(world, 16); // snap + clamp on first tick

      const camera = getCameraPosition();

      // Camera should be clamped to at most mapSize - halfScreen from edges
      // max x = 3200 - 240 = 2960
      // max y = 2400 - 135 = 2265
      expect(camera.x).toBeLessThanOrEqual(2960);
      expect(camera.y).toBeLessThanOrEqual(2265);
    });

    it('centers on map when map is smaller than viewport', () => {
      setScreenSize({ width: 1920, height: 1080 });
      // Map is tiny (256×256 world px)
      setMapBounds({ width: 256, height: 256 });

      _createTarget(world, { x: 0, y: 0 });

      updateCameraSystem(world, 16); // snap + clamp on first tick (clamped to map center)

      const camera = getCameraPosition();

      // Should center: mapWidth/2 = 128, mapHeight/2 = 128
      expect(camera.x).toBe(128);
      expect(camera.y).toBe(128);
    });

    it('does not clamp when no map bounds are set', () => {
      setScreenSize({ width: 1920, height: 1080 });
      // No setMapBounds call

      _createTarget(world, { x: -500, y: -500 });

      updateCameraSystem(world, 16); // snap (no clamp since bounds are 0)

      const camera = getCameraPosition();
      expect(camera.x).toBe(-500);
      expect(camera.y).toBe(-500);
    });

    it('handles zero map bounds gracefully', () => {
      setScreenSize({ width: 1920, height: 1080 });
      setMapBounds({ width: 0, height: 0 });

      _createTarget(world, { x: 500, y: 500 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      expect(camera.x).toBe(500);
      expect(camera.y).toBe(500);
    });
  });

  // ---------------------------------------------------------------------
  // Screen resize
  // ---------------------------------------------------------------------

  describe('screen resize', () => {
    it('updates clamping after screen resize', () => {
      // Start with a large screen
      setScreenSize({ width: 3840, height: 2160 });
      setMapBounds({ width: 3200, height: 2400 });

      _createTarget(world, { x: 9999, y: 9999 });

      updateCameraSystem(world, 16); // snap + clamp on first tick

      const beforeResize = getCameraPosition();

      // With large screen (3840/2160), halfScreenWorld = 3840/8=480 (x), 2160/8=270 (y)
      // Max x = 3200 - 480 = 2720
      expect(beforeResize.x).toBeLessThanOrEqual(2720);

      // Now resize to a smaller screen
      setScreenSize({ width: 800, height: 600 });

      // Run more ticks to let clamping adjust
      for (let i = 0; i < 10; i++) {
        updateCameraSystem(world, 16);
      }

      const afterResize = getCameraPosition();

      // With small screen (800/600), halfScreenWorld = 800/8=100 (x), 600/8=75 (y)
      // Max x = 3200 - 100 = 3100
      expect(afterResize.x).toBeGreaterThan(beforeResize.x);
    });

    it('updateCameraSystem works initially with zero screen size', () => {
      // Don't call setScreenSize — default is 0×0
      _createTarget(world, { x: 400, y: 300 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      // Should still track (lerp without clamping, snap on first frame)
      expect(camera.x).toBe(400);
      expect(camera.y).toBe(300);
    });

    it('clamping adjusts to custom scale value', () => {
      // Set scale to 2 (half the default) — larger viewport in world-space
      setScreenSize({ width: 1920, height: 1080, scale: 2 });
      setMapBounds({ width: 3200, height: 2400 });

      // Place target beyond the right edge
      _createTarget(world, { x: 9999, y: 500 });

      updateCameraSystem(world, 16); // snap + clamp on first tick

      const camera = getCameraPosition();

      // With scale=2: halfScreenWorld = 1920 / (2*2) = 480
      // Max x = 3200 - 480 = 2720
      expect(camera.x).toBeLessThanOrEqual(2720);
      // x should be greater than with scale=4 (which gives half=240, max=2960)
      expect(camera.x).toBeLessThan(2960); // scale=2 gives tighter clamp
    });

    it('scale=8 gives wider clamping range than scale=4', () => {
      setScreenSize({ width: 1920, height: 1080, scale: 8 });
      setMapBounds({ width: 3200, height: 2400 });

      _createTarget(world, { x: 9999, y: 500 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();

      // With scale=8: halfScreenWorld = 1920 / (2*8) = 120
      // Max x = 3200 - 120 = 3080
      expect(camera.x).toBeLessThanOrEqual(3080);
      expect(camera.x).toBeGreaterThan(2960); // wider than default scale=4
    });

    it('ignores zero or negative scale (falls back to default 4)', () => {
      setScreenSize({ width: 1920, height: 1080, scale: 0 });
      setMapBounds({ width: 3200, height: 2400 });

      _createTarget(world, { x: 9999, y: 500 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();

      // Zero scale is ignored → falls back to 4
      // halfScreenWorld = 1920 / 8 = 240, max x = 3200 - 240 = 2960
      expect(camera.x).toBeLessThanOrEqual(2960);
      expect(camera.x).toBeGreaterThan(2700);
    });

    it('resetCameraTracking resets scale to default 4', () => {
      // Set scale to 2 and verify clamping
      setScreenSize({ width: 1920, height: 1080, scale: 2 });
      setMapBounds({ width: 3200, height: 2400 });
      _createTarget(world, { x: 500, y: 500 });
      updateCameraSystem(world, 16);

      resetCameraTracking();

      // After reset, camera should be at (0,0) and scale back to 4
      // Set up again without specifying scale
      setScreenSize({ width: 1920, height: 1080 });
      setMapBounds({ width: 3200, height: 2400 });
      _createTarget(world, { x: 9999, y: 500 });
      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      // Default scale 4: halfScreenWorld = 240, max = 2960
      expect(camera.x).toBeLessThanOrEqual(2960);
    });
  });

  // ---------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles multiple CameraFocus entities by targeting the first', () => {
      setScreenSize({ width: 1920, height: 1080 });

      // Create two entities with CameraFocus at different positions
      _createTarget(world, { x: 100, y: 100 });
      _createTarget(world, { x: 900, y: 900 });

      updateCameraSystem(world, 16);

      const camera = getCameraPosition();
      // Should follow the first entity (bitECS returns entities in creation order)
      expect(camera.x).toBe(100);
      expect(camera.y).toBe(100);
    });

    it('resets camera position when resetCameraTracking is called', () => {
      setScreenSize({ width: 1920, height: 1080 });
      _createTarget(world, { x: 400, y: 300 });

      updateCameraSystem(world, 16);

      expect(getCameraPosition().x).toBe(400);

      resetCameraTracking();

      expect(getCameraPosition().x).toBe(0);
      expect(getCameraPosition().y).toBe(0);
    });

    it('handles delta time greater than 16ms', () => {
      setScreenSize({ width: 1920, height: 1080 });
      const eid = _createTarget(world, { x: 0, y: 0 });

      updateCameraSystem(world, 16); // snap to 0,0

      addComponent(world, eid, set(Position, { x: 1000, y: 0 }));

      // Large delta (100ms = ~6× normal)
      updateCameraSystem(world, 100);

      const camera = getCameraPosition();
      // Should move a large step (lerp factor scaled by dt)
      expect(camera.x).toBeGreaterThan(0);
      expect(camera.x).toBeLessThan(1000);
    });
  });
});
