// packages/shared/lpc/tests/elapsed_time.test.ts
//
// Elapsed-time clip playback tests (C-496 AC-5).
//
// Asserts that playback advances by wall-clock time (not refresh count),
// loops wrap by total duration, non-looping clips clamp to the final frame,
// and a single ElapsedTimeActor clock drives all layers consistently.

import { describe, expect, test } from 'bun:test';
import {
  ElapsedTimeActor,
  resolveClipFrameAtTime,
  totalClipDuration,
} from '../src/lib/elapsed_time.ts';

const walkClip = {
  frames: [
    { frameId: 'a', durationMs: 100 },
    { frameId: 'b', durationMs: 100 },
    { frameId: 'c', durationMs: 100 },
  ],
  loop: true,
};

describe('totalClipDuration', () => {
  test('sums frame durations', () => {
    expect(totalClipDuration(walkClip)).toBe(300);
  });

  test('returns 0 for an empty clip', () => {
    expect(totalClipDuration({ frames: [], loop: true })).toBe(0);
  });
});

describe('resolveClipFrameAtTime (elapsed-time clock)', () => {
  test('selects the frame by elapsed time boundaries', () => {
    expect(resolveClipFrameAtTime(walkClip, 0)).toBe('a');
    expect(resolveClipFrameAtTime(walkClip, 99)).toBe('a');
    expect(resolveClipFrameAtTime(walkClip, 100)).toBe('b');
    expect(resolveClipFrameAtTime(walkClip, 299)).toBe('c');
  });

  test('looping clips wrap by total duration', () => {
    expect(resolveClipFrameAtTime(walkClip, 300)).toBe('a');
    expect(resolveClipFrameAtTime(walkClip, 400)).toBe('b');
    expect(resolveClipFrameAtTime(walkClip, 299 + 300)).toBe('c');
  });

  test('elapsed time, not frame count, drives playback speed', () => {
    // A 60Hz host advances ~16.7ms/frame; a 30Hz host ~33.3ms/frame. After
    // the same wall-clock time (~199ms) both must show frame 'b' (index 1)
    // regardless of how many refresh ticks produced that elapsed time.
    expect(resolveClipFrameAtTime(walkClip, 199)).toBe('b');
  });

  test('non-looping clips clamp to the final frame', () => {
    const oneShot = { frames: walkClip.frames, loop: false };
    expect(resolveClipFrameAtTime(oneShot, 0)).toBe('a');
    expect(resolveClipFrameAtTime(oneShot, 250)).toBe('c');
    expect(resolveClipFrameAtTime(oneShot, 5000)).toBe('c');
  });

  test('returns undefined for an empty clip', () => {
    expect(resolveClipFrameAtTime({ frames: [], loop: true }, 10)).toBeUndefined();
  });
});

describe('ElapsedTimeActor', () => {
  test('advances monotonically and resolves the same frame for all layers', () => {
    const actor = new ElapsedTimeActor();
    actor.advance(16); // ~1 frame at 60Hz
    actor.advance(16);
    actor.advance(16);

    // One clock drives every layer; all layers resolve against the same
    // elapsed time so they stay in frame-lock.
    expect(actor.elapsedMs).toBe(48);
    expect(resolveClipFrameAtTime(walkClip, actor.elapsedMs)).toBe('a');

    actor.advance(150);
    expect(resolveClipFrameAtTime(walkClip, actor.elapsedMs)).toBe('b');
  });

  test('ignores non-positive deltas and resets to zero', () => {
    const actor = new ElapsedTimeActor();
    actor.advance(-5);
    expect(actor.elapsedMs).toBe(0);
    actor.advance(30);
    actor.reset();
    expect(actor.elapsedMs).toBe(0);
  });
});
