// packages/shared/local-ai/src/lib/preparation/prepare_image.test.ts
//
// C-520 AC-3: preparation is deterministic and repeatable, and AC-4: a state
// variant keeps its canvas, origin and ground contact.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { describe, expect, test } from 'bun:test';
import { MEDIA_VALIDATION_CODES } from '@aikami/constants';
import type { PreparationProfile } from '@aikami/types';
import {
  blankImage,
  fullAlphaGroundProp,
  isolatedProp,
  OPAQUE_LIGHT,
  opaquePixelCount,
  paintRect,
} from './__fixtures__/rgba_fixtures.ts';
import {
  listPreparationProfiles,
  registerPreparationProfile,
  requirePreparationProfile,
} from './preparation_profile_registry.ts';
import {
  checkPreparationDeterminism,
  PreparationProfileError,
  prepareRgbaImage,
  resolveResampleTarget,
} from './prepare_image.ts';
import {
  alphaAt,
  findGroundContact,
  findLargestOpaqueRectangle,
  pixelAt,
  resampleBoxAverage,
  resampleNearest,
} from './rgba_image.ts';

const profile = (id: string): PreparationProfile => requirePreparationProfile(id);

/** Serialises a surface so two runs can be compared byte for byte. */
const bytesOf = (image: { data: Uint8Array }): string => Buffer.from(image.data).toString('base64');

