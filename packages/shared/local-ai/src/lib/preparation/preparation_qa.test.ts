// packages/shared/local-ai/src/lib/preparation/preparation_qa.test.ts
//
// C-520 AC-3: "no ground rectangle or alpha fringe passes review" is a machine
// assertion with an auditable reason, and every report says a human still has
// to look.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { describe, expect, test } from 'bun:test';
import { MEDIA_VALIDATION_CODES } from '@aikami/constants';
import type { PreparationProfile } from '@aikami/types';
import {
  clippedProp,
  fringedProp,
  groundRectangle,
  hairlineProp,
  isolatedProp,
  offCentreContactProp,
} from './__fixtures__/rgba_fixtures.ts';
import { requirePreparationProfile } from './preparation_profile_registry.ts';
import {
  buildMediaValidationReport,
  evaluatePreparedImage,
  hasBlockingFinding,
} from './preparation_qa.ts';
import { prepareRgbaImage } from './prepare_image.ts';

const propProfile = (): PreparationProfile => requirePreparationProfile('prop-native-alpha');
const groundProfile = (): PreparationProfile => requirePreparationProfile('prop-full-alpha-ground');

const codesOf = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);

describe('C-520 AC-3: an isolated prop passes every machine check', () => {
  test('the clean fixture produces no blocking finding', () => {
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(hasBlockingFinding(findings)).toBe(false);
    expect(codesOf(findings)).toEqual([]);
  });
});

describe('C-520 AC-3: the defined defects are caught, each with its own code', () => {
  test('a surviving opaque ground plane is a ground rectangle', () => {
    const prepared = prepareRgbaImage({ image: groundRectangle(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.groundRectangleDetected);
  });

  test('a fully opaque prop render is refused for want of an alpha channel', () => {
    const prepared = prepareRgbaImage({ image: groundRectangle(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.alphaRequired);
  });

  test('a partial-alpha halo is a fringe finding with a measured ratio', () => {
    const prepared = prepareRgbaImage({ image: fringedProp(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    const fringe = findings.find((f) => f.code === MEDIA_VALIDATION_CODES.alphaFringeRatioExceeded);
    expect(fringe).toBeDefined();
    expect(fringe?.measured).toBeGreaterThan(0);
    expect(fringe?.limit).toBe(propProfile().qa.maxAlphaFringeRatio);
  });

  test('content touching the canvas edge is a clipped finding', () => {
    const prepared = prepareRgbaImage({ image: clippedProp(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.clippedContent);
  });

  test('a ground-contact point far from the content centre is refused', () => {
    const prepared = prepareRgbaImage({ image: offCentreContactProp(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.groundContactMissing);
  });

  test('a one-pixel-wide artifact is unreadable at native scale', () => {
    const prepared = prepareRgbaImage({ image: hairlineProp(), profile: propProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: propProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.nativeScaleUnreadable);
  });

  test('a pixel-art profile that resamples with a blending method is refused', () => {
    const pixelArt: PreparationProfile = {
      ...propProfile(),
      id: 'blending-pixel-art-fixture',
      pixelGrid: 'pixel-art',
      operations: [
        { op: 'decode-orient', autoOrient: true },
        {
          op: 'resample',
          method: 'box-average',
          targetWidth: 32,
          targetHeight: 32,
          lockAspectRatio: true,
        },
        { op: 'encode', format: 'png' },
      ],
    };
    const findings = evaluatePreparedImage({ image: isolatedProp(), profile: pixelArt });
    expect(codesOf(findings)).toContain(MEDIA_VALIDATION_CODES.resampleBlended);
  });
});

describe('C-520 AC-3: the native-alpha ground profile accepts an isolated prop', () => {
  test('native alpha and a detached ground plane pass preparation QA', () => {
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: groundProfile() });
    const findings = evaluatePreparedImage({
      image: prepared.image,
      profile: groundProfile(),
      preTrimImage: prepared.preTrim,
    });
    expect(codesOf(findings)).not.toContain(MEDIA_VALIDATION_CODES.groundRectangleDetected);
    expect(codesOf(findings)).not.toContain(MEDIA_VALIDATION_CODES.alphaRequired);
    expect(hasBlockingFinding(findings)).toBe(false);
  });
});

describe('C-520 AC-3: the report is the auditable rejection reason', () => {
  test('a passing artifact carries matching hashes and no error', () => {
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: propProfile() });
    const report = buildMediaValidationReport({
      profile: propProfile(),
      image: prepared.image,
      preTrimImage: prepared.preTrim,
      inputSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
      operations: prepared.operations,
      groundContact: prepared.groundContact ?? { x: 0, y: 0 },
    });
    expect(report.machinePassed).toBe(true);
    expect(report.inputSha256).not.toBe(report.outputSha256);
    expect(report.profileId).toBe('prop-native-alpha');
    expect(report.profileVersion).toBe('1.0.0');
    expect(report.operations).toEqual(['decode-orient', 'alpha-cleanup', 'trim', 'encode']);
    expect(report.groundContact).toBeDefined();
  });

  test('geometry passing still requires a human, and says so', () => {
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: propProfile() });
    const report = buildMediaValidationReport({
      profile: propProfile(),
      image: prepared.image,
      preTrimImage: prepared.preTrim,
      inputSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
      operations: prepared.operations,
    });
    expect(report.manualReviewRequired).toBe(true);
    expect(report.manualReviewReasons.length).toBeGreaterThan(0);
  });

  test('a failing artifact reports its code and is not machine-passed', () => {
    const prepared = prepareRgbaImage({ image: groundRectangle(), profile: propProfile() });
    const report = buildMediaValidationReport({
      profile: propProfile(),
      image: prepared.image,
      preTrimImage: prepared.preTrim,
      inputSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
      operations: prepared.operations,
    });
    expect(report.machinePassed).toBe(false);
    expect(codesOf(report.findings)).toContain(MEDIA_VALIDATION_CODES.groundRectangleDetected);
  });

  test('a stochastic contributor is recorded as non-deterministic, never as the kernel', () => {
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: propProfile() });
    const report = buildMediaValidationReport({
      profile: propProfile(),
      image: prepared.image,
      preTrimImage: prepared.preTrim,
      inputSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
      operations: prepared.operations,
      processor: { id: 'sam2-segmentation', version: '2.0.0', deterministic: false },
    });
    expect(report.processor.deterministic).toBe(false);
    expect(report.processor.id).toBe('sam2-segmentation');
  });
});
