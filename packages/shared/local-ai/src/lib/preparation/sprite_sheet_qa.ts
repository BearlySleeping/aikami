// packages/shared/local-ai/src/lib/preparation/sprite_sheet_qa.ts
//
// C-520 (AC-5): judge a spritesheet as animation.
//
// The frame conventions are read from `@aikami/lpc` — the same constants the
// runtime renders with — so this can never drift into a second, hand-rolled
// copy of "13 columns, walk at row 8". A generated sheet is checked against
// the runtime's actual layout, not against a plausible-looking grid.
//
// What geometry can prove: frame count per state, missing/duplicate/empty
// frames within a row, feet drift, body-size consistency, clipped cells.
// What geometry cannot prove: that the motion reads, that the facing order is
// right, that the character is the same character. Those stay manual, and this
// module says so in its output rather than implying a green check means
// "animation approved".
//
// Contract: C-520 Versioned image workflows and asset preparation

import { SPRITE_SHEET_CODES, type SpriteSheetCode } from '@aikami/constants';
import {
  FRAMES_PER_STATE,
  LPC_STATE_NAMES,
  LpcAnimationState,
  LpcDirection,
  resolveLpcSheetGeometry,
} from '@aikami/lpc';
import { alphaAt, type RgbaImage } from './rgba_image.ts';

/** Alpha value treated as content inside an LPC cell. */
const CONTENT_ALPHA = 128;

/** Findings carry the stable code, so a reviewer can diff two runs. */
export type SpriteSheetFinding = {
  readonly code: SpriteSheetCode;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly state?: string;
  readonly direction?: number;
  readonly frame?: number;
};

/** What the reviewer declares about the sheet under test. */
export type LpcSheetExpectation = {
  /** Animation states the sheet is expected to contain. */
  readonly states: readonly LpcAnimationState[];
  /**
   * The facing order the reviewer *observed* in the sheet, top row first.
   * Omitted means "not yet observed" and produces a review prompt instead of
   * a pass. Geometry cannot read a face.
   */
  readonly declaredFacingOrder?: readonly LpcDirection[];
  /** Pixels the ground-contact point may move between frames of one row. */
  readonly maxFootDriftPx?: number;
  /** Pixels the opaque bounding-box height may change between frames of one row. */
  readonly maxBodySizeDeltaPx?: number;
};

/** The canonical LPC facing order, top row first. */
export const LPC_FACING_ORDER: readonly LpcDirection[] = [
  LpcDirection.Up,
  LpcDirection.Left,
  LpcDirection.Down,
  LpcDirection.Right,
];

/** Per-frame measurements inside one LPC cell. */
type CellMeasurement = {
  readonly fingerprint: number;
  readonly opaque: number;
  readonly groundY: number;
  readonly groundX: number;
  readonly topY: number;
  readonly height: number;
  readonly clipped: boolean;
};

const _measureCell = (options: {
  image: RgbaImage;
  originX: number;
  originY: number;
  pitch: number;
}): CellMeasurement => {
  const { image, originX, originY, pitch } = options;
  let opaque = 0;
  let groundY = -1;
  let topY = pitch;
  let groundXSum = 0;
  let groundXCount = 0;
  let clipped = false;
  let fingerprint = 2166136261;

  for (let y = 0; y < pitch; y++) {
    for (let x = 0; x < pitch; x++) {
      const alpha = alphaAt(image, originX + x, originY + y);
      const offset = ((originY + y) * image.width + (originX + x)) * 4;
      fingerprint ^=
        (alpha << 16) ^ ((image.data[offset] ?? 0) << 8) ^ (image.data[offset + 1] ?? 0);
      fingerprint = Math.imul(fingerprint, 16777619);
      if (alpha < CONTENT_ALPHA) {
        continue;
      }
      opaque += 1;
      if (y > groundY) {
        groundY = y;
        groundXSum = 0;
        groundXCount = 0;
      }
      if (y === groundY) {
        groundXSum += x;
        groundXCount += 1;
      }
      if (y < topY) {
        topY = y;
      }
      if (x === 0 || y === 0 || x === pitch - 1 || y === pitch - 1) {
        clipped = true;
      }
    }
  }

  return {
    fingerprint: fingerprint >>> 0,
    opaque,
    groundY,
    groundX: groundXCount === 0 ? -1 : Math.round(groundXSum / groundXCount),
    topY: opaque === 0 ? pitch : topY,
    height: opaque === 0 ? 0 : groundY - topY + 1,
    clipped,
  };
};

const _stateName = (state: LpcAnimationState): string => LPC_STATE_NAMES[state] ?? `state-${state}`;

/**
 * Validates one LPC spritesheet against the runtime's own layout constants.
 *
 * @returns every finding, including the always-present manual-review note.
 */
