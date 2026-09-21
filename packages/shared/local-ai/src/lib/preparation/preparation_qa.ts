// packages/shared/local-ai/src/lib/preparation/preparation_qa.ts
//
// C-520: machine QA for a prepared image, and the report that records it.
//
// The checks exist because "transparent-friendly" is a prompt word. Each one
// answers a question a reviewer would otherwise have to eyeball:
//
//   * Is there really an alpha channel, or a full-alpha ground render?
//   * Did a checkerboard / colour-key extraction leave a fringe?
//   * Is opaque content touching the canvas edge (a clipped sprite)?
//   * Does the sprite have a ground-contact point at all?
//   * Is anything still readable at native 1x?
//
// None of them proves the art is *good*. That is why every report carries
// `manualReviewRequired`: geometry alone does not establish visual or temporal
// coherence, and the contract says so explicitly.
//
// Contract: C-520 Versioned image workflows and asset preparation

import {
  DETERMINISTIC_PREPARATION_PROCESSOR,
  MANUAL_REVIEW_CODES,
  MEDIA_VALIDATION_CODES,
  type MediaValidationCode,
} from '@aikami/constants';
import type {
  MediaValidationFinding,
  MediaValidationReport,
  PreparationProfile,
} from '@aikami/types';
import {
  alphaAt,
  findLargestOpaqueRectangle,
  findOpaqueBounds,
  luminance,
  pixelAt,
  type RgbaImage,
} from './rgba_image.ts';

/** Roles where a full-frame opaque canvas is a defect rather than the intent. */
const ALPHA_ROLES = new Set(['prop-sprite', 'sprite-sheet']);

/** Alpha value treated as "opaque enough to be content". */
const CONTENT_ALPHA = 128;

/** Share of the canvas above which the largest opaque block is a ground plane. */
const GROUND_RECTANGLE_SHARE = 0.5;

/** How far the ground-contact point may sit from the content's horizontal centre. */
const GROUND_CONTACT_CENTRE_TOLERANCE = 0.1;

const _share = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

/** Counts pixels by alpha class and the longest opaque run on either axis. */
const _measureAlpha = (
  image: RgbaImage,
): {
  opaque: number;
  transparent: number;
  partial: number;
  boundaryOpaque: number;
  longestRun: number;
  edgeOpaque: number;
} => {
  let opaque = 0;
  let transparent = 0;
  let partial = 0;
  let boundaryOpaque = 0;
  let edgeOpaque = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = alphaAt(image, x, y);
      if (alpha === 0) {
        transparent += 1;
        continue;
      }
      if (alpha === 255) {
        opaque += 1;
        const touchesTransparent =
          alphaAt(image, x - 1, y) === 0 ||
          alphaAt(image, x + 1, y) === 0 ||
          alphaAt(image, x, y - 1) === 0 ||
          alphaAt(image, x, y + 1) === 0;
        if (touchesTransparent) {
          boundaryOpaque += 1;
        }
      } else {
        partial += 1;
      }
      if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) {
        edgeOpaque += 1;
      }
    }
  }

  let longestRun = 0;
  for (let y = 0; y < image.height; y++) {
    let run = 0;
    for (let x = 0; x <= image.width; x++) {
      const content = x < image.width && alphaAt(image, x, y) >= CONTENT_ALPHA;
      run = content ? run + 1 : 0;
      if (run > longestRun) {
        longestRun = run;
      }
    }
  }
  for (let x = 0; x < image.width; x++) {
    let run = 0;
    for (let y = 0; y <= image.height; y++) {
      const content = y < image.height && alphaAt(image, x, y) >= CONTENT_ALPHA;
      run = content ? run + 1 : 0;
      if (run > longestRun) {
        longestRun = run;
      }
    }
  }

  return { opaque, transparent, partial, boundaryOpaque, longestRun, edgeOpaque };
};

/**
 * Runs every machine check the profile declares and returns the findings.
 *
 * The list is ordered by check, not by severity, so a diff between two runs is
 * readable.
 */
