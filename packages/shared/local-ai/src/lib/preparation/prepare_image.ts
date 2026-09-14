// packages/shared/local-ai/src/lib/preparation/prepare_image.ts
//
// C-520: the deterministic single-image preparation kernel.
//
// The kernel owns pixels, not containers. A host decodes the raw candidate
// into a straight-RGBA surface and encodes the result; everything in between
// happens here, in a fixed order, with pinned parameters. That split is what
// keeps the core portable (no `sharp`, no `node:fs`) while still making the
// prepared bytes reproducible.
//
// Two deliberate boundaries:
//
//   - `pack` and `encode` are *set-level* / *container* operations. A profile
//     may declare them, but {@link assertSingleImageProfile} refuses to run a
//     profile that mixes them into a single-image pipeline, so nothing is ever
//     silently skipped — the failure mode the recipe registry was built to
//     prevent.
//   - A stochastic segmentation model is not part of this kernel. If one
//     contributes a mask, the host runs it and records a separate, explicitly
//     non-deterministic processor in the report.
//
// Contract: C-520 Versioned image workflows and asset preparation

import {
  DETERMINISTIC_PREPARATION_PROCESSOR,
  MEDIA_VALIDATION_CODES,
  type MediaValidationCode,
} from '@aikami/constants';
import type {
  AlphaCleanupOperation,
  AlphaExtractOperation,
  MediaValidationFinding,
  PreparationOperation,
  PreparationProfile,
  ResampleOperation,
} from '@aikami/types';
import {
  alphaAt,
  cloneRgbaImage,
  cropRgbaImage,
  expandBounds,
  findGroundContact,
  findLargestOpaqueRectangle,
  findOpaqueBounds,
  luminance,
  pixelAt,
  type RgbaImage,
  resampleBoxAverage,
  resampleNearest,
  setPixel,
} from './rgba_image.ts';

/**
 * A preparation failure that is not a QA finding: the profile itself cannot be
 * executed, so no artifact should be produced at all.
 */
export class PreparationProfileError extends Error {
  readonly code: string;

  constructor(options: { code: string; message: string }) {
    super(options.message);
    this.name = 'PreparationProfileError';
    this.code = options.code;
  }
}

/** The result of running a single-image preparation profile. */
export type PreparedImage = {
  readonly image: RgbaImage;
  /**
   * The surface as it was immediately before trimming.
   *
   * The ground-rectangle QA check has to run here: after a trim, a legitimately
   * solid prop fills its own bounding box, and the two cases become
   * indistinguishable. Keeping the pre-trim surface is what lets "a surviving
   * opaque ground plane" stay a machine-checkable defect rather than an
   * eyeball judgement.
   */
  readonly preTrim: RgbaImage;
  /** Order of magnitude of the applied operations, in the order applied. */
  readonly operations: readonly string[];
  /** Ground-contact point in the prepared image's own coordinates. */
  readonly groundContact?: { x: number; y: number };
  /**
   * Offset of the prepared content's top-left inside the raw source. Recorded
   * so an origin shift between state variants is visible, not inferred.
   */
  readonly origin: { x: number; y: number };
  readonly processor: typeof DETERMINISTIC_PREPARATION_PROCESSOR;
};

const SINGLE_IMAGE_OPS = new Set([
  'decode-orient',
  'resample',
  'alpha-extract',
  'alpha-cleanup',
  'trim',
  // `encode` is a container operation the host performs, but it is *recorded*
  // here rather than skipped, so the transformation list still matches reality.
  'encode',
]);

/**
 * Refuses a profile whose operations cannot all run in the single-image kernel.
 *
 * @throws PreparationProfileError naming the operation that needs another stage.
 */
export const assertSingleImageProfile = (profile: PreparationProfile): void => {
  for (const operation of profile.operations) {
    if (!SINGLE_IMAGE_OPS.has(operation.op)) {
      throw new PreparationProfileError({
        code: 'operation-needs-another-stage',
        message: `Preparation profile "${profile.id}" declares the "${operation.op}" operation, which is not a single-image pixel operation — it belongs to the frame-set/encode stage and must not be run here, where it would be silently skipped`,
      });
    }
  }
};

// ---------------------------------------------------------------------------
// Alpha extraction
// ---------------------------------------------------------------------------

const _applyDespill = (
  pixel: { r: number; g: number; b: number },
  despill: AlphaExtractOperation['despill'],
): { r: number; g: number; b: number } => {
  if (despill === 'none') {
    return pixel;
  }
  if (despill === 'green') {
    // Clamp green to the strongest of the other channels: a linear blend that
    // destroyed the pixel keeps a green cast after extraction.
    const ceiling = Math.max(pixel.r, pixel.b);
    return { r: pixel.r, g: Math.min(pixel.g, ceiling), b: pixel.b };
  }
  const ceiling = Math.max(pixel.g, pixel.b);
  return { r: Math.min(pixel.r, ceiling), g: pixel.g, b: pixel.b };
};

