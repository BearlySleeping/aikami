// packages/frontend/theme/src/lib/theme/theme_package_validation.ts
//
// C-529 — structural validation of a theme *package* (not just one token file).
//
// This is the shared half of the validator: the CLI feeds it a directory, and
// the client importer feeds it the entries of an unpacked archive. Both get the
// same verdict, so a package that the CLI accepts cannot be rejected by the
// installer for a structural reason.
//
// 🔴 The reader is the only thing that touches the outside world. Everything
// below is a pure function of the entries it returns, which is what makes the
// adversarial cases testable without a filesystem or an archive library.

import {
  THEME_API_MAJOR,
  THEME_API_VERSION,
  THEME_FONT_MEDIA_TYPE,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
  THEME_MAX_FONT_BYTES,
  THEME_MAX_FONT_FILES,
  THEME_MAX_MANIFEST_BYTES,
  THEME_MAX_PACKAGE_PATH_CHARS,
  THEME_MAX_RASTER_DIMENSION,
  THEME_MAX_RASTER_PIXELS,
  THEME_MAX_TOKENS_JSON_BYTES,
  THEME_VARIANTS,
} from '@aikami/constants';
import type { ThemePackageManifest, ThemeTokenFile } from '@aikami/schemas';
import { parseThemePackageManifest, parseThemeTokenFile } from '@aikami/schemas';
import type { ThemeValidationIssue } from '@aikami/types';
import {
  checkThemeContrast,
  compileThemeTokenFile,
  type ThemeDeclaration,
} from './theme_compiler.ts';
import { isSupportedRasterMediaType, readImageDimensions } from './theme_image.ts';

/** Raw bytes and metadata for one entry of a package. */
export type ThemePackageReader = {
  /** Raw text of the package manifest (`theme.json`), when the entry exists. */
  readonly manifestJson: string | undefined;
  /** Every entry path in the package, package-relative. */
  readonly entries: readonly string[];
  readonly readText: (path: string) => string | undefined;
  readonly readBytes: (path: string) => Uint8Array | undefined;
  /** Lowercase hex SHA-256 of an entry, when it can be computed. */
  readonly sha256: (path: string) => string | undefined;
};

/** A structural problem that stops the package from being installed. */
export type ThemePackageErrors = readonly ThemeValidationIssue[];

/** A problem that does not stop installation but must be shown to the creator. */
export type ThemePackageWarnings = readonly ThemeValidationIssue[];

/** Successful package validation. */
export type ThemePackageValidation = {
  readonly ok: boolean;
  readonly errors: ThemePackageErrors;
  readonly warnings: ThemePackageWarnings;
  readonly manifest?: ThemePackageManifest;
  readonly variants: Partial<Record<ThemeTokenFile['variant'], readonly ThemeDeclaration[]>>;
  /** Measured facts the caller may display (declared bytes, contrast, ...). */
  readonly report: readonly string[];
};

const error = (code: string, message: string, subject?: string): ThemeValidationIssue =>
  subject === undefined ? { code, message } : { code, message, subject };

/**
 * True when a path is canonical and package-relative.
 *
 * Rejects absolute paths, Windows separators, `.`/`..` segments, empty
 * segments and a trailing slash — the shapes used to escape a package root.
 */
export const isCanonicalPackagePath = (path: string): boolean => {
  if (path.length === 0 || path.length > THEME_MAX_PACKAGE_PATH_CHARS) {
    return false;
  }
  if (path.startsWith('/') || path.includes('\\') || path.endsWith('/')) {
    return false;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path);
};

/** Splits a version into comparable numbers. */
const parseVersion = (value: string): readonly [number, number, number] | undefined => {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
};

const compareVersions = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/**
 * Evaluates a manifest `themeApiRange` against the API version this build
 * implements.
 *
 * A deliberately small Aikami profile rather than full semver: `*`, `1.x`,
 * `^1.0`, `~1.0`, `>=1.0`, `>=1.0 <2.0` and a bare `1.0.0`. An unsupported
 * major is *refused*, never rendered best-effort.
 */
export const isThemeApiRangeSupported = (
  range: string,
  implemented: string = THEME_API_VERSION,
): boolean => {
  const implementedVersion = parseVersion(implemented);
  if (implementedVersion === undefined) {
    return false;
  }
  const trimmed = range.trim();
  if (trimmed === '*' || trimmed === 'x' || trimmed === 'X') {
    return true;
  }
  const comparators = trimmed.split(/\s+/).filter((part) => part.length > 0);
  if (comparators.length === 0 || comparators.length > 4) {
    return false;
  }
  for (const comparator of comparators) {
    if (!isComparatorSatisfied(comparator, implementedVersion)) {
      return false;
    }
  }
  return true;
};

