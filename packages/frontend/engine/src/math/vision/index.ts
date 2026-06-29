// packages/frontend/engine/src/math/vision/index.ts

// ---------------------------------------------------------------------------
// Vision math — zero-allocation spatial perception primitives
//
// Contract C-190: Exports the DDA raycaster (patrol vision) and Recursive
// Shadowcasting FOV engine (alert vision) for the SpatialVisionSystem.
// ---------------------------------------------------------------------------

export { castDdaVisionCone } from './dda_raycaster.ts';
export { castShadowcastingFov } from './shadowcasting.ts';
