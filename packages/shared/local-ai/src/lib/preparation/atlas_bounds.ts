// packages/shared/local-ai/src/lib/preparation/atlas_bounds.ts
//
// C-520 (AC-6): atlas page bounds, capacity and frame-resolution validation.
//
// The packer already emits pages; this module answers the questions a packer
// run cannot answer about itself:
//
//   * Does every frame fit inside its page, with the declared padding?
//   * Does a page exceed the texture-size budget on either axis?
//   * Does the frame namespace stay unique across pages?
//   * Does every frame a map references actually resolve?
//   * Has terrain capacity overrun its explicit cell budget?
//
// Capacity overflow must fail *visibly*: the shipped Emberwatch terrain atlas
// has one free frame (16x11 = 176 cells), so another append or a new corner-16
// terrain is an explicit capacity change, never a silent dropped cell.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { ATLAS_VALIDATION_CODES, type AtlasValidationCode } from '@aikami/constants';

/** One packed frame's bounds inside its page. */
export type AtlasFrame = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** One packed page. */
export type AtlasPage = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasFrame[];
};

/** One refused invariant, with the stable code a caller branches on. */
export type AtlasValidationIssue = {
  readonly code: AtlasValidationCode;
  readonly message: string;
  readonly page?: string;
  readonly frame?: string;
};

/**
 * Validates packed pages against the profile's padding, extrusion and page
 * budget.
 *
 * @returns every issue found, not only the first.
 */
export const validateAtlasPages = (options: {
  pages: readonly AtlasPage[];
  maxPageSize: number;
  paddingPx: number;
  extrudePx: number;
  /** Optional explicit cell capacity, e.g. the terrain grid's 176 cells. */
  capacityCells?: number;
  /** Frames the packer intended to emit, per page name. */
  expectedFrameCounts?: Readonly<Record<string, number>>;
}): readonly AtlasValidationIssue[] => {
  const issues: AtlasValidationIssue[] = [];
  const seenNames = new Map<string, string>();
  const observedPages = new Set<string>();

  for (const page of options.pages) {
    observedPages.add(page.name);
    if (page.width > options.maxPageSize || page.height > options.maxPageSize) {
      issues.push({
        code: ATLAS_VALIDATION_CODES.capacityOverflow,
        message: `Page "${page.name}" is ${page.width}x${page.height}, above the ${options.maxPageSize}px-per-axis budget`,
        page: page.name,
      });
    }

    for (const frame of page.frames) {
      const previousPage = seenNames.get(frame.name);
      if (previousPage !== undefined) {
        issues.push({
          code: ATLAS_VALIDATION_CODES.duplicateFrameName,
          message: `Frame "${frame.name}" appears on both "${previousPage}" and "${page.name}" — the runtime namespace is flat, so a duplicate has no defined winner`,
          page: page.name,
          frame: frame.name,
        });
      } else {
        seenNames.set(frame.name, page.name);
      }

      if (frame.width > options.maxPageSize || frame.height > options.maxPageSize) {
        issues.push({
          code: ATLAS_VALIDATION_CODES.frameExceedsPage,
          message: `Frame "${frame.name}" is ${frame.width}x${frame.height}, larger than the ${options.maxPageSize}px page budget on at least one axis — it can never be packed, and must fail rather than be clipped`,
          page: page.name,
          frame: frame.name,
        });
      }

      const right = frame.x + frame.width;
      const bottom = frame.y + frame.height;
      if (frame.x < options.extrudePx || frame.y < options.extrudePx) {
        issues.push({
          code: ATLAS_VALIDATION_CODES.invalidPadding,
          message: `Frame "${frame.name}" starts at ${frame.x},${frame.y}, closer to the page edge than the ${options.extrudePx}px extruded border requires`,
          page: page.name,
          frame: frame.name,
        });
      } else if (
        right > page.width - options.extrudePx ||
        bottom > page.height - options.extrudePx
      ) {
        issues.push({
          code: ATLAS_VALIDATION_CODES.frameOutOfPageBounds,
          message: `Frame "${frame.name}" ends at ${right},${bottom} with no room for its ${options.extrudePx}px extruded border inside the ${page.width}x${page.height} page`,
          page: page.name,
          frame: frame.name,
        });
      }
    }

    const requiredSeparation = options.paddingPx + options.extrudePx * 2;
    for (let firstIndex = 0; firstIndex < page.frames.length; firstIndex++) {
      const first = page.frames[firstIndex];
      if (!first) {
        continue;
      }
      for (let secondIndex = firstIndex + 1; secondIndex < page.frames.length; secondIndex++) {
        const second = page.frames[secondIndex];
        if (!second) {
          continue;
        }
        const horizontalGap = Math.max(
          second.x - (first.x + first.width),
          first.x - (second.x + second.width),
        );
        const verticalGap = Math.max(
          second.y - (first.y + first.height),
          first.y - (second.y + second.height),
        );
        if (horizontalGap < requiredSeparation && verticalGap < requiredSeparation) {
          issues.push({
            code: ATLAS_VALIDATION_CODES.invalidPadding,
            message: `Frames "${first.name}" and "${second.name}" have less than ${options.paddingPx}px padding between their ${options.extrudePx}px extruded borders`,
            page: page.name,
            frame: second.name,
          });
        }
      }
    }

    const expected = options.expectedFrameCounts?.[page.name];
    if (expected !== undefined && expected !== page.frames.length) {
      issues.push({
        code: ATLAS_VALIDATION_CODES.capacityOverflow,
        message: `Page "${page.name}" carries ${page.frames.length} frame(s) but ${expected} were expected — a silent drop is exactly what the capacity gate exists to prevent`,
        page: page.name,
      });
    }
  }

  for (const [pageName, expected] of Object.entries(options.expectedFrameCounts ?? {})) {
    if (expected > 0 && !observedPages.has(pageName)) {
      issues.push({
        code: ATLAS_VALIDATION_CODES.capacityOverflow,
        message: `Page "${pageName}" is absent but ${expected} frame(s) were expected — a silent drop is exactly what the capacity gate exists to prevent`,
        page: pageName,
      });
    }
  }

  if (options.capacityCells !== undefined) {
    const used = options.pages.reduce((total, page) => total + page.frames.length, 0);
    if (used > options.capacityCells) {
      issues.push({
        code: ATLAS_VALIDATION_CODES.capacityOverflow,
        message: `${used} frame(s) target a capacity of ${options.capacityCells} — terrain capacity is explicit, so an overrun fails visibly instead of evicting a cell`,
      });
    }
  }

  return issues;
};