const isComparatorSatisfied = (
  comparator: string,
  implemented: readonly [number, number, number],
): boolean => {
  if (comparator === '*' || comparator === 'x' || comparator === 'X') {
    return true;
  }
  const operatorMatch = /^(>=|<=|>|<|\^|~)?\s*(.+)$/.exec(comparator);
  if (operatorMatch === null) {
    return false;
  }
  const operator = operatorMatch[1] ?? '';
  const versionText = (operatorMatch[2] ?? '').trim();

  if (/^\d+\.(x|X|\*)$/.test(versionText)) {
    const major = Number(versionText.split('.')[0]);
    return implemented[0] === major;
  }
  if (/^\d+\.\d+\.(x|X|\*)$/.test(versionText)) {
    const [major, minor] = versionText.split('.').map(Number);
    return implemented[0] === major && implemented[1] === minor;
  }

  const version = parseVersion(versionText);
  if (version === undefined) {
    return false;
  }
  const delta = compareVersions(implemented, version);
  switch (operator) {
    case '>=':
      return delta >= 0;
    case '>':
      return delta > 0;
    case '<=':
      return delta <= 0;
    case '<':
      return delta < 0;
    case '^':
      return delta >= 0 && implemented[0] === version[0];
    case '~':
      return delta >= 0 && implemented[0] === version[0] && implemented[1] === version[1];
    default:
      // A bare version pins the major line; a theme API 1.x package keeps
      // working across Aikami's 1.x client releases.
      return implemented[0] === version[0];
  }
};

/** Media type implied by a path extension, for the slots this profile accepts. */
const impliedMediaTypes = (path: string): readonly string[] => {
  if (path.endsWith('.woff2')) {
    return [THEME_FONT_MEDIA_TYPE, 'application/font-woff2', 'application/octet-stream'];
  }
  if (path.endsWith('.png')) {
    return ['image/png'];
  }
  if (path.endsWith('.webp')) {
    return ['image/webp'];
  }
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return ['image/jpeg'];
  }
  if (path.endsWith('.json')) {
    return ['application/json', 'text/json'];
  }
  return [];
};

/**
 * Validates a whole theme package.
 *
 * Order of checks is deliberate: the manifest and its declared paths are
 * validated *before* any entry is read, so a hostile package cannot make the
 * validator read files it did not declare, and every read is bounded by a
 * declared or constant limit.
 */