export const evaluatePreparedImage = (options: {
  image: RgbaImage;
  profile: PreparationProfile;
  /**
   * The surface before trimming, when the profile trims. The ground-rectangle
   * check is meaningless after a trim — a solid prop fills its own box, which
   * is indistinguishable from a surviving ground plane.
   */
  preTrimImage?: RgbaImage;
}): readonly MediaValidationFinding[] => {
  const { image, profile } = options;
  const findings: MediaValidationFinding[] = [];
  const measured = _measureAlpha(image);
  const requiresAlpha = ALPHA_ROLES.has(profile.role);

  if (measured.opaque + measured.partial === 0) {
    findings.push({
      code: MEDIA_VALIDATION_CODES.alphaRequired,
      severity: 'error',
      message: 'The prepared image has no opaque pixel — nothing would render',
      measured: 0,
      limit: 1,
    });
  }

  if (requiresAlpha && measured.transparent === 0) {
    findings.push({
      code: MEDIA_VALIDATION_CODES.alphaRequired,
      severity: 'error',
      message: `Preparation profile "${profile.id}" produces a "${profile.role}" but the prepared image is fully opaque — a full-alpha ground render is not an isolated transparent prop`,
      measured: measured.transparent,
      limit: 1,
    });
  }

  if (requiresAlpha) {
    const reference = options.preTrimImage ?? image;
    const referenceArea = reference.width * reference.height;
    const rectangle = findLargestOpaqueRectangle(reference);
    const share = _share(rectangle.area, referenceArea);
    if (share >= GROUND_RECTANGLE_SHARE) {
      findings.push({
        code: MEDIA_VALIDATION_CODES.groundRectangleDetected,
        severity: 'error',
        message: `The largest opaque block covers ${Math.round(share * 100)}% of the pre-trim canvas (${rectangle.bounds.maxX - rectangle.bounds.minX + 1}x${rectangle.bounds.maxY - rectangle.bounds.minY + 1} at ${rectangle.bounds.minX},${rectangle.bounds.minY}) — a surviving ground plane is not an isolated prop, and colour-keying the opaque backdrop is not an approved removal`,
        measured: share,
        limit: GROUND_RECTANGLE_SHARE,
      });
    }
  }

  const boundaryPixels = measured.partial + measured.boundaryOpaque;
  const fringeRatio = _share(measured.partial, boundaryPixels);
  if (boundaryPixels > 0 && fringeRatio > profile.qa.maxAlphaFringeRatio) {
    findings.push({
      code: MEDIA_VALIDATION_CODES.alphaFringeRatioExceeded,
      severity: 'error',
      message: `${Math.round(fringeRatio * 1000) / 10}% of the silhouette pixels carry partial alpha (limit ${Math.round(profile.qa.maxAlphaFringeRatio * 1000) / 10}%) — a checkerboard or colour-key extraction leaves exactly this edge`,
      measured: fringeRatio,
      limit: profile.qa.maxAlphaFringeRatio,
    });
  }

  if (profile.qa.forbidClippedContent && measured.edgeOpaque > 0) {
    findings.push({
      code: MEDIA_VALIDATION_CODES.clippedContent,
      severity: 'error',
      message: `${measured.edgeOpaque} opaque pixel(s) touch the canvas edge — the sprite is clipped, or equipment has been cut off`,
      measured: measured.edgeOpaque,
      limit: 0,
    });
  }

  if (profile.qa.requireGroundContact) {
    const bounds = findOpaqueBounds(image);
    if (!bounds) {
      findings.push({
        code: MEDIA_VALIDATION_CODES.groundContactMissing,
        severity: 'error',
        message: 'No opaque pixel exists, so there is no ground-contact point',
        measured: 0,
        limit: 1,
      });
    } else {
      let sum = 0;
      let count = 0;
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (alphaAt(image, x, bounds.maxY) >= 1) {
          sum += x;
          count += 1;
        }
      }
      const centre = (bounds.minX + bounds.maxX) / 2;
      const contact = count === 0 ? centre : sum / count;
      const tolerance = Math.max(
        1,
        (bounds.maxX - bounds.minX + 1) * GROUND_CONTACT_CENTRE_TOLERANCE,
      );
      if (Math.abs(contact - centre) > tolerance) {
        findings.push({
          code: MEDIA_VALIDATION_CODES.groundContactMissing,
          severity: 'error',
          message: `The ground-contact point sits at x=${Math.round(contact)} while the content centre is x=${Math.round(centre)} — the sprite would stand off-centre on its footprint`,
          measured: Math.abs(contact - centre),
          limit: tolerance,
        });
      }
    }
  }

  if (measured.longestRun < profile.qa.minNativeScaleFeaturePx) {
    findings.push({
      code: MEDIA_VALIDATION_CODES.nativeScaleUnreadable,
      severity: 'error',
      message: `The longest opaque run is ${measured.longestRun}px, below the ${profile.qa.minNativeScaleFeaturePx}px native-scale readability floor — the artifact would not read at 1x`,
      measured: measured.longestRun,
      limit: profile.qa.minNativeScaleFeaturePx,
    });
  }

  // A colour ramp that survived a nearest-neighbour resample is impossible;
  // every distinct colour in a nearest-neighbour output existed in the input.
  // The kernel is the only thing that can violate this, so the finding is
  // raised by name rather than by remembering to check.
  if (profile.pixelGrid === 'pixel-art') {
    const resample = profile.operations.find((operation) => operation.op === 'resample');
    if (resample?.op === 'resample' && resample.method !== 'nearest-neighbor') {
      findings.push({
        code: MEDIA_VALIDATION_CODES.resampleBlended,
        severity: 'error',
        message: `Preparation profile "${profile.id}" declares the pixel-art grid but resamples with "${resample.method}" — pixel clusters must use nearest-neighbor`,
      });
    }
  }

  return findings;
};

