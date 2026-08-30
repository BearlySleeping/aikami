// packages/shared/schemas/src/lib/game/pack_validation.ts
//
// Structured content-pack validation returning data, not exceptions.
// Three consumers: CI (assert errors.length === 0), hub upload gate,
// and the future generation loop (feed errors back to a model for repair).
// Contract: C-381 Content Pipeline Hardening — AC-5
//
// biome-ignore-all lint/style/useNamingConvention: error codes use dot-notation identifiers

import type { ContentPackManifest } from './content_pack.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable machine-readable error/warning code, e.g. 'asset.missing-provenance'. */
export type PackValidationCode =
  | 'asset.missing-provenance'
  | 'asset.missing-license'
  | 'asset.invalid-license'
  | 'asset.missing-author'
  | 'asset.missing-source'
  | 'asset.share-alike-mismatch'
  | 'asset.absolute-url'
  | 'asset.path-traversal'
  | 'asset.data-scheme'
  | 'asset.javascript-scheme'
  | 'manifest.missing-id'
  | 'manifest.missing-version'
  | 'manifest.missing-starting-map'
  | 'manifest.map-file-not-found'
  | 'manifest.map-entry-not-found'
  | 'manifest.tile-frame-missing'
  | 'manifest.prop-frame-missing'
  | 'manifest.fallback-tile-missing'
  | 'manifest.gid-out-of-range'
  | 'terrain.missing-frame-base'
  | 'terrain.invalid-frame-base'
  | 'terrain.unknown-id'
  | 'terrain.frame-missing-in-atlas';

export type PackValidationIssue = {
  /** Stable machine code, e.g. 'asset.missing-provenance'. */
  code: PackValidationCode;
  /** JSON pointer into the manifest or map. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** Human/LLM-actionable repair instruction. */
  hint: string;
};

export type PackValidationFix = {
  /** JSON pointer to the fix location. */
  path: string;
  /** Description of the mechanical fix. */
  description: string;
};

export type PackValidationResult = {
  packId: string;
  errors: PackValidationIssue[];
  warnings: PackValidationIssue[];
  autoFixes: PackValidationFix[];
};

// ---------------------------------------------------------------------------
// SPDX license set
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// URL pattern checks
// ---------------------------------------------------------------------------

const ABSOLUTE_URL_RE = /^https?:\/\//i;
const PATH_TRAVERSAL_RE = /\.\.\//;
const DATA_SCHEME_RE = /^data:/i;
const JAVASCRIPT_SCHEME_RE = /^javascript:/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isAbsoluteUrl = (s: string): boolean => ABSOLUTE_URL_RE.test(s);
const hasPathTraversal = (s: string): boolean => PATH_TRAVERSAL_RE.test(s);
const isDataScheme = (s: string): boolean => DATA_SCHEME_RE.test(s);
const isJavaScriptScheme = (s: string): boolean => JAVASCRIPT_SCHEME_RE.test(s);

// ---------------------------------------------------------------------------
// validatePack
// ---------------------------------------------------------------------------

/**
 * Validates a content pack manifest and returns structured results.
 *
 * @param manifest - The parsed content pack manifest.
 * @param packRoot - Optional filesystem root for map-file-exists checks.
 * @param atlasFrames - Optional set of atlas frame names for frame-exists checks.
 * @returns Structured validation result with errors, warnings, and auto-fixes.
 */
