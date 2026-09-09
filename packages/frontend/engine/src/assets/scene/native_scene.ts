// packages/frontend/engine/src/assets/scene/native_scene.ts
//
// C-505 — Native scene import/export, canonical hashing and future-format
// rejection.
//
// This module is the boundary that decides what is an *implemented map*
// versus a *future authoring format*. Only `aikami.scene` documents are
// accepted; `aikami.region`/`aikami.biome`/`aikami.house` (and anything else)
// are reported as an unsupported authoring format rather than a blank map,
// guessed forest or generic legacy fallback (AC-7).

import { SCENE_FUTURE_DOCUMENT_KINDS, SCENE_MAX_DECODED_BYTES } from '@aikami/constants';
import { type SceneDocument, SceneDocumentSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import { type ScenePackReference, SceneValidationError, validateScene } from './scene_validator.ts';

/** Thrown when a document is a valid future authoring format, not a map. */
export class SceneUnsupportedFormatError extends Error {
  /** The future authoring document kind that was submitted. */
  readonly format: string;

  constructor(format: string) {
    super(
      `Unsupported authoring format "${format}". The implemented scene format is ` +
        '"aikami.scene"; region/biome/house authoring is documented but not yet compiled. ' +
        'No map was produced.',
    );
    this.name = 'SceneUnsupportedFormatError';
    this.format = format;
  }
}

/** Thrown when the decoded map buffer exceeds safety limits (AC-6). */
export class SceneBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneBudgetError';
  }
}

/**
 * Parses a native scene document from untrusted JSON bytes.
 *
 * 1. Bounds the decoded buffer (AC-6 budget) BEFORE parsing.
 * 2. Reads the document kind and rejects future authoring kinds (AC-7).
 * 3. Validates the wire shape via the TypeBox schema.
 * 4. Runs the strict semantic validator (grid lengths, limits, ownership).
 *
 * @param json - Raw UTF-8 bytes or already-parsed object.
 * @param options - Optional pack reference for strict reference validation.
 * @returns The validated canonical scene document.
 */
export const parseNativeScene = (
  json: string | unknown,
  options?: { pack?: ScenePackReference },
): SceneDocument => {
  // ── Bounded decode (AC-6) ─────────────────────────────────────────────
  let raw: unknown;
  if (typeof json === 'string') {
    const bytes = new TextEncoder().encode(json);
    if (bytes.byteLength > SCENE_MAX_DECODED_BYTES) {
      throw new SceneBudgetError(
        `scene document exceeds SCENE_MAX_DECODED_BYTES (${bytes.byteLength} > ${SCENE_MAX_DECODED_BYTES})`,
      );
    }
    try {
      raw = JSON.parse(json);
    } catch (err) {
      throw new SceneValidationError(
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        'native scene',
      );
    }
  } else {
    raw = json;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SceneValidationError('document root must be an object', 'native scene');
  }

  // ── Future authoring format rejection (AC-7) ──────────────────────────
  const kind = (raw as { kind?: unknown }).kind;
  if (
    typeof kind === 'string' &&
    (SCENE_FUTURE_DOCUMENT_KINDS as readonly string[]).includes(kind)
  ) {
    throw new SceneUnsupportedFormatError(kind);
  }

  // ── Wire-shape validation ─────────────────────────────────────────────
  if (!Value.Check(SceneDocumentSchema, raw)) {
    const errors = Value.Errors(SceneDocumentSchema, raw);
    const detail = errors.length > 0 ? errors.map((e) => e.message).join('; ') : 'schema mismatch';
    throw new SceneValidationError(`invalid scene document — ${detail}`, 'native scene');
  }

  const doc = raw as SceneDocument;

  // ── Strict semantic validation ────────────────────────────────────────
  return validateScene(doc, options);
};

/**
 * Serializes a scene document to canonical JSON.
 *
 * Object member ordering can never change the revision (object keys are
 * sorted); ordered animation/layer/placement lists retain their meaningful
 * order. Reordering independent placements is canonicalized by stable id
 * (the array order is preserved, but identity is by id — AC-6).
 */
export const serializeScene = (doc: SceneDocument): string =>
  `${JSON.stringify(_canonicalize(doc), null, 2)}\n`;

/**
 * Computes the canonical sha-256 hex hash of a scene document.
 *
 * Deterministic: identical source + asset lock + adapter version produce
 * identical canonical data; reordering independent object members cannot
 * change the revision (AC-6).
 */
export const canonicalSceneHash = async (doc: SceneDocument): Promise<string> => {
  const canonical = JSON.stringify(_canonicalize(doc));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Deep-canonicalizes a value: object keys sorted, arrays/order preserved. */
const _canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(_canonicalize);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = _canonicalize(record[key]);
    }
    return out;
  }
  return value;
};

/**
 * Fetches and parses a native scene by URL through the asset registry.
 *
 * Mirrors the existing loader boundary conventions (C-434 registry-backed
 * resolution) so installed compiled scenes work offline (no fetch → bundled
 * fallback).
 */
export const loadNativeScene = async (options: {
  url: string;
  resolveTag?: (tag: string) => string | null;
  fetch?: typeof fetch;
  pack?: ScenePackReference;
}): Promise<SceneDocument> => {
  const { url, resolveTag, fetch: fetcher, pack } = options;
  const resolvedUrl = resolveTag ? (resolveTag(url) ?? url) : url;
  const f = fetcher ?? globalThis.fetch;
  const response = await f(resolvedUrl);
  if (!response.ok) {
    logger.warn('nativeScene:fetch-failed', { url, resolvedUrl, status: response.status });
    if (resolvedUrl !== url) {
      const fallback = await (fetcher ?? globalThis.fetch)(url);
      if (!fallback.ok) {
        throw new SceneValidationError(
          `failed to fetch native scene "${url}" (HTTP ${fallback.status})`,
          'native scene',
        );
      }
      return parseNativeScene(await fallback.text(), { pack });
    }
    throw new SceneValidationError(
      `failed to fetch native scene "${url}" (HTTP ${response.status})`,
      'native scene',
    );
  }
  return parseNativeScene(await response.text(), { pack });
};
