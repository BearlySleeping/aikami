// packages/shared/schemas/src/lib/game/community_map.ts
//
// C-508 — Community map publishing wire shapes + document gate.
//
// The curated catalog is a CI-owned static R2 index. Creators publish maps
// into a hub-served community namespace instead: metadata in D1, the document
// uploaded to the catalog bucket, and an immutable revision recorded. This
// module owns the HTTP shapes and a pure, dependency-free document gate so the
// Worker can validate a submission without importing the PixiJS-bearing
// engine. Full pack provenance still runs through `validatePack` (C-381) when
// the client supplies the source pack context.

import { SCENE_DOCUMENT_KIND, SCENE_SCHEMA_VERSION } from '@aikami/constants';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { type SceneDocument, SceneDocumentSchema } from './scene.ts';

/** Longest accepted community-map title (characters). */
export const COMMUNITY_MAP_TITLE_MAX_LENGTH = 120;

/** Largest accepted community-map document (bytes of UTF-8 JSON). */
export const COMMUNITY_MAP_DOCUMENT_MAX_BYTES = 1024 * 1024;

/** A published community map without its document, for listings. */
export const CommunityMapSummarySchema = Type.Object({
  slug: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: COMMUNITY_MAP_TITLE_MAX_LENGTH }),
  revision: Type.Integer({ minimum: 1 }),
  documentHash: Type.String({ minLength: 1 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
/** Published community-map metadata (no document body). */
export type CommunityMapSummary = Static<typeof CommunityMapSummarySchema>;

/**
 * Optional source-pack context supplied by the studio (it already loaded the
 * pack to preview the scene). Used only to run the `validatePack` provenance
 * and terrain-frame gate on the server; never trusted as the document source.
 */
export const CommunityMapPackContextSchema = Type.Object({
  /** A parsed `ContentPackManifest` (validated against the schema server-side). */
  manifest: Type.Unknown(),
  /** Atlas frame names for frame-existence checks. */
  atlasFrames: Type.Optional(Type.Array(Type.String())),
  /** Map file paths keyed by map id (for map-file-existence checks). */
  mapFiles: Type.Optional(Type.Record(Type.String(), Type.String())),
  /** Map id the submitted document corresponds to. */
  mapId: Type.Optional(Type.String({ minLength: 1 })),
});
/** Optional pack context for the publish gate. */
export type CommunityMapPackContext = Static<typeof CommunityMapPackContextSchema>;

/** Request body for publishing a community map. */
export const PublishCommunityMapSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: COMMUNITY_MAP_TITLE_MAX_LENGTH }),
  document: Type.String({ minLength: 1 }),
  /** Optional explicit slug; derived from the title when omitted. */
  slug: Type.Optional(
    Type.String({
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      maxLength: 80,
    }),
  ),
  packContext: Type.Optional(CommunityMapPackContextSchema),
});
/** Request body for publishing a community map. */
export type PublishCommunityMap = Static<typeof PublishCommunityMapSchema>;

/** Response returned after a successful publish. */
export const PublishCommunityMapResultSchema = Type.Object({
  slug: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  documentHash: Type.String({ minLength: 1 }),
  /** Hub-relative URL the document can be fetched from. */
  url: Type.String({ minLength: 1 }),
});
/** Result of a successful community-map publish. */
export type PublishCommunityMapResult = Static<typeof PublishCommunityMapResultSchema>;

// ---------------------------------------------------------------------------
// Pure document gate
// ---------------------------------------------------------------------------

/** Stable machine-readable document-gate code. */
export type CommunityMapIssueCode =
  | 'document.invalid-json'
  | 'document.not-object'
  | 'document.unsupported-kind'
  | 'document.schema-invalid'
  | 'document.cell-count-mismatch'
  | 'document.duplicate-placement-id'
  | 'document.duplicate-transition-id'
  | 'document.duplicate-layer-id'
  | 'document.navigation-index-out-of-range';