export const validateLpcSpriteSheet = (options: {
  image: RgbaImage;
  expectation: LpcSheetExpectation;
}): readonly SpriteSheetFinding[] => {
  const { image, expectation } = options;
  const findings: SpriteSheetFinding[] = [];
  const geometry = resolveLpcSheetGeometry(image);

  if (image.width % geometry.pitch !== 0 || image.height % geometry.pitch !== 0) {
    findings.push({
      code: SPRITE_SHEET_CODES.invalidCellGrid,
      severity: 'error',
      message: `Sheet is ${image.width}x${image.height}, which is not an exact multiple of the LPC ${geometry.pitch}px cell pitch — the frame grid cannot be addressed`,
    });
  }

  const columns = geometry.columns;
  const rows = geometry.rows;
  const maxFootDrift = expectation.maxFootDriftPx ?? 2;
  const maxBodyDelta = expectation.maxBodySizeDeltaPx ?? 2;
  const observedOrder: LpcDirection[] = [];

  for (const state of expectation.states) {
    const requiredFrames = FRAMES_PER_STATE[state];
    const directions =
      state === LpcAnimationState.Die
        ? [LpcDirection.Down]
        : ([LpcDirection.Up, LpcDirection.Left, LpcDirection.Down, LpcDirection.Right] as const);

    if (columns < requiredFrames) {
      findings.push({
        code: SPRITE_SHEET_CODES.wrongFrameCount,
        severity: 'error',
        message: `The "${_stateName(state)}" state needs ${requiredFrames} frames per row, but the sheet only has ${columns} columns`,
        state: _stateName(state),
      });
    }

    for (const direction of directions) {
      const row = state === LpcAnimationState.Die ? state : state + direction;
      if (row >= rows) {
        findings.push({
          code: SPRITE_SHEET_CODES.missingDirection,
          severity: 'error',
          message: `The "${_stateName(state)}" state has no row for facing ${direction} (row ${row} is past the sheet's ${rows} rows)`,
          state: _stateName(state),
          direction,
        });
        continue;
      }
      observedOrder.push(direction);

      const frames: CellMeasurement[] = [];
      for (let frame = 0; frame < requiredFrames; frame++) {
        const measurement = _measureCell({
          image,
          originX: frame * geometry.pitch,
          originY: row * geometry.pitch,
          pitch: geometry.pitch,
        });
        frames.push(measurement);

        if (measurement.opaque === 0) {
          findings.push({
            code: SPRITE_SHEET_CODES.emptyFrame,
            severity: 'error',
            message: `The "${_stateName(state)}" row for facing ${direction} has an empty frame at column ${frame} — the animation would blink out`,
            state: _stateName(state),
            direction,
            frame,
          });
          continue;
        }
        if (measurement.clipped) {
          findings.push({
            code: SPRITE_SHEET_CODES.clippedFrame,
            severity: 'error',
            message: `Frame ${frame} of "${_stateName(state)}" facing ${direction} touches its cell edge — equipment or the sprite body is cut off`,
            state: _stateName(state),
            direction,
            frame,
          });
        }
      }

      const seen = new Map<number, number>();
      for (const [frame, measurement] of frames.entries()) {
        if (measurement.opaque === 0) {
          continue;
        }
        const firstFrame = seen.get(measurement.fingerprint);
        if (firstFrame !== undefined) {
          findings.push({
            code: SPRITE_SHEET_CODES.duplicateFrame,
            severity: 'error',
            message: `Frames ${firstFrame} and ${frame} of "${_stateName(state)}" facing ${direction} are byte-identical — a duplicated frame is a frozen animation, not a repeated pose`,
            state: _stateName(state),
            direction,
            frame,
          });
          continue;
        }
        seen.set(measurement.fingerprint, frame);
      }

      const groundYs = frames.filter((frame) => frame.opaque > 0).map((frame) => frame.groundY);
      const heights = frames.filter((frame) => frame.opaque > 0).map((frame) => frame.height);
      if (groundYs.length > 1) {
        const drift = Math.max(...groundYs) - Math.min(...groundYs);
        if (drift > maxFootDrift) {
          findings.push({
            code: SPRITE_SHEET_CODES.driftingFeet,
            severity: 'error',
            message: `The ground line of "${_stateName(state)}" facing ${direction} moves ${drift}px across its frames (tolerance ${maxFootDrift}px) — the feet would sink into or float above the map`,
            state: _stateName(state),
            direction,
          });
        }
      }
      if (heights.length > 1) {
        const delta = Math.max(...heights) - Math.min(...heights);
        if (delta > maxBodyDelta) {
          findings.push({
            code: SPRITE_SHEET_CODES.inconsistentBodySize,
            severity: 'error',
            message: `The body of "${_stateName(state)}" facing ${direction} changes height by ${delta}px across its frames (tolerance ${maxBodyDelta}px) — the character appears to change size mid-animation`,
            state: _stateName(state),
            direction,
          });
        }
      }
    }
  }

  if (expectation.declaredFacingOrder === undefined) {
    findings.push({
      code: SPRITE_SHEET_CODES.wrongFacingOrder,
      severity: 'info',
      message:
        'The facing order was not declared, so it was not checked. Geometry cannot read a face — declare `declaredFacingOrder` after watching the animation.',
    });
  } else {
    const matches =
      expectation.declaredFacingOrder.length === LPC_FACING_ORDER.length &&
      expectation.declaredFacingOrder.every(
        (direction, index) => direction === LPC_FACING_ORDER[index],
      );
    if (!matches) {
      findings.push({
        code: SPRITE_SHEET_CODES.wrongFacingOrder,
        severity: 'error',
        message: `The declared facing order ${expectation.declaredFacingOrder.join(', ')} is not the runtime's up, left, down, right order — the character would face the wrong way while walking`,
      });
    }
  }

  findings.push({
    code: SPRITE_SHEET_CODES.animationReviewRequired,
    severity: 'info',
    message: `Play "${expectation.states.map(_stateName).join(', ')}" at native 1x for every facing before accepting: geometry checks do not prove temporal coherence, and a static contact sheet is not animation evidence. Existing composited LPC assets remain the release fallback.`,
  });

  return findings;
};

/** True when nothing is an error. */
export const spriteSheetPassed = (findings: readonly SpriteSheetFinding[]): boolean =>
  !findings.some((finding) => finding.severity === 'error');
