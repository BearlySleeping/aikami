// packages/shared/schemas/src/lib/game/map_draft.ts
//
// C-508 — Per-user map-studio drafts.
//
// A draft is a private, owner-scoped native scene document the creator can
// save from the hub map studio and reload later. The document is stored as
// text (native `aikami.scene` JSON); validation happens at the API boundary
// through {@link SceneDocumentSchema} plus the structural checks in
// `community_map.ts`. These schemas define the HTTP wire shape only.

import { type Static, Type } from 'typebox';

/** Longest accepted draft name (characters). */
export const MAP_DRAFT_NAME_MAX_LENGTH = 120;

/**
 * Largest accepted draft document (bytes of UTF-8 JSON). D1 rows are bounded,
 * and the studio's documents are small; a larger map should be published from
 * the curated pipeline rather than pasted into a draft.
 */
export const MAP_DRAFT_DOCUMENT_MAX_BYTES = 512 * 1024;

/** A stored draft, including its document. */
export const MapDraftSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1, maxLength: MAP_DRAFT_NAME_MAX_LENGTH }),
  document: Type.String({ minLength: 1 }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
/** A stored draft with its native scene document. */
export type MapDraft = Static<typeof MapDraftSchema>;

/** A draft without its (potentially large) document, for list responses. */
export const MapDraftSummarySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1, maxLength: MAP_DRAFT_NAME_MAX_LENGTH }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
/** Draft metadata without the document body. */
export type MapDraftSummary = Static<typeof MapDraftSummarySchema>;

/** Request body for creating a draft. */
export const CreateMapDraftSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: MAP_DRAFT_NAME_MAX_LENGTH }),
  document: Type.String({ minLength: 1 }),
});
/** Request body for creating a draft. */
export type CreateMapDraft = Static<typeof CreateMapDraftSchema>;

/** Request body for updating a draft (either field may be omitted). */
export const UpdateMapDraftSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAP_DRAFT_NAME_MAX_LENGTH })),
  document: Type.Optional(Type.String({ minLength: 1 })),
});
/** Request body for updating a draft. */
export type UpdateMapDraft = Static<typeof UpdateMapDraftSchema>;
