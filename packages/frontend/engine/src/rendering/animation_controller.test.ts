// packages/frontend/engine/src/rendering/animation_controller.test.ts
//
// C-378: the walk cycle must survive stale render-view reads.
//
// The main-thread ticker (~16.7ms rAF) reads positions from the worker's
// render-view buffer, which updates on a setTimeout(16) loop that drifts
// under load. A single stale read yields a zero-delta frame while the
// entity is still moving; before the idle-grace fix, that frame reset the
// tick counter and the sprite never advanced past walk frame 0.

import { describe, expect, it } from 'bun:test';
import {
  AnimationController,
  getLpcFrameIndex,
  LpcAnimationState,
  LpcDirection,
} from './animation_controller.ts';

describe('AnimationController — walk cycle vs stale render reads (C-378)', () => {
  it('advances the frame column while the entity is moving', () => {
    const controller = new AnimationController();
    // First call records the position.
    controller.update({ x: 0, y: 0 });
    for (let i = 1; i <= 16; i++) {
      controller.update({ x: i * 2, y: 0 }); // moving right, 2px/frame
    }
    // 16 moving frames → tickCount 16 → effective 2 → column 2 (of 9).
    expect(controller.getFrameColumn(9)).toBe(2);
    expect(controller.isIdle).toBe(false);
  });

  it('keeps animating across occasional stale (zero-delta) reads', () => {
    const controller = new AnimationController();
    controller.update({ x: 0, y: 0 });
    // 12 moving frames, then a stale read (worker buffer didn't update),
    // then 8 more moving frames. The stale frame must NOT reset the cycle:
    // with the grace period the counter accumulates 12+8=20 ticks → column
    // 2; the old behavior reset to 0 on the stale frame → column 1.
    for (let i = 1; i <= 12; i++) {
      controller.update({ x: i * 2, y: 0 });
    }
    controller.update({ x: 24, y: 0 }); // stale — same position as last frame
    for (let i = 13; i <= 20; i++) {
      controller.update({ x: i * 2, y: 0 });
    }
    expect(controller.getFrameColumn(9)).toBe(2); // 20 ticks → floor(20/8) = 2
    expect(controller.isIdle).toBe(false);
  });

  it('locks to idle frame 0 only after a sustained stop', () => {
    const controller = new AnimationController();
    controller.update({ x: 0, y: 0 });
    for (let i = 1; i <= 10; i++) {
      controller.update({ x: i * 2, y: 0 });
    }
    expect(controller.isIdle).toBe(false);

    // One or two zero-delta frames (stale reads) keep the walk state.
    controller.update({ x: 20, y: 0 });
    controller.update({ x: 20, y: 0 });
    expect(controller.isIdle).toBe(false);

    // A sustained stop (>= IDLE_GRACE_FRAMES = 6) locks to idle.
    for (let i = 0; i < 6; i++) {
      controller.update({ x: 20, y: 0 });
    }
    expect(controller.isIdle).toBe(true);
    expect(controller.getFrameColumn(9)).toBe(0);
  });

  it('facing direction follows the last nonzero movement vector', () => {
    const controller = new AnimationController();
    controller.update({ x: 0, y: 0 });
    controller.update({ x: 0, y: -2 }); // up
    expect(controller.direction).toBe(LpcDirection.Up);
    controller.update({ x: 3, y: 0 }); // right (horizontal priority)
    expect(controller.direction).toBe(LpcDirection.Right);
  });

  it('getLpcFrameIndex stays within the walk row for large tick counts', () => {
    const index = getLpcFrameIndex(LpcAnimationState.Walk, LpcDirection.Down, 1_000_003);
    // Down row = Walk(8) + Down(2) = 10; 13 columns; frame = 10*13 + (1000003 % 9).
    expect(index).toBe(10 * 13 + (1_000_003 % 9));
  });
});
