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
//
// Contract C-161: Adds cinematic zoom and midpoint tracking for NPC
// dialogue interactions — camera zooms to 1.5× centered on the player↔NPC
// midpoint during dialogue, reverting to 1.0× when dialogue ends.
// ---------------------------------------------------------------------------

/**
 * Default lerp factor per frame at 60fps.
 *
 * 0.08 produces a gentle follow — the camera takes ~0.5s to cover half
 * the remaining distance. Increase for tighter tracking, decrease for
 * more cinematic drift.
 */
const DEFAULT_LERP_FACTOR = 0.08;

/** Zoom lerp factor — same cadence as position tracking for consistency. */
const ZOOM_LERP_FACTOR = 0.08;

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

/** When `true`, viewport boundary clamping is bypassed entirely.
 *
 * Enabled via {@link setMapBounds} options or URL query parameter
 * `disable_clamping` for visual testing sandboxes and small debug
 * maps where standard boundary enforcement pushes corner-spawned
 * characters toward the viewport edges, breaking VLM assertions.
 *
 * Contract: C-199 Visual Camera Alignment
 */
let disableClamping = false;

// -- Zoom & dialogue midpoint state (C-161) --------------------------------

/** Current zoom factor (lerps smoothly toward {@link targetZoom}). */
let currentZoom = 1.0;

/** Target zoom factor. 1.0 = normal, 1.5 = dialogue close-up. */
let targetZoom = 1.0;

/** NPC world X when dialogue zoom is active. */
let dialogueNpcX = 0;

/** NPC world Y when dialogue zoom is active. */
let dialogueNpcY = 0;

/** Player world X when dialogue began (for midpoint calculation). */
let dialoguePlayerX = 0;

/** Player world Y when dialogue began (for midpoint calculation). */
let dialoguePlayerY = 0;

/** Whether the camera is currently tracking a dialogue midpoint. */
let isDialogueZooming = false;

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
 * When `disableClamping` is `true`, viewport boundary clamping is
 * bypassed entirely — the camera can track the player to any coordinate,
 * including map corners. This is used during visual testing and small
 * debug map sandboxes where standard clamping would center the viewport
 * on the map midpoint, pushing corner-spawned characters toward the
 * screen edges and invalidating VLM centering assertions.
 *
 * @param options - Map dimensions in world-space pixels + optional clamp toggle.
 *
 * Contract: C-199 Visual Camera Alignment
 */
