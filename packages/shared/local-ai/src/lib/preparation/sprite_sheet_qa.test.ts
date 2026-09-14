// packages/shared/local-ai/src/lib/preparation/sprite_sheet_qa.test.ts
//
// C-520 AC-5: a generated sheet is judged as animation against the runtime's
// own LPC layout constants, and a still is never accepted as motion evidence.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { describe, expect, test } from 'bun:test';
import { SPRITE_SHEET_CODES } from '@aikami/constants';
import { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import { blankImage, lpcSheet, paintRect } from './__fixtures__/rgba_fixtures.ts';
import {
  LPC_FACING_ORDER,
  type LpcSheetExpectation,
  spriteSheetPassed,
  validateLpcSpriteSheet,
} from './sprite_sheet_qa.ts';

const codesOf = (findings: readonly { code: string }[]): string[] =>
  findings.map((finding) => finding.code);

const expectation: LpcSheetExpectation = {
  states: [LpcAnimationState.Walk, LpcAnimationState.Slash],
  declaredFacingOrder: LPC_FACING_ORDER,
  maxFootDriftPx: 2,
  maxBodySizeDeltaPx: 2,
};

describe('C-520 AC-5: a valid LPC-valid baseline passes the geometry gate', () => {
  test('a well-formed walk/slash block has no error', () => {
    const findings = validateLpcSpriteSheet({ image: lpcSheet(), expectation });
    expect(
      codesOf(findings).filter((code) => code !== SPRITE_SHEET_CODES.animationReviewRequired),
    ).toEqual([]);
    expect(spriteSheetPassed(findings)).toBe(true);
  });

  test('the sheet is always reported as needing an animation review', () => {
    const findings = validateLpcSpriteSheet({ image: lpcSheet(), expectation });
    const review = findings.find(
      (finding) => finding.code === SPRITE_SHEET_CODES.animationReviewRequired,
    );
    expect(review).toBeDefined();
    expect(review?.severity).toBe('info');
    expect(review?.message).toContain('native 1x');
    expect(review?.message).toContain('release fallback');
  });

  test('the runtime facing order is up, left, down, right', () => {
    expect(LPC_FACING_ORDER).toEqual([
      LpcDirection.Up,
      LpcDirection.Left,
      LpcDirection.Down,
      LpcDirection.Right,
    ]);
  });
});

describe('C-520 AC-5: malformed sheets are rejected', () => {
  test('a missing facing row is reported per direction', () => {
    // Only four rows: the walk block exists, the slash block does not.
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({ height: 4 * 64 }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.missingDirection);
    expect(spriteSheetPassed(findings)).toBe(false);
  });

  test('too few columns for a state is a frame-count failure', () => {
    const findings = validateLpcSpriteSheet({ image: lpcSheet({ width: 8 * 64 }), expectation });
    const frameCount = findings.filter(
      (finding) => finding.code === SPRITE_SHEET_CODES.wrongFrameCount,
    );
    expect(frameCount.length).toBeGreaterThan(0);
    expect(frameCount[0]?.message).toContain('9 frames');
  });

  test('an empty frame inside a state row is rejected', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({
        mutate: ({ image, state, direction, frame, pitch, originX, originY }) => {
          if (state !== LpcAnimationState.Walk || direction !== LpcDirection.Down || frame !== 3) {
            return;
          }
          paintRect(
            image,
            { x: originX, y: originY, width: pitch, height: pitch },
            {
              r: 0,
              g: 0,
              b: 0,
              a: 0,
            },
          );
        },
      }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.emptyFrame);
  });

  test('a duplicated frame is a frozen animation, not a repeated pose', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({
        mutate: ({ image, state, direction, frame, pitch, originX, originY }) => {
          if (state !== LpcAnimationState.Walk || direction !== LpcDirection.Up) {
            return;
          }
          // Frame 5 is a byte-for-byte copy of frame 1.
          const sourceX = 1 * pitch;
          for (let y = 0; y < pitch; y++) {
            for (let x = 0; x < pitch; x++) {
              const offset = (originY + y) * image.width + (sourceX + x);
              const target = (originY + y) * image.width + (originX + x);
              if (frame === 5) {
                image.data[target * 4] = image.data[offset * 4] ?? 0;
                image.data[target * 4 + 1] = image.data[offset * 4 + 1] ?? 0;
                image.data[target * 4 + 2] = image.data[offset * 4 + 2] ?? 0;
                image.data[target * 4 + 3] = image.data[offset * 4 + 3] ?? 0;
              }
            }
          }
        },
      }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.duplicateFrame);
  });

  test('drifting feet are rejected against the row baseline', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({
        mutate: ({ image, state, direction, frame, pitch, originX, originY }) => {
          if (state !== LpcAnimationState.Walk || direction !== LpcDirection.Left) {
            return;
          }
          // Drop frame 4's body by 6px — the feet sink into the map.
          if (frame !== 4) {
            return;
          }
          paintRect(
            image,
            { x: originX, y: originY, width: pitch, height: pitch },
            {
              r: 0,
              g: 0,
              b: 0,
              a: 0,
            },
          );
          paintRect(
            image,
            { x: originX + 22, y: originY + 26, width: 20, height: 32 },
            {
              r: 220,
              g: 220,
              b: 210,
              a: 255,
            },
          );
        },
      }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.driftingFeet);
  });

  test('an inconsistent body size across a row is rejected', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({
        mutate: ({ image, state, direction, frame, pitch, originX, originY }) => {
          if (
            state !== LpcAnimationState.Slash ||
            direction !== LpcDirection.Right ||
            frame !== 2
          ) {
            return;
          }
          paintRect(
            image,
            { x: originX, y: originY, width: pitch, height: pitch },
            {
              r: 0,
              g: 0,
              b: 0,
              a: 0,
            },
          );
          paintRect(
            image,
            { x: originX + 22, y: originY + 12, width: 20, height: 40 },
            {
              r: 220,
              g: 220,
              b: 210,
              a: 255,
            },
          );
        },
      }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.inconsistentBodySize);
  });

  test('a frame touching its cell edge is clipping, not padding', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet({
        mutate: ({ image, state, direction, frame, pitch, originX, originY }) => {
          if (state !== LpcAnimationState.Walk || direction !== LpcDirection.Down || frame !== 1) {
            return;
          }
          paintRect(
            image,
            { x: originX, y: originY + 40, width: pitch, height: 8 },
            {
              r: 220,
              g: 220,
              b: 210,
              a: 255,
            },
          );
        },
      }),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.clippedFrame);
  });

  test('an undeclared facing order is a review prompt, not a pass', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet(),
      expectation: { states: [LpcAnimationState.Walk] },
    });
    const order = findings.find((finding) => finding.code === SPRITE_SHEET_CODES.wrongFacingOrder);
    expect(order?.severity).toBe('info');
    expect(order?.message).toContain('Geometry cannot read a face');
  });

  test('a declared order other than up/left/down/right is rejected', () => {
    const findings = validateLpcSpriteSheet({
      image: lpcSheet(),
      expectation: {
        states: [LpcAnimationState.Walk],
        declaredFacingOrder: [
          LpcDirection.Down,
          LpcDirection.Up,
          LpcDirection.Left,
          LpcDirection.Right,
        ],
      },
    });
    const order = findings.find((finding) => finding.code === SPRITE_SHEET_CODES.wrongFacingOrder);
    expect(order?.severity).toBe('error');
    expect(spriteSheetPassed(findings)).toBe(false);
  });

  test('a sheet that is not a multiple of the cell pitch cannot be addressed', () => {
    const findings = validateLpcSpriteSheet({
      image: blankImage(830, 1344),
      expectation,
    });
    expect(codesOf(findings)).toContain(SPRITE_SHEET_CODES.invalidCellGrid);
  });
});
