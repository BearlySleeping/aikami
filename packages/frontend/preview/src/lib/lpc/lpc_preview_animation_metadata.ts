// packages/frontend/preview/src/lib/lpc/lpc_preview_animation_metadata.ts
//
// Static LPC animation metadata for the preview controls: the state/direction
// label tables and the per-state frame counts. Extracted from the view model so
// the tables stay isolated from PixiJS state and the view model keeps within
// its source-size budget.

import { LpcAnimationState, LpcDirection } from '@aikami/lpc';

// LpcAnimationState/LpcDirection are `as const` objects (not real TS enums),
// so there's no reverse string mapping. Build the label pairs once here.
const STATE_LABELS: Record<number, string> = {
  [LpcAnimationState.Spellcast]: 'Spellcast',
  [LpcAnimationState.Thrust]: 'Thrust',
  [LpcAnimationState.Walk]: 'Walk',
  [LpcAnimationState.Slash]: 'Slash',
  [LpcAnimationState.Shoot]: 'Shoot',
  [LpcAnimationState.Die]: 'Die',
};
const DIR_LABELS: Record<number, string> = {
  [LpcDirection.Up]: 'Up',
  [LpcDirection.Down]: 'Down',
  [LpcDirection.Left]: 'Left',
  [LpcDirection.Right]: 'Right',
};

export const ANIMATION_STATE_OPTIONS: readonly { value: number; label: string }[] = Object.values(
  LpcAnimationState,
).map((value) => ({ value, label: STATE_LABELS[value] ?? String(value) }));
export const DIRECTION_OPTIONS: readonly { value: number; label: string }[] = Object.values(
  LpcDirection,
).map((value) => ({ value, label: DIR_LABELS[value] ?? String(value) }));

const FRAME_COUNTS: Record<number, number> = {
  [LpcAnimationState.Spellcast]: 6,
  [LpcAnimationState.Thrust]: 7,
  [LpcAnimationState.Walk]: 8,
  [LpcAnimationState.Slash]: 5,
  [LpcAnimationState.Shoot]: 12,
  [LpcAnimationState.Die]: 5,
};

/** Number of frames in the given animation cycle; defaults to 8. */
export const maxFrameFor = (state: LpcAnimationState): number => FRAME_COUNTS[state] ?? 8;