export const validateThemePackage = (reader: ThemePackageReader): ThemePackageValidation => {
  const errors: ThemeValidationIssue[] = [];
  const warnings: ThemeValidationIssue[] = [];
  const report: string[] = [];
  const variants: Partial<Record<ThemeTokenFile['variant'], readonly ThemeDeclaration[]>> = {};

  const fail = (issue: ThemeValidationIssue): void => {
    errors.push(issue);
  };

  // ── 1. Manifest ──────────────────────────────────────────────────────────
  const manifestJson = reader.manifestJson;
  if (manifestJson === undefined) {
    return {
      ok: false,
      errors: [error('package.missing-manifest', 'This package has no theme.json manifest.')],
      warnings,
      variants,
      report,
    };
  }
  if (manifestJson.length > THEME_MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      errors: [
        error(
          'package.manifest-too-large',
          `The manifest is larger than the ${THEME_MAX_MANIFEST_BYTES} byte limit.`,
          'theme.json',
        ),
      ],
      warnings,
      variants,
      report,
    };
  }
  const manifest = parseThemePackageManifest(safeJsonParse(manifestJson));
  if (manifest === undefined) {
    return {
      ok: false,
      errors: [
        error(
          'package.invalid-manifest',
          'theme.json is not a valid Aikami theme manifest (bounded id, semver version, api range, author, licence and at least one variant are required).',
          'theme.json',
        ),
      ],
      warnings,
      variants,
      report,
    };
  }

  // ── 2. API compatibility ─────────────────────────────────────────────────
  if (!isThemeApiRangeSupported(manifest.themeApiRange)) {
    fail(
      error(
        'package.unsupported-api',
        `This theme requires theme API "${manifest.themeApiRange}" but this client implements ${THEME_API_VERSION}. It will not be rendered.`,
        'themeApiRange',
      ),
    );
  }

  // ── 3. Entry budget ──────────────────────────────────────────────────────
  const entries = reader.entries;
  if (entries.length > THEME_MAX_ENTRIES) {
    fail(
      error(
        'package.too-many-entries',
        `The package contains ${entries.length} entries; the limit is ${THEME_MAX_ENTRIES}.`,
      ),
    );
  }
  const entrySet = new Set(entries.map((entry) => entry.toLowerCase()));
  report.push(`entries: ${entries.length}`);

  // ── 4. Declared paths must be canonical and present ──────────────────────
  const declaredPaths = [
    ...Object.values(manifest.variants).filter((path): path is string => path !== undefined),
    ...manifest.assets.map((asset) => asset.path),
    ...(manifest.preview === undefined ? [] : [manifest.preview]),
    ...(manifest.hudPreset === undefined ? [] : [manifest.hudPreset]),
  ];
  for (const path of declaredPaths) {
    if (!isCanonicalPackagePath(path)) {
      fail(
        error(
          'package.invalid-path',
          `"${path}" is not a canonical package-relative path. Absolute paths, traversal and backslashes are rejected.`,
          path,
        ),
      );
      continue;
    }
    if (!entrySet.has(path.toLowerCase())) {
      fail(
        error(
          'package.missing-entry',
          `"${path}" is declared but not present in the package.`,
          path,
        ),
      );
    }
  }

  // ── 5. Every entry must be declared ──────────────────────────────────────
  const declaredSet = new Set(['theme.json', ...declaredPaths].map((path) => path.toLowerCase()));
  for (const entry of entries) {
    if (!declaredSet.has(entry.toLowerCase())) {
      fail(
        error(
          'package.undeclared-entry',
          `"${entry}" is present but not declared by the manifest. Every entry must be manifest-listed.`,
          entry,
        ),
      );
    }
  }

  // ── 6. Variants ──────────────────────────────────────────────────────────
  const variantPaths = THEME_VARIANTS.flatMap((variant) => {
    const path = manifest.variants[variant];
    return path === undefined ? [] : [{ variant, path }];
  });
  if (variantPaths.length === 0) {
    fail(error('package.no-variant', 'The manifest declares no usable variant.'));
  }

  let tokenBytes = 0;
  for (const { variant, path } of variantPaths) {
    if (!isCanonicalPackagePath(path) || !entrySet.has(path.toLowerCase())) {
      continue;
    }
    const text = reader.readText(path);
    if (text === undefined) {
      fail(error('package.unreadable-entry', `"${path}" could not be read.`, path));
      continue;
    }
    tokenBytes += text.length;
    if (tokenBytes > THEME_MAX_TOKENS_JSON_BYTES) {
      fail(
        error(
          'package.tokens-too-large',
          `The token files together exceed the ${THEME_MAX_TOKENS_JSON_BYTES} byte limit.`,
        ),
      );
      break;
    }
    const file = parseThemeTokenFile(safeJsonParse(text));
    if (file === undefined) {
      fail(error('package.invalid-tokens', `"${path}" is not a valid Aikami token file.`, path));
      continue;
    }
    if (file.variant !== variant) {
      fail(
        error(
          'package.variant-mismatch',
          `"${path}" declares variant "${file.variant}" but the manifest lists it as "${variant}".`,
          path,
        ),
      );
      continue;
    }
    const compilation = compileThemeTokenFile(file);
    if (!compilation.ok) {
      for (const issue of compilation.issues) {
        fail({ ...issue, subject: issue.subject ?? path });
      }
      continue;
    }
    variants[variant] = compilation.declarations;
    for (const issue of checkThemeContrast(compilation.declarations)) {
      warnings.push({ ...issue, subject: `${path} · ${issue.subject ?? ''}`.trim() });
    }
  }
  report.push(`token bytes: ${tokenBytes}`);

  // ── 7. Assets ────────────────────────────────────────────────────────────
  let expandedBytes = 0;
  let rasterPixels = 0;
  let fontCount = 0;

  for (const asset of manifest.assets) {
    if (!isCanonicalPackagePath(asset.path) || !entrySet.has(asset.path.toLowerCase())) {
      continue;
    }
    expandedBytes += asset.bytes;
    if (expandedBytes > THEME_MAX_EXPANDED_BYTES) {
      fail(
        error(
          'package.too-large',
          `The declared assets exceed the ${THEME_MAX_EXPANDED_BYTES} byte expanded limit.`,
        ),
      );
      break;
    }

    const allowedTypes = impliedMediaTypes(asset.path);
    if (allowedTypes.length === 0 || !allowedTypes.includes(asset.mediaType)) {
      fail(
        error(
          'package.media-type-mismatch',
          `"${asset.path}" declares media type "${asset.mediaType}", which does not match its extension.`,
          asset.path,
        ),
      );
      continue;
    }

    const bytes = reader.readBytes(asset.path);
    if (bytes === undefined) {
      fail(error('package.unreadable-entry', `"${asset.path}" could not be read.`, asset.path));
      continue;
    }
    if (bytes.byteLength !== asset.bytes) {
      fail(
        error(
          'package.asset-size-mismatch',
          `"${asset.path}" is ${bytes.byteLength} bytes but the manifest declares ${asset.bytes}.`,
          asset.path,
        ),
      );
      continue;
    }
    const digest = reader.sha256(asset.path);
    if (digest !== asset.sha256) {
      fail(
        error(
          'package.asset-hash-mismatch',
          `"${asset.path}" does not match its declared SHA-256. The package is corrupt or was modified.`,
          asset.path,
        ),
      );
      continue;
    }

    if (asset.path.toLowerCase().endsWith('.woff2')) {
      fontCount += 1;
      if (fontCount > THEME_MAX_FONT_FILES) {
        fail(
          error(
            'package.too-many-fonts',
            `A theme may ship at most ${THEME_MAX_FONT_FILES} font files.`,
            asset.path,
          ),
        );
      }
      if (bytes.byteLength > THEME_MAX_FONT_BYTES) {
        fail(
          error(
            'package.font-too-large',
            `"${asset.path}" is larger than the ${THEME_MAX_FONT_BYTES} byte font limit.`,
            asset.path,
          ),
        );
      }
      if (!matchesAscii(bytes, 0, 'wOF2')) {
        fail(
          error(
            'package.invalid-font',
            `"${asset.path}" is not a valid WOFF2 file (bad signature).`,
            asset.path,
          ),
        );
      }
      continue;
    }

    if (isSupportedRasterMediaType(asset.mediaType)) {
      const dimensions = readImageDimensions(bytes);
      if (dimensions === undefined) {
        fail(
          error(
            'package.invalid-raster',
            `"${asset.path}" has an unreadable ${asset.mediaType} header.`,
            asset.path,
          ),
        );
        continue;
      }
      if (
        dimensions.width > THEME_MAX_RASTER_DIMENSION ||
        dimensions.height > THEME_MAX_RASTER_DIMENSION
      ) {
        fail(
          error(
            'package.raster-too-large',
            `"${asset.path}" is ${dimensions.width}×${dimensions.height}; the limit is ${THEME_MAX_RASTER_DIMENSION}×${THEME_MAX_RASTER_DIMENSION}.`,
            asset.path,
          ),
        );
        continue;
      }
      rasterPixels += dimensions.width * dimensions.height;
      if (rasterPixels > THEME_MAX_RASTER_PIXELS) {
        fail(
          error(
            'package.too-many-pixels',
            `The decoded raster total exceeds the ${THEME_MAX_RASTER_PIXELS} pixel limit.`,
            asset.path,
          ),
        );
        continue;
      }
      report.push(`raster ${asset.path}: ${dimensions.width}×${dimensions.height}`);
    }
  }
  report.push(`expanded bytes: ${expandedBytes}`, `decoded pixels: ${rasterPixels}`);

  // ── 8. Preview ───────────────────────────────────────────────────────────
  if (manifest.preview !== undefined) {
    const previewAsset = manifest.assets.find((asset) => asset.path === manifest.preview);
    if (previewAsset === undefined) {
      fail(
        error(
          'package.undeclared-preview',
          `The preview image "${manifest.preview}" must also be listed in assets.`,
          manifest.preview,
        ),
      );
    } else if (!isSupportedRasterMediaType(previewAsset.mediaType)) {
      fail(
        error(
          'package.invalid-preview',
          'The preview must be a PNG, WebP or JPEG raster.',
          manifest.preview,
        ),
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    variants,
    report,
  };
};

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const matchesAscii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
};

/** The API major this build implements — re-exported for CLI reporting. */
export const THEME_IMPLEMENTED_API_MAJOR = THEME_API_MAJOR;
