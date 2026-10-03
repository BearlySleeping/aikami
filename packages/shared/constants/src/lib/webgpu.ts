// packages/shared/constants/src/lib/webgpu.ts
//
// Constants for the on-device WebGPU capability: where the player goes to
// diagnose it, and where we remember that they asked us to stop nagging.

/**
 * Public, third-party compatibility checker shown when WebGPU is missing.
 *
 * Deliberately a bare origin, not a deep link: the checker is a standalone
 * page and its URL shape is not ours to pin.
 */
export const WEBGPU_COMPATIBILITY_CHECK_URL = 'https://webgpucheck.com';

/**
 * Device-local flag recording that the player dismissed the WebGPU
 * recommendation.
 *
 * Dismissal is stored (not just held in view state) because the start menu is
 * the first screen on every launch — a banner the player already refused to
 * read must not come back on the next boot. Clearing this key restores the
 * recommendation.
 */
export const WEBGPU_RECOMMENDATION_DISMISSED_STORAGE_KEY = 'aikami:webgpu:recommendation-dismissed';