/** A single document-gate failure. */
export type CommunityMapIssue = {
  code: CommunityMapIssueCode;
  path: string;
  message: string;
};

/** The document gate result; `mapId` is present only when the shape is valid. */
export type CommunityMapValidationResult = {
  valid: boolean;
  mapId?: string;
  issues: CommunityMapIssue[];
};

/**
 * Validates a native `aikami.scene` document submission without the engine.
 *
 * Runs the canonical `SceneDocumentSchema` (shape + bounded sizes) plus the
 * cross-field invariants TypeBox cannot express: grid lengths equal
 * width×height and object ids are unique. Returns structured issues; never
 * throws (contract C-381 AC-5 style).
 */
export const validateCommunityMapDocument = (raw: unknown): CommunityMapValidationResult => {
  const issues: CommunityMapIssue[] = [];

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {
        valid: false,
        issues: [
          {
            code: 'document.invalid-json',
            path: '/',
            message: 'Document is not valid JSON.',
          },
        ],
      };
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      issues: [
        { code: 'document.not-object', path: '/', message: 'Document must be a JSON object.' },
      ],
    };
  }

  const candidate = raw as { kind?: unknown };
  if (candidate.kind !== SCENE_DOCUMENT_KIND) {
    return {
      valid: false,
      issues: [
        {
          code: 'document.unsupported-kind',
          path: '/kind',
          message: `Document kind must be "${SCENE_DOCUMENT_KIND}" (version ${SCENE_SCHEMA_VERSION}).`,
        },
      ],
    };
  }

  if (!Value.Check(SceneDocumentSchema, raw)) {
    for (const error of Value.Errors(SceneDocumentSchema, raw).slice(0, 8)) {
      issues.push({
        code: 'document.schema-invalid',
        path: error.instancePath || '/',
        message: error.message,
      });
    }
    return { valid: false, issues };
  }

  const doc = raw as SceneDocument;
  const cellCount = doc.extent.width * doc.extent.height;
  const checkLength = (grid: readonly unknown[], path: string): void => {
    if (grid.length !== cellCount) {
      issues.push({
        code: 'document.cell-count-mismatch',
        path,
        message: `${path} has ${grid.length} cells but the extent requires ${cellCount}.`,
      });
    }
  };

  if (doc.surface.mode === 'terrain') {
    checkLength(doc.surface.cells, '/surface/cells');
  } else {
    checkLength(doc.surface.grid, '/surface/grid');
  }
  for (const layer of doc.layers) {
    checkLength(layer.grid, `/layers/${layer.id}/grid`);
  }
  if (doc.elevation) {
    checkLength(doc.elevation, '/elevation');
  }

  const checkUnique = <T>(
    items: readonly T[],
    id: (item: T) => string,
    path: string,
    code: CommunityMapIssueCode,
  ): void => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = id(item);
      if (seen.has(key)) {
        issues.push({
          code,
          path: `${path}/${key}`,
          message: `Duplicate id "${key}" in ${path}.`,
        });
      }
      seen.add(key);
    }
  };
  checkUnique(
    doc.placements,
    (placement) => placement.id,
    '/placements',
    'document.duplicate-placement-id',
  );
  checkUnique(doc.layers, (layer) => layer.id, '/layers', 'document.duplicate-layer-id');
  if (doc.transitions) {
    checkUnique(
      doc.transitions,
      (transition) => transition.id,
      '/transitions',
      'document.duplicate-transition-id',
    );
  }

  const overrides = doc.navigation.blockingOverrides;
  if (overrides) {
    for (const override of overrides) {
      if (override.index >= cellCount) {
        issues.push({
          code: 'document.navigation-index-out-of-range',
          path: `/navigation/blockingOverrides/${override.index}`,
          message: `Blocking override index ${override.index} is outside the ${cellCount}-cell extent.`,
        });
      }
    }
  }

  return { valid: issues.length === 0, mapId: doc.id, issues };
};
