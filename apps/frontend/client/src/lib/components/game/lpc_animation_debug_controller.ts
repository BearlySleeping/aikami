// apps/frontend/client/src/lib/components/game/lpc_animation_debug_controller.ts
//
// Controller contract for the reusable LPC animation debug panel
// (LpcAnimationDebugPanel.svelte). Any ViewModel that drives an LPC
// character render can implement this surface to get state/direction
// dropdowns plus a full playback ticker deck (play/pause, step, speed,
// frame scrub) — shared by /dev/lpc, /dev/lpc-inventory and any future
// LPC debugger.
//
// Implementers:
//   - LpcViewModel (dev/lpc character layer debugger)
//   - LpcPreviewViewModel (character preview / inventory sandbox)

import type { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import type { ANIMATION_STATE_OPTIONS, DIRECTION_OPTIONS } from '$lib/data/lpc_asset_catalog';

export type LpcAnimationStateOption = (typeof ANIMATION_STATE_OPTIONS)[number];
export type LpcDirectionOption = (typeof DIRECTION_OPTIONS)[number];

export type LpcAnimationDebugController = {
  /** Current animation state (e.g. Walk). */
  readonly animationState: LpcAnimationState;
  setAnimationState(state: LpcAnimationState): void;
  readonly animationStateOptions: readonly LpcAnimationStateOption[];

  /** Current facing direction (e.g. Down). */
  readonly facingDirection: LpcDirection;
  setFacingDirection(direction: LpcDirection): void;
  readonly directionOptions: readonly LpcDirectionOption[];

  /** Current frame index (0-based). */
  readonly animationFrame: number;
  /** Last frame index for the current state (inclusive). */
  readonly maxFrame: number;
  setAnimationFrame(frame: number): void;

  /** Whether playback is running (ticker advancing frames). */
  readonly isPlaying: boolean;
  togglePlayback(): void;
  stepNext(): void;
  stepPrev(): void;

  /** Playback speed in frames per second. */
  readonly playbackFps: number;
  setPlaybackFps(fps: number): void;
};