/** True when no finding is an error. */
export const hasBlockingFinding = (findings: readonly MediaValidationFinding[]): boolean =>
  findings.some((finding) => finding.severity === 'error');

/**
 * Assembles the report a reviewer reads.
 *
 * `outputSha256` is the hash of the *encoded* prepared bytes — the identity a
 * pack reference is pinned to — not of the in-memory surface, so the report
 * and the artifact cannot drift apart.
 */
export const buildMediaValidationReport = (options: {
  profile: PreparationProfile;
  /**
   * The prepared surface. Absent only when the candidate could not be decoded
   * at all — there are then no pixels to evaluate, and the caller supplies the
   * reason through `extraFindings`.
   */
  image?: RgbaImage;
  /** Canvas size to record when there is no surface (e.g. an undecodable input). */
  dimensions?: { width: number; height: number };
  inputSha256: string;
  outputSha256: string;
  operations: readonly string[];
  groundContact?: { x: number; y: number };
  preTrimImage?: RgbaImage;
  processor?: MediaValidationReport['processor'];
  /** Extra findings contributed by a stage outside this kernel. */
  extraFindings?: readonly MediaValidationFinding[];
}): MediaValidationReport => {
  const findings =
    options.image === undefined
      ? []
      : [
          ...evaluatePreparedImage({
            image: options.image,
            profile: options.profile,
            ...(options.preTrimImage === undefined ? {} : { preTrimImage: options.preTrimImage }),
          }),
        ];
  const dimensions = options.image ?? options.dimensions;
  if (!dimensions) {
    throw new Error(
      `buildMediaValidationReport for profile "${options.profile.id}" needs either a prepared surface or an explicit canvas size`,
    );
  }
  for (const finding of options.extraFindings ?? []) {
    findings.push(finding);
  }

  const manualReviewReasons = findings
    .filter(
      (finding) =>
        finding.severity === 'warning' ||
        (MANUAL_REVIEW_CODES as readonly string[]).includes(finding.code),
    )
    .map((finding) => `${finding.code}: ${finding.message}`);
  for (const code of options.profile.qa.manualReviewCodes) {
    manualReviewReasons.push(`${code}: declared a manual-review trigger by the profile`);
  }
  if (manualReviewReasons.length === 0) {
    manualReviewReasons.push(
      'geometry checks cannot establish visual or temporal coherence — a human must look at the prepared artifact',
    );
  }

  return {
    schemaVersion: 1,
    profileId: options.profile.id,
    profileVersion: options.profile.version,
    processor: options.processor ?? DETERMINISTIC_PREPARATION_PROCESSOR,
    inputSha256: options.inputSha256,
    outputSha256: options.outputSha256,
    width: dimensions.width,
    height: dimensions.height,
    ...(options.groundContact === undefined ? {} : { groundContact: options.groundContact }),
    operations: [...options.operations],
    machinePassed: !hasBlockingFinding(findings),
    findings,
    manualReviewRequired: true,
    manualReviewReasons,
  };
};

/** Convenience: the luminance of one prepared pixel, for contact-sheet helpers. */
export const preparedLuminanceAt = (image: RgbaImage, x: number, y: number): number =>
  luminance(pixelAt(image, x, y));

/** Re-exported so a caller can name a code without importing constants. */
export type { MediaValidationCode };