/** The flat frame → page index a runtime resolver needs. */
export type AtlasFrameIndex = ReadonlyMap<string, { page: string; frame: AtlasFrame }>;

/** Builds the flat frame index, last-write-wins is impossible because duplicates are rejected upstream. */
export const buildAtlasFrameIndex = (pages: readonly AtlasPage[]): AtlasFrameIndex => {
  const index = new Map<string, { page: string; frame: AtlasFrame }>();
  for (const page of pages) {
    for (const frame of page.frames) {
      if (!index.has(frame.name)) {
        index.set(frame.name, { page: page.name, frame });
      }
    }
  }
  return index;
};

/**
 * Confirms that every semantic frame a map or prop definition references
 * resolves to a packed frame.
 *
 * A missing frame degrades to a fallback tile at runtime, which is precisely
 * why the build must fail instead: a map that silently paints the wrong prop
 * looks like a rendering bug forever.
 */
export const findUnresolvedFrameReferences = (options: {
  index: AtlasFrameIndex;
  referenced: readonly string[];
}): readonly string[] => options.referenced.filter((name) => !options.index.has(name));

/**
 * Validates the pages and the references in one call, returning every issue.
 */
export const validateAtlas = (options: {
  pages: readonly AtlasPage[];
  maxPageSize: number;
  paddingPx: number;
  extrudePx: number;
  capacityCells?: number;
  expectedFrameCounts?: Readonly<Record<string, number>>;
  referencedFrames?: readonly string[];
}): readonly AtlasValidationIssue[] => {
  const issues = [
    ...validateAtlasPages({
      pages: options.pages,
      maxPageSize: options.maxPageSize,
      paddingPx: options.paddingPx,
      extrudePx: options.extrudePx,
      ...(options.capacityCells === undefined ? {} : { capacityCells: options.capacityCells }),
      ...(options.expectedFrameCounts === undefined
        ? {}
        : { expectedFrameCounts: options.expectedFrameCounts }),
    }),
  ];

  if (options.referencedFrames) {
    const index = buildAtlasFrameIndex(options.pages);
    for (const name of findUnresolvedFrameReferences({
      index,
      referenced: options.referencedFrames,
    })) {
      issues.push({
        code: ATLAS_VALIDATION_CODES.missingFrame,
        message: `The referenced frame "${name}" is absent from every packed page`,
        frame: name,
      });
    }
  }

  return issues;
};