describe('C-520 AC-3: prepared bytes are repeatable', () => {
  test('preparing the same raw twice produces identical pixels', () => {
    const source = isolatedProp();
    const prepared = profile('prop-native-alpha');
    const first = prepareRgbaImage({ image: source, profile: prepared });
    const second = prepareRgbaImage({ image: source, profile: prepared });
    expect(bytesOf(first.image)).toBe(bytesOf(second.image));
    expect(first.groundContact).toEqual(second.groundContact);
    expect(first.origin).toEqual(second.origin);
  });

  test('the determinism check reports an empty finding list for a deterministic profile', () => {
    expect(
      checkPreparationDeterminism({
        image: isolatedProp(),
        profile: profile('prop-native-alpha'),
      }),
    ).toEqual([]);
  });

  test('the applied operation list is the profile order, so the record cannot drift', () => {
    const prepared = prepareRgbaImage({
      image: fullAlphaGroundProp(),
      profile: profile('prop-full-alpha-ground'),
    });
    expect(prepared.operations).toEqual([
      'decode-orient',
      'alpha-extract',
      'alpha-cleanup',
      'trim',
      'encode',
    ]);
    expect(prepared.processor.id).toBe('aikami-deterministic-preparation');
    expect(prepared.processor.deterministic).toBe(true);
  });

  test('nearest-neighbour never introduces a colour the source did not have', () => {
    const source = blankImage(4, 4);
    paintRect(source, { x: 0, y: 0, width: 2, height: 2 }, OPAQUE_LIGHT);
    paintRect(source, { x: 2, y: 2, width: 2, height: 2 }, { r: 10, g: 40, b: 90, a: 255 });

    const upscaled = resampleNearest(source, { width: 16, height: 16 });
    const colours = new Set<string>();
    for (let y = 0; y < upscaled.height; y++) {
      for (let x = 0; x < upscaled.width; x++) {
        const pixel = pixelAt(upscaled, x, y);
        if (pixel.a === 0) {
          continue;
        }
        colours.add(`${pixel.r},${pixel.g},${pixel.b}`);
      }
    }
    expect([...colours].sort()).toEqual(['10,40,90', '220,220,210']);
  });

  test('box-average downscale is exact and deterministic', () => {
    const source = blankImage(4, 4);
    paintRect(source, { x: 0, y: 0, width: 2, height: 4 }, { r: 0, g: 0, b: 0, a: 255 });
    paintRect(source, { x: 2, y: 0, width: 2, height: 4 }, { r: 100, g: 100, b: 100, a: 255 });

    const downscaled = resampleBoxAverage(source, { width: 2, height: 2 });
    // Left half averages to black, right half to mid grey — in premultiplied
    // and in straight alpha, since every source pixel is fully opaque.
    expect(pixelAt(downscaled, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(pixelAt(downscaled, 1, 0)).toEqual({ r: 100, g: 100, b: 100, a: 255 });
    expect(bytesOf(downscaled)).toBe(bytesOf(resampleBoxAverage(source, { width: 2, height: 2 })));
  });

  test('transparent neighbours do not darken a downscaled edge', () => {
    const source = blankImage(2, 2);
    paintRect(source, { x: 0, y: 0, width: 2, height: 2 }, { r: 255, g: 255, b: 255, a: 255 });
    paintRect(source, { x: 0, y: 1, width: 2, height: 1 }, { r: 0, g: 0, b: 0, a: 0 });

    const downscaled = resampleBoxAverage(source, { width: 2, height: 1 });
    // Half coverage: alpha 128, but the colour must stay white, not grey.
    const pixel = pixelAt(downscaled, 0, 0);
    expect(pixel.r).toBe(255);
    expect(pixel.a).toBe(128);
  });
});

describe('C-520 AC-3/AC-4: aspect ratio is never stretched', () => {
  test('lockAspectRatio returns the largest fitting box', () => {
    expect(
      resolveResampleTarget(
        { width: 100, height: 50 },
        {
          op: 'resample',
          method: 'nearest-neighbor',
          targetWidth: 64,
          targetHeight: 64,
          lockAspectRatio: true,
        },
      ),
    ).toEqual({ width: 64, height: 32 });
  });

  test('an unlocked resample is what the profile asked for, not a default', () => {
    expect(
      resolveResampleTarget(
        { width: 100, height: 50 },
        {
          op: 'resample',
          method: 'nearest-neighbor',
          targetWidth: 64,
          targetHeight: 64,
          lockAspectRatio: false,
        },
      ),
    ).toEqual({ width: 64, height: 64 });
  });
});

describe('C-520 AC-3: a full-alpha ground render becomes an isolated prop', () => {
  test('the opaque backdrop is gone and the prop survives', () => {
    const source = fullAlphaGroundProp({ width: 64, height: 64, groundRows: 6 });
    const prepared = prepareRgbaImage({
      image: source,
      profile: profile('prop-full-alpha-ground'),
    });

    expect(findLargestOpaqueRectangle(source).area).toBeGreaterThan(
      source.width * source.height * 0.5,
    );
    const remaining = findLargestOpaqueRectangle(prepared.preTrim);
    expect(remaining.area).toBeLessThan(prepared.preTrim.width * prepared.preTrim.height * 0.5);
    expect(opaquePixelCount(prepared.image)).toBeGreaterThan(0);
    expect(prepared.image.width).toBeLessThan(64);
  });

  test('the trim records the origin the content came from', () => {
    const source = isolatedProp({ width: 64, height: 64, propWidth: 24, propHeight: 40 });
    const prepared = prepareRgbaImage({ image: source, profile: profile('prop-native-alpha') });
    expect(prepared.origin.x).toBeGreaterThan(0);
    expect(prepared.origin.y).toBeGreaterThan(0);
    expect(prepared.image.width).toBeLessThanOrEqual(26);
    expect(prepared.image.height).toBeLessThanOrEqual(42);
  });

  test('a trim after resampling records its origin in raw-source coordinates', () => {
    const base = profile('prop-native-alpha');
    const resampledAndTrimmed: PreparationProfile = {
      ...base,
      id: 'resampled-trim-fixture',
      operations: [
        { op: 'decode-orient', autoOrient: true },
        {
          op: 'resample',
          method: 'nearest-neighbor',
          targetWidth: 32,
          targetHeight: 32,
          lockAspectRatio: true,
        },
        {
          op: 'alpha-cleanup',
          fringeThreshold: 24,
          matteThreshold: 230,
          removeGroundRectangle: true,
        },
        { op: 'trim', preserveGroundContact: true, paddingPx: 1 },
        { op: 'encode', format: 'png' },
      ],
    };
    const prepared = prepareRgbaImage({ image: isolatedProp(), profile: resampledAndTrimmed });
    expect(prepared.origin).toEqual({ x: 18, y: 18 });
  });

  test('the ground-contact point is preserved in the prepared image coordinates', () => {
    const source = isolatedProp({ width: 64, height: 64, propWidth: 24, propHeight: 40 });
    const prepared = prepareRgbaImage({ image: source, profile: profile('prop-native-alpha') });
    const expected = findGroundContact(source);
    expect(prepared.groundContact).toBeDefined();
    expect(expected).toBeDefined();
    if (!prepared.groundContact || !expected) {
      throw new Error('fixture must have both source and prepared ground contact');
    }
    // Padding is 1px on each side, so the contact point moves by exactly the
    // padding relative to the raw image's own contact point.
    expect(prepared.groundContact.y).toBe(expected.y - prepared.origin.y);
    expect(prepared.groundContact.x).toBe(expected.x - prepared.origin.x);
  });

  test('alpha cleanup removes sub-threshold fringe and hardens the matte', () => {
    const source = blankImage(32, 32);
    paintRect(source, { x: 8, y: 8, width: 16, height: 16 }, OPAQUE_LIGHT);
    // A fringe column below the cleanup floor...
    for (let y = 8; y < 24; y++) {
      paintRect(source, { x: 7, y, width: 1, height: 1 }, { r: 200, g: 200, b: 200, a: 10 });
    }
    // ...and a near-opaque edge that must be pulled fully opaque.
    for (let y = 8; y < 24; y++) {
      paintRect(source, { x: 24, y, width: 1, height: 1 }, { r: 200, g: 200, b: 200, a: 250 });
    }

    const prepared = prepareRgbaImage({ image: source, profile: profile('prop-native-alpha') });
    const alphas = new Set<number>();
    for (let y = 0; y < prepared.image.height; y++) {
      for (let x = 0; x < prepared.image.width; x++) {
        alphas.add(alphaAt(prepared.image, x, y));
      }
    }
    // 10 is below the 24 fringe floor and 250 is above the 230 matte ceiling,
    // so no partial alpha survives this fixture at all.
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  test('a soft edge between the two thresholds is preserved, not guessed away', () => {
    const source = blankImage(32, 32);
    paintRect(source, { x: 8, y: 8, width: 16, height: 16 }, OPAQUE_LIGHT);
    for (let y = 8; y < 24; y++) {
      paintRect(source, { x: 7, y, width: 1, height: 1 }, { r: 200, g: 200, b: 200, a: 128 });
    }
    const prepared = prepareRgbaImage({ image: source, profile: profile('prop-native-alpha') });
    let partial = 0;
    for (let y = 0; y < prepared.image.height; y++) {
      for (let x = 0; x < prepared.image.width; x++) {
        const alpha = alphaAt(prepared.image, x, y);
        if (alpha > 0 && alpha < 255) {
          partial += 1;
        }
      }
    }
    expect(partial).toBeGreaterThan(0);
  });
});

describe('C-520 AC-4: a state swap keeps its footprint', () => {
  test('two variants of the same base share canvas and ground contact', () => {
    const base = isolatedProp({ width: 64, height: 64, propWidth: 24, propHeight: 40 });
    // "Repaired" variant: same footprint, only the interior changes.
    const repaired = isolatedProp({ width: 64, height: 64, propWidth: 24, propHeight: 40 });
    paintRect(repaired, { x: 22, y: 20, width: 8, height: 8 }, { r: 120, g: 90, b: 60, a: 255 });

    const built = profile('prop-native-alpha');
    const first = prepareRgbaImage({ image: base, profile: built });
    const second = prepareRgbaImage({ image: repaired, profile: built });

    expect(second.image.width).toBe(first.image.width);
    expect(second.image.height).toBe(first.image.height);
    expect(second.groundContact).toEqual(first.groundContact);
    expect(bytesOf(second.image)).not.toBe(bytesOf(first.image));
  });
});

describe('C-520: profiles refuse to silently skip an operation', () => {
  test('registered profiles are deeply cloned and frozen snapshots', () => {
    const base = profile('prop-native-alpha');
    const qa = { ...base.qa };
    const registered = registerPreparationProfile({
      ...base,
      id: 'immutable-profile-fixture',
      operations: base.operations.map((operation) => ({ ...operation })),
      qa,
    });
    qa.minNativeScaleFeaturePx = 99;
    expect(registered.qa.minNativeScaleFeaturePx).toBe(base.qa.minNativeScaleFeaturePx);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.operations)).toBe(true);
    expect(Object.isFrozen(registered.operations[0])).toBe(true);
    expect(Object.isFrozen(registered.qa)).toBe(true);
  });

  test('a profile mixing in a set-level operation is refused by the kernel', () => {
    const withPack: PreparationProfile = {
      ...profile('prop-native-alpha'),
      id: 'packed-fixture',
      operations: [
        ...profile('prop-native-alpha').operations,
        { op: 'pack', paddingPx: 2, extrudePx: 1, maxPageSize: 2048 },
      ],
    };
    let thrown: unknown;
    try {
      prepareRgbaImage({ image: isolatedProp(), profile: withPack });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreparationProfileError);
    expect((thrown as PreparationProfileError).message).toContain('"pack"');
  });

  test('trimming an image with nothing opaque fails loudly', () => {
    let thrown: unknown;
    try {
      prepareRgbaImage({ image: blankImage(8, 8), profile: profile('prop-native-alpha') });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreparationProfileError);
    expect((thrown as PreparationProfileError).code).toBe(MEDIA_VALIDATION_CODES.alphaRequired);
  });

  test('every shipped profile passes its own determinism and operation checks', () => {
    const shippedProfiles = listPreparationProfiles();
    expect(shippedProfiles.length).toBeGreaterThan(0);
    for (const shipped of shippedProfiles) {
      const source =
        shipped.role === 'prop-sprite' && shipped.id === 'prop-full-alpha-ground'
          ? fullAlphaGroundProp()
          : isolatedProp();
      const prepared = prepareRgbaImage({ image: source, profile: shipped });
      expect(prepared.operations.length).toBe(shipped.operations.length);
      expect(checkPreparationDeterminism({ image: source, profile: shipped })).toEqual([]);
    }
  });
});
