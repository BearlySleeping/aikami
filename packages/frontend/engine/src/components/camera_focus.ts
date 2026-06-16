// packages/frontend/engine/src/components/camera_focus.ts
import type { World } from 'bitecs';
import { observe, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CameraFocus — tag component marking the camera tracking target
//
// A pure tag — carries no SoA data. When attached to an entity (typically
// the player), the {@link cameraSystem} tracks that entity's Position and
// smoothly follows it.
// ---------------------------------------------------------------------------

/** Tag component for the camera tracking target. */
export const CameraFocus = {};

/**
 * Registers set/get observers for the CameraFocus component on the given world.
 *
 * Since CameraFocus is a tag component with no data fields, the observer
 * only needs to acknowledge component addition — no SoA arrays to populate.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCameraFocusObservers = (world: World): void => {
  observe(world, onSet(CameraFocus), (_eid: number) => {
    // Tag component — no data to store. The observer exists so bitECS
    // tracks which entities have this component for query resolution.
  });
};