/**
 * Rows at the bottom of the image where the opaque mask spans essentially the
 * whole width — the signature of a full-alpha ground render.
 *
 * Deterministic and separately recorded. Removing an opaque backdrop is a
 * geometry decision here, never a colour key: a green screen behind a green
 * cloak is not separable by colour, which is exactly why the contract bans it.
 */
const _findGroundPlaneRows = (
  image: RgbaImage,
  options: { fullWidthRatio: number; alphaFloor: number },
): { top: number; bottom: number } | undefined => {
  const spanFloor = Math.ceil(image.width * options.fullWidthRatio);
  let bottom: number | undefined;
  for (let y = image.height - 1; y >= 0; y--) {
    let opaque = 0;
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) >= options.alphaFloor) {
        opaque += 1;
      }
    }
    if (opaque >= spanFloor) {
      bottom = y;
      break;
    }
  }
  if (bottom === undefined) {
    return undefined;
  }
  let top = bottom;
  while (top - 1 >= 0) {
    let opaque = 0;
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, top - 1) >= options.alphaFloor) {
        opaque += 1;
      }
    }
    if (opaque < spanFloor) {
      break;
    }
    top -= 1;
  }
  return { top, bottom };
};

const _extractAlpha = (
  image: RgbaImage,
  operation: AlphaExtractOperation,
): { image: RgbaImage; removedGroundRows: number } => {
  const output = cloneRgbaImage(image);
  const ramp = Math.max(1, 255 - operation.threshold);

  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const pixel = pixelAt(output, x, y);
      const value = luminance(pixel);
      let alpha: number;
      if (operation.mode === 'threshold') {
        alpha = value >= operation.threshold ? 255 : 0;
      } else {
        alpha = Math.round(
          Math.min(255, Math.max(0, ((value - operation.threshold) * 255) / ramp)),
        );
      }
      const despilled = _applyDespill(pixel, operation.despill);
      setPixel(output, x, y, { ...despilled, a: alpha });
    }
  }

  if (!operation.detachGroundPlane) {
    return { image: output, removedGroundRows: 0 };
  }

  const plane = _findGroundPlaneRows(output, { fullWidthRatio: 0.95, alphaFloor: 1 });
  if (!plane) {
    return { image: output, removedGroundRows: 0 };
  }
  for (let y = plane.top; y <= plane.bottom; y++) {
    for (let x = 0; x < output.width; x++) {
      const pixel = pixelAt(output, x, y);
      setPixel(output, x, y, { ...pixel, a: 0 });
    }
  }
  return { image: output, removedGroundRows: plane.bottom - plane.top + 1 };
};

const _cleanupAlpha = (
  image: RgbaImage,
  operation: AlphaCleanupOperation,
): { image: RgbaImage; removedRectangleArea: number } => {
  const output = cloneRgbaImage(image);
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const pixel = pixelAt(output, x, y);
      if (pixel.a === 0) {
        continue;
      }
      if (pixel.a < operation.fringeThreshold) {
        setPixel(output, x, y, { ...pixel, a: 0 });
        continue;
      }
      if (pixel.a > operation.matteThreshold) {
        setPixel(output, x, y, { ...pixel, a: 255 });
      }
    }
  }

  if (!operation.removeGroundRectangle) {
    return { image: output, removedRectangleArea: 0 };
  }

  // Never turn a broken input into an empty one: a source with no transparency
  // at all is reported by QA as an unextracted ground render, so clearing the
  // only content it has would destroy the artifact instead of flagging it.
  let transparentPixels = 0;
  for (let y = 0; y < output.height && transparentPixels === 0; y++) {
    for (let x = 0; x < output.width; x++) {
      if (alphaAt(output, x, y) === 0) {
        transparentPixels += 1;
        break;
      }
    }
  }
  if (transparentPixels === 0) {
    return { image: output, removedRectangleArea: 0 };
  }

  const rectangle = findLargestOpaqueRectangle(output);
  const canvasArea = output.width * output.height;
  if (rectangle.area < canvasArea * 0.5) {
    return { image: output, removedRectangleArea: 0 };
  }
  for (let y = rectangle.bounds.minY; y <= rectangle.bounds.maxY; y++) {
    for (let x = rectangle.bounds.minX; x <= rectangle.bounds.maxX; x++) {
      const pixel = pixelAt(output, x, y);
      setPixel(output, x, y, { ...pixel, a: 0 });
    }
  }
  return { image: output, removedRectangleArea: rectangle.area };
};

// ---------------------------------------------------------------------------
// Resample
// ---------------------------------------------------------------------------

/**
 * Resolves the output size for a resample operation.
 *
 * With `lockAspectRatio` the result is the largest box that fits inside the
 * target without stretching — width and height are never scaled
 * independently, which is the defect `aspect-ratio-stretched` names.
 */