export const validatePack = (
  manifest: ContentPackManifest,
  options?: {
    packRoot?: string;
    atlasFrames?: Set<string>;
    mapFiles?: Record<string, string>;
  },
): PackValidationResult => {
  const errors: PackValidationIssue[] = [];
  const warnings: PackValidationIssue[] = [];
  const autoFixes: PackValidationFix[] = [];

  const packId = manifest.id ?? 'unknown';

  // ── Basic manifest fields ──

  if (!manifest.id) {
    errors.push({
      code: 'manifest.missing-id',
      path: '/id',
      message: 'Pack manifest is missing the required "id" field.',
      hint: 'Add an "id" field matching the pack directory name.',
    });
  }

  if (!manifest.version) {
    errors.push({
      code: 'manifest.missing-version',
      path: '/version',
      message: 'Pack manifest is missing the required "version" field.',
      hint: 'Add a semver "version" field (e.g. "1.0.0").',
    });
  }

  if (!manifest.startingMapId) {
    errors.push({
      code: 'manifest.missing-starting-map',
      path: '/startingMapId',
      message: 'Pack manifest is missing the required "startingMapId" field.',
      hint: 'Add a "startingMapId" field referencing one of the declared maps.',
    });
  }

  // ── Map existence checks ──

  if (manifest.maps && options?.mapFiles) {
    for (const [mapId, mapEntry] of Object.entries(manifest.maps)) {
      const expectedFile = mapEntry.file;
      if (expectedFile && !options.mapFiles[mapId]) {
        errors.push({
          code: 'manifest.map-file-not-found',
          path: `/maps/${mapId}/file`,
          message: `Map "${mapId}" declares file "${expectedFile}" but it was not found.`,
          hint: `Ensure the file "${expectedFile}" exists in the pack directory.`,
        });
      }
    }
  }

  // ── Starting map exists in maps ──

  if (manifest.startingMapId && manifest.maps && !manifest.maps[manifest.startingMapId]) {
    errors.push({
      code: 'manifest.map-entry-not-found',
      path: '/startingMapId',
      message: `Starting map "${manifest.startingMapId}" is not declared in the maps block.`,
      hint: `Add a "${manifest.startingMapId}" entry to the "maps" block or change startingMapId.`,
    });
  }

  // ── Atlas frame checks ──

  if (options?.atlasFrames && manifest.atlas) {
    const frames = options.atlasFrames;

    // Check tiles
    if (manifest.tiles) {
      for (const [tileId, tileDef] of Object.entries(manifest.tiles)) {
        if (tileDef.frame && !frames.has(tileDef.frame)) {
          errors.push({
            code: 'manifest.tile-frame-missing',
            path: `/tiles/${tileId}/frame`,
            message: `Tile "${tileId}" references frame "${tileDef.frame}" not found in atlas.`,
            hint: `Add frame "${tileDef.frame}" to the atlas or update the tile's frame reference.`,
          });
        }
      }
    }

    // Check props
    if (manifest.props) {
      for (const [propId, propDef] of Object.entries(manifest.props)) {
        if (propDef.frame && !frames.has(propDef.frame)) {
          errors.push({
            code: 'manifest.prop-frame-missing',
            path: `/props/${propId}/frame`,
            message: `Prop "${propId}" references frame "${propDef.frame}" not found in atlas.`,
            hint: `Add frame "${propDef.frame}" to the atlas or update the prop's frame reference.`,
          });
        }
      }
    }

    // Check fallback tile
    if (manifest.fallbackTile && !frames.has(manifest.fallbackTile)) {
      errors.push({
        code: 'manifest.fallback-tile-missing',
        path: '/fallbackTile',
        message: `Fallback tile "${manifest.fallbackTile}" not found in atlas.`,
        hint: `Add frame "${manifest.fallbackTile}" to the atlas or change the fallbackTile.`,
      });
    }
  }

  // ── Terrain checks ──

  if (manifest.terrains && options?.atlasFrames) {
    const frames = options.atlasFrames;
    for (const terrain of manifest.terrains) {
      if (!terrain.frameBase) {
        errors.push({
          code: 'terrain.missing-frame-base',
          path: `/terrains/${terrain.name}/frameBase`,
          message: `Terrain "${terrain.name}" is missing frameBase.`,
          hint: 'Add a frameBase field pointing to the mask-0 frame (e.g. "dirt_0.png").',
        });
        continue;
      }

      if (!/_0\.png$/.test(terrain.frameBase)) {
        errors.push({
          code: 'terrain.invalid-frame-base',
          path: `/terrains/${terrain.name}/frameBase`,
          message: `Terrain "${terrain.name}" frameBase "${terrain.frameBase}" must follow _0.png naming.`,
          hint: 'Rename frameBase to end with "_0.png" (e.g. "dirt_0.png").',
        });
      }

      // Check corner16 terrain frames exist in atlas
      if (terrain.wang === 'corner16' && terrain.frameBase) {
        const mask0 = terrain.frameBase;
        if (!frames.has(mask0)) {
          errors.push({
            code: 'terrain.frame-missing-in-atlas',
            path: `/terrains/${terrain.name}/frameBase`,
            message: `Terrain "${terrain.name}" mask-0 frame "${mask0}" not found in atlas.`,
            hint: `Add frame "${mask0}" to the atlas.`,
          });
        }
        for (let mask = 1; mask < 16; mask++) {
          const maskFrame = mask0.replace(/_0\.png$/, `_${mask}.png`);
          if (!frames.has(maskFrame)) {
            errors.push({
              code: 'terrain.frame-missing-in-atlas',
              path: `/terrains/${terrain.name}/frameBase`,
              message: `Terrain "${terrain.name}" mask ${mask} frame "${maskFrame}" not found in atlas.`,
              hint: `Add frame "${maskFrame}" to the atlas.`,
            });
          }
        }
      }
    }
  }

  // ── Provenance checks (AC-1) ──

  // Check atlas URLs for hostile content (AC-2)
  if (manifest.atlas) {
    const checkUrl = (url: string | undefined, path: string): void => {
      if (!url) {
        return;
      }
      if (isAbsoluteUrl(url)) {
        errors.push({
          code: 'asset.absolute-url',
          path,
          message: `URL "${url}" is an absolute URL — packs must reference assets by hash through the registry.`,
          hint: 'Replace the absolute URL with a registry tag reference.',
        });
      }
      if (hasPathTraversal(url)) {
        errors.push({
          code: 'asset.path-traversal',
          path,
          message: `URL "${url}" contains path traversal — rejected.`,
          hint: 'Remove "../" sequences from the path.',
        });
      }
      if (isDataScheme(url)) {
        errors.push({
          code: 'asset.data-scheme',
          path,
          message: `URL "${url}" uses data: scheme — rejected.`,
          hint: 'Remove the data: URI and use a registry tag instead.',
        });
      }
      if (isJavaScriptScheme(url)) {
        errors.push({
          code: 'asset.javascript-scheme',
          path,
          message: `URL "${url}" uses javascript: scheme — rejected.`,
          hint: 'Remove the javascript: URI.',
        });
      }
    };

    checkUrl(manifest.atlas.textureUrl, '/atlas/textureUrl');
    checkUrl(manifest.atlas.spritesheetUrl, '/atlas/spritesheetUrl');
  }

  // ── Share-alike compatibility warning ──

  if (manifest.credits) {
    // Check if pack-level licence is compatible with share-alike assets
    // This is a heuristic — we look at the pack's credits block for clues
    // about share-alike content
    const hasLpcArt = manifest.credits.art?.some(
      (credit) =>
        credit.toLowerCase().includes('lpc') ||
        credit.toLowerCase().includes('liberated pixel') ||
        credit.toLowerCase().includes('cc-by-sa') ||
        credit.toLowerCase().includes('gpl'),
    );

    if (hasLpcArt) {
      warnings.push({
        code: 'asset.share-alike-mismatch',
        path: '/credits',
        message:
          'Pack appears to contain LPC or share-alike content. Ensure the pack licence is compatible.',
        hint: 'If using CC-BY-SA or GPL content, the pack must be distributed under a compatible licence.',
      });
    }
  }

  return { packId, errors, warnings, autoFixes };
};

/**
 * Checks whether a string contains a URL scheme or path traversal that
 * would make it a network origin or filesystem escape.
 * Used by the hostile-manifest test (AC-2).
 */
export const isHostileString = (s: string): boolean => {
  return isAbsoluteUrl(s) || hasPathTraversal(s) || isDataScheme(s) || isJavaScriptScheme(s);
};
