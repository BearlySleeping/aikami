// apps/backend/image/scripts/preparation_host.ts
//
// C-520: the host half of deterministic media preparation.
//
// The portable core (`@aikami/local-ai`) owns pixels; this module owns the
// container work it cannot do — decode the raw candidate the engine returned,
// hand the kernel a straight-RGBA surface, encode the result, and hash the
// bytes that are actually staged. That split is what keeps the core free of
// `node:zlib` and `Uint8Array`-adjacent host concerns while still making the
// prepared SHA-256 reproducible.
//
// The report is the auditable rejection reason: it names the raw and prepared
// hashes, the profile version, the machine findings and the fact that a human
// still has to look.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { MEDIA_VALIDATION_CODES, type MediaValidationCode } from '@aikami/constants';
import {
  buildMediaValidationReport,
  encodeExtensionForProfile,
  prepareRgbaImage,
  type RgbaImage,
  requirePreparationProfile,
  sha256Hex,
} from '@aikami/local-ai';
import type { MediaValidationFinding, MediaValidationReport } from '@aikami/types';
import { decodePng, encodePng, isPng, PngCodecError } from './png_codec.ts';

/** What the host produced for one raw candidate. */
export type PreparedCandidate = {
  readonly bytes: Uint8Array;
  readonly preparedSha256: string;
  readonly report: MediaValidationReport;
  readonly ext: string;
};

const _finding = (options: {
  code: MediaValidationCode;
  message: string;
  severity?: MediaValidationFinding['severity'];
}): MediaValidationFinding => ({
  code: options.code,
  severity: options.severity ?? 'error',
  message: options.message,
});

/**
 * Decodes raw engine bytes into a straight-RGBA surface.
 *
 * Only PNG is decoded, and only the shapes the engines emit. Anything else
 * fails with a named reason rather than being coerced, because a wrong decode
 * silently invalidates every hash downstream of it.
 */
export const decodeCandidate = (
  bytes: Uint8Array,
): { image: RgbaImage } | { finding: MediaValidationFinding } => {
  if (!isPng(bytes)) {
    return {
      finding: _finding({
        code: MEDIA_VALIDATION_CODES.formatMismatch,
        message:
          'The raw candidate is not a PNG — the deterministic preparation profiles decode PNG only, and coercing another container would commit a format the profile did not declare',
      }),
    };
  }
  try {
    const decoded = decodePng(bytes);
    return { image: { width: decoded.width, height: decoded.height, data: decoded.rgba } };
  } catch (error) {
    return {
      finding: _finding({
        code: MEDIA_VALIDATION_CODES.formatMismatch,
        message:
          error instanceof PngCodecError
            ? error.message
            : `PNG decode failed: ${(error as Error).message}`,
      }),
    };
  }
};

/**
 * Runs one preparation profile over one raw candidate.
 *
 * The report is always produced, even when the machine gate fails: a rejection
 * with a stable code is the contract's deliverable, not an exception.
 */
export const prepareCandidate = async (options: {
  rawBytes: Uint8Array;
  /** Preparation profile id, e.g. `prop-native-alpha`. */
  preparationProfileId: string;
}): Promise<PreparedCandidate> => {
  const profile = requirePreparationProfile(options.preparationProfileId);
  const inputSha256 = await sha256Hex(options.rawBytes);
  const decoded = decodeCandidate(options.rawBytes);

  if ('finding' in decoded) {
    const report = buildMediaValidationReport({
      profile,
      dimensions: { width: 1, height: 1 },
      inputSha256,
      outputSha256: inputSha256,
      operations: [],
      extraFindings: [decoded.finding],
    });
    return {
      bytes: options.rawBytes,
      preparedSha256: inputSha256,
      report,
      ext: encodeExtensionForProfile(profile),
    };
  }

  const prepared = prepareRgbaImage({ image: decoded.image, profile });
  const ext = encodeExtensionForProfile(profile);
  const encoded =
    ext === '.png'
      ? encodePng({
          width: prepared.image.width,
          height: prepared.image.height,
          rgba: prepared.image.data,
        })
      : // webp-lossless has no dependency-free encoder in this host yet; the
        // profile registry only ships PNG profiles, so this is unreachable and
        // refusing is the honest behaviour rather than writing PNG bytes under
        // a .webp name — the exact relabelling C-517 banned.
        (() => {
          throw new PngCodecError(
            `Preparation profile "${profile.id}" declares ${ext}, which this host cannot encode losslessly — refusing to relabel PNG bytes`,
          );
        })();

  const preparedSha256 = await sha256Hex(encoded);
  const report = buildMediaValidationReport({
    profile,
    image: prepared.image,
    preTrimImage: prepared.preTrim,
    inputSha256,
    outputSha256: preparedSha256,
    operations: prepared.operations,
    ...(prepared.groundContact === undefined ? {} : { groundContact: prepared.groundContact }),
  });

  return { bytes: encoded, preparedSha256, report, ext };
};