export const resolveResampleTarget = (
  image: { width: number; height: number },
  operation: ResampleOperation,
): { width: number; height: number } => {
  if (!operation.lockAspectRatio) {
    return { width: operation.targetWidth, height: operation.targetHeight };
  }
  const scale = Math.min(
    operation.targetWidth / image.width,
    operation.targetHeight / image.height,
  );
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
};

/** Applies one resample operation with its pinned method. */
export const applyResample = (image: RgbaImage, operation: ResampleOperation): RgbaImage => {
  const target = resolveResampleTarget(image, operation);
  const method = operation.method === 'nearest-neighbor' ? 'nearest-neighbor' : 'box-average';
  return method === 'nearest-neighbor'
    ? resampleNearest(image, target)
    : resampleBoxAverage(image, target);
};

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/**
 * Runs a single-image preparation profile over a decoded RGBA surface.
 *
 * @throws PreparationProfileError when the profile mixes in an operation the
 *         kernel does not execute (see {@link assertSingleImageProfile}).
 */
export const prepareRgbaImage = (options: {
  image: RgbaImage;
  profile: PreparationProfile;
}): PreparedImage => {
  const { profile } = options;
  assertSingleImageProfile(profile);

  let image = cloneRgbaImage(options.image);
  let preTrim = image;
  const operations: string[] = [];
  let origin = { x: 0, y: 0 };
  let sourceOffset = { x: 0, y: 0 };
  let sourceScale = { x: 1, y: 1 };

  for (const operation of profile.operations as readonly PreparationOperation[]) {
    operations.push(operation.op);
    switch (operation.op) {
      case 'decode-orient': {
        // Orientation is applied by the host decoder, which is the only place
        // that can read EXIF. The step stays in the profile so the recorded
        // transformation list matches what actually happened.
        break;
      }
      case 'encode': {
        // The container encode is the host's job — the kernel owns pixels. The
        // step is recorded, and `encodeExtensionForProfile` reads the format
        // back out, so the report and the artifact cannot disagree.
        break;
      }
      case 'resample': {
        const previousSize = { width: image.width, height: image.height };
        image = applyResample(image, operation);
        sourceScale = {
          x: sourceScale.x * (previousSize.width / image.width),
          y: sourceScale.y * (previousSize.height / image.height),
        };
        break;
      }
      case 'alpha-extract': {
        image = _extractAlpha(image, operation).image;
        break;
      }
      case 'alpha-cleanup': {
        image = _cleanupAlpha(image, operation).image;
        break;
      }
      case 'trim': {
        preTrim = image;
        const bounds = findOpaqueBounds(image);
        if (!bounds) {
          throw new PreparationProfileError({
            code: MEDIA_VALIDATION_CODES.alphaRequired,
            message: `Preparation profile "${profile.id}" trimmed an image with no opaque pixel — alpha extraction produced an empty surface`,
          });
        }
        const expanded = expandBounds(bounds, operation.paddingPx, image);
        sourceOffset = {
          x: sourceOffset.x + expanded.minX * sourceScale.x,
          y: sourceOffset.y + expanded.minY * sourceScale.y,
        };
        origin = sourceOffset;
        image = cropRgbaImage(image, expanded);
        break;
      }
      default: {
        throw new PreparationProfileError({
          code: 'operation-needs-another-stage',
          message: `Preparation profile "${profile.id}" reached an operation the single-image kernel does not execute: "${operation.op}"`,
        });
      }
    }
  }

  const groundContact = findGroundContact(image);
  return {
    image,
    preTrim,
    operations,
    ...(groundContact === undefined ? {} : { groundContact }),
    origin,
    processor: DETERMINISTIC_PREPARATION_PROCESSOR,
  };
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** One comparison of a re-run against the first run's prepared bytes. */
export type DeterminismFinding = MediaValidationFinding;

/**
 * Prepares the same input twice and reports whether the bytes agree.
 *
 * "Repeatable on the pinned processor" (AC-3) is a property of the kernel, and
 * asserting it here rather than trusting it means a future non-deterministic
 * op cannot land unnoticed.
 */
export const checkPreparationDeterminism = (options: {
  image: RgbaImage;
  profile: PreparationProfile;
}): readonly DeterminismFinding[] => {
  const first = prepareRgbaImage(options);
  const second = prepareRgbaImage(options);
  if (first.image.data.length === second.image.data.length) {
    let identical = true;
    for (let index = 0; index < first.image.data.length; index++) {
      if (first.image.data[index] !== second.image.data[index]) {
        identical = false;
        break;
      }
    }
    if (identical) {
      return [];
    }
  }
  return [
    {
      code: MEDIA_VALIDATION_CODES.nonDeterministicOutput,
      severity: 'error',
      message: `Preparing the same raw bytes twice with profile "${options.profile.id}" produced different pixels — the prepared hash is not a stable identity`,
    },
  ];
};

/** An empty finding list is a pass; `checkPreparationDeterminism` follows that shape too. */
export const isFindingError = (finding: MediaValidationFinding): boolean =>
  finding.severity === 'error';

/** The stable code union, re-exported so callers do not reach into constants. */
export type { MediaValidationCode };