export const setMapBounds = (options: {
  width: number;
  height: number;
  disableClamping?: boolean;
}): void => {
  mapPixelWidth = options.width;
  mapPixelHeight = options.height;
  if (options.disableClamping !== undefined) {
    disableClamping = options.disableClamping;
  }
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
 * Returns the current camera zoom factor (lerped).
 *
 * Called by the worker to include in STATE_UPDATE for the main thread
 * to apply as a scale multiplier on the PixiJS world container.
 *
 * Contract C-161: Spatial UI Camera
 */
export const getCameraZoom = (): number => {
  return currentZoom;
};

/**
 * Returns the screen-space position of the active dialogue NPC.
 *
 * Projects the NPC's world coordinates through the current camera
 * offset, world scale, and zoom factor to produce CSS-pixel coordinates
 * suitable for DOM element positioning (e.g., speech bubble overlay).
 *
 * Returns `undefined` for both axes when no dialogue zoom is active.
 *
 * Contract C-161: Spatial UI Camera
 */
export const getActiveNpcScreenPosition = (): {
  x: number | undefined;
  y: number | undefined;
} => {
  if (!isDialogueZooming) {
    return { x: undefined, y: undefined };
  }

  const effectiveScale = currentWorldScale * currentZoom;
  const x = (dialogueNpcX - cameraX) * effectiveScale + screenWidth / 2;
  const y = (dialogueNpcY - cameraY) * effectiveScale + screenHeight / 2;
  return { x, y };
};

/**
 * Begins the cinematic dialogue zoom.
 *
 * Sets the zoom target to 1.5× and stores the NPC and player positions
 * so the camera can lerp toward their midpoint during the dialogue.
 *
 * Called from the interaction system when the player interacts with an
 * NPC (non-vendor).
 *
 * Contract C-161: Spatial UI Camera
 *
 * @param options.npcX - NPC world X coordinate.
 * @param options.npcY - NPC world Y coordinate.
 * @param options.playerX - Player world X coordinate.
 * @param options.playerY - Player world Y coordinate.
 */
export const startDialogueZoom = (options: {
  npcX: number;
  npcY: number;
  playerX: number;
  playerY: number;
}): void => {
  dialogueNpcX = options.npcX;
  dialogueNpcY = options.npcY;
  dialoguePlayerX = options.playerX;
  dialoguePlayerY = options.playerY;
  targetZoom = 1.5;
  isDialogueZooming = true;
};

/**
 * Ends the cinematic dialogue zoom.
 *
 * Sets the zoom target back to 1.0× and clears the dialogue midpoint
 * flag so the camera resumes tracking the CameraFocus entity (the player).
 *
 * Called when the game mode transitions away from DIALOGUE.
 *
 * Contract C-161: Spatial UI Camera
 */
export const endDialogueZoom = (): void => {
  targetZoom = 1.0;
  isDialogueZooming = false;
};

/**
 * Returns the current screen dimensions in CSS pixels.
 */
export const getScreenSize = (): { width: number; height: number } => {
  return { width: screenWidth, height: screenHeight };
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
  currentZoom = 1.0;
  targetZoom = 1.0;
  dialogueNpcX = 0;
  dialogueNpcY = 0;
  dialoguePlayerX = 0;
  dialoguePlayerY = 0;
  isDialogueZooming = false;
  disableClamping = false;
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

    // Clamp to map boundaries on initial snap too (C-199: skip when bypassed).
    if (!disableClamping && mapPixelWidth > 0 && mapPixelHeight > 0) {
      cameraX = _clampCamera(cameraX, screenWidth, mapPixelWidth);
      cameraY = _clampCamera(cameraY, screenHeight, mapPixelHeight);
    }
    return;
  }

  // Scale lerp by delta time so tracking speed is frame-rate independent.
  const dtScale = deltaMs / REFERENCE_FRAME_MS;
  const t = lerpFactor * dtScale;

  // Lerp zoom factor toward its target (C-161 dialogue zoom).
  if (currentZoom !== targetZoom) {
    const zoomT = ZOOM_LERP_FACTOR * dtScale;
    currentZoom += (targetZoom - currentZoom) * zoomT;

    // Snap to target when close enough to avoid infinite lerp.
    if (Math.abs(targetZoom - currentZoom) < 0.001) {
      currentZoom = targetZoom;
    }
  }

  // When dialogue zoom is active, track the midpoint between player and NPC.
  // Otherwise, track the CameraFocus entity (the player) as normal.
  const targetX = isDialogueZooming ? (dialogueNpcX + dialoguePlayerX) / 2 : pos.x;
  const targetY = isDialogueZooming ? (dialogueNpcY + dialoguePlayerY) / 2 : pos.y;

  // Smoothly interpolate toward the target.
  cameraX += (targetX - cameraX) * t;
  cameraY += (targetY - cameraY) * t;

  // Clamp to map boundaries when map dimensions are set (C-199: skip when bypassed).
  if (!disableClamping && mapPixelWidth > 0 && mapPixelHeight > 0) {
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
  // The on-screen world scale is the container scale multiplied by the
  // active zoom factor (both are applied by the main-thread renderer in
  // _updateRenderFromBuffer as `4 * cameraZoom`). Folding zoom in here keeps
  // the viewport clamp — and therefore the debug grid alignment — exactly
  // matched to what is drawn at any zoom level.
  const effectiveScale = currentWorldScale * currentZoom;
  const halfScreenWorld = screenSize / (2 * effectiveScale);

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
