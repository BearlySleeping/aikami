// packages/frontend/engine/src/systems/camera_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { CameraFocus } from '../components/camera_focus.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';

// ---------------------------------------------------------------------------
// CameraSystem — smooth 2D camera tracking with map boundary clamping
//
// Runs every tick in the worker. Finds the entity tagged with CameraFocus
// and linearly interpolates the camera position toward it. Clamps the
// result so the viewport never shows off-map void.
// ---------------------------------------------------------------------------

/**
 * Default lerp factor per frame at 60fps.
 *
 * 0.08 produces a gentle follow — the camera takes ~0.5s to cover half
 * the remaining distance. Increase for tighter tracking, decrease for
 * more cinematic drift.
 */
const DEFAULT_LERP_FACTOR = 0.08;

/** World-space scale factor applied by the main-thread world container.
 *
 * Defaults to 4 (matching the initial {@link GameWorld._worldContainer}
 * scale). Updated via {@link setScreenSize} when the main thread reports
 * a new container scale during resize events.
 */
let currentWorldScale = 4;

/** Reference frame duration in milliseconds (60fps = ~16.67ms). */
const REFERENCE_FRAME_MS = 1000 / 60;

// -- Module-level state ----------------------------------------------------

/** Current camera position in world-space pixels. */
let cameraX = 0;

/** Current camera position in world-space pixels. */
let cameraY = 0;

/** Map width in world-space pixels. 0 = no bounds (clamping disabled). */
let mapPixelWidth = 0;

/** Map height in world-space pixels. 0 = no bounds (clamping disabled). */
let mapPixelHeight = 0;

/** Current screen width in CSS pixels. */
let screenWidth = 0;

/** Current screen height in CSS pixels. */
let screenHeight = 0;

/** Whether the camera has been initialized (tracking started). */
let initialized = false;

// -- Cached query terms ----------------------------------------------------

const CAMERA_QUERY_TERMS = [CameraFocus, Position];

// -- Public API ------------------------------------------------------------

/**
 * Sets the map boundaries for camera clamping.
 *
 * When both width and height are positive, the camera will clamp to keep
 * the viewport within `[0, 0]` → `[mapWidth, mapHeight]` in world pixels.
 * When zero, clamping is disabled (free camera).
 *
 * @param options - Map dimensions in world-space pixels.
 */
export const setMapBounds = (options: { width: number; height: number }): void => {
  mapPixelWidth = options.width;
  mapPixelHeight = options.height;
};

/**
 * Updates the screen dimensions used for camera centering and clamping.
 *
 * Must be called on engine initialization and every window resize.
 *
 * @param options - Screen dimensions in CSS pixels + optional world scale.
 * @param options.width - Screen width in CSS pixels.
 * @param options.height - Screen height in CSS pixels.
 * @param options.scale - World-space scale factor applied by the main-thread
 *   world container. Defaults to 4 when omitted or zero.
 */
export const setScreenSize = (options: { width: number; height: number; scale?: number }): void => {
  screenWidth = options.width;
  screenHeight = options.height;
  if (options.scale && options.scale > 0) {
    currentWorldScale = options.scale;
  }
};

/**
 * Returns the current camera position in world-space pixels.
 *
 * Called by the serialization pipeline so the main thread can apply the
 * camera offset to the PixiJS world container.
 */
export const getCameraPosition = (): { x: number; y: number } => {
  return { x: cameraX, y: cameraY };
};

/**
 * Resets all camera tracking state to defaults.
 *
 * Useful between scene loads or in test teardown.
 */
export const resetCameraTracking = (): void => {
  cameraX = 0;
  cameraY = 0;
  mapPixelWidth = 0;
  mapPixelHeight = 0;
  screenWidth = 0;
  screenHeight = 0;
  initialized = false;
  currentWorldScale = 4;
};

// -- System update ---------------------------------------------------------

/**
 * Runs one tick of the camera system.
 *
 * Finds the entity with CameraFocus + Position, lerps the camera toward
 * it, and clamps the result to the map boundaries.
 *
 * If no entity has CameraFocus, the camera stays at its last position.
 *
 * @param world - The bitECS world.
 * @param deltaMs - Time since last tick in milliseconds.
 */
export const updateCameraSystem = (world: World, deltaMs: number): void => {
  const entities = query(world, CAMERA_QUERY_TERMS);

  if (entities.length === 0) {
    return;
  }

  // Track the first entity with CameraFocus (only one expected).
  const targetEid = entities[0];
  const pos = getComponent(world, targetEid, Position) as PositionData | undefined;

  if (!pos) {
    return;
  }

  const lerpFactor = DEFAULT_LERP_FACTOR;

  // Initialize camera to target position on first frame (no lerp snap).
  // Still apply clamping if map bounds are set.
  if (!initialized) {
    cameraX = pos.x;
    cameraY = pos.y;
    initialized = true;

    // Clamp to map boundaries on initial snap too.
    if (mapPixelWidth > 0 && mapPixelHeight > 0) {
      cameraX = _clampCamera(cameraX, screenWidth, mapPixelWidth);
      cameraY = _clampCamera(cameraY, screenHeight, mapPixelHeight);
    }
    return;
  }

  // Scale lerp by delta time so tracking speed is frame-rate independent.
  const dtScale = deltaMs / REFERENCE_FRAME_MS;
  const t = lerpFactor * dtScale;

  // Smoothly interpolate toward the target.
  cameraX += (pos.x - cameraX) * t;
  cameraY += (pos.y - cameraY) * t;

  // Clamp to map boundaries when map dimensions are set.
  if (mapPixelWidth > 0 && mapPixelHeight > 0) {
    cameraX = _clampCamera(cameraX, screenWidth, mapPixelWidth);
    cameraY = _clampCamera(cameraY, screenHeight, mapPixelHeight);
  }
};

// -- Internal helpers ------------------------------------------------------

/**
 * Clamps a single camera axis coordinate so the viewport stays within
 * `[0, mapSize]` in world pixels.
 *
 * The viewport extends `halfScreenWorld` pixels on each side of the
 * camera center. Clamping ensures neither edge exceeds the map bounds.
 *
 * @param cameraCoord - Current camera center on this axis.
 * @param screenSize - Screen dimension on this axis (CSS pixels).
 * @param mapSize - Map dimension on this axis (world pixels).
 * @returns The clamped camera coordinate.
 */
const _clampCamera = (cameraCoord: number, screenSize: number, mapSize: number): number => {
  const halfScreenWorld = screenSize / (2 * currentWorldScale);

  // If the map is smaller than the viewport, center on the map.
  if (mapSize <= halfScreenWorld * 2) {
    return mapSize / 2;
  }

  const min = halfScreenWorld;
  const max = mapSize - halfScreenWorld;

  if (cameraCoord < min) {
    return min;
  }

  if (cameraCoord > max) {
    return max;
  }

  return cameraCoord;
};
