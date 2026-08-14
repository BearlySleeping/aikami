// packages/shared/schemas/src/lib/local_ai/model_manifest.ts
import Type from 'typebox';

/**
 * C-390's `models.manifest.json` schema (schemaVersion 1). The manifest is
 * owned by C-390 — C-391 reads it, never edits it. Tier labels are the
 * vocabulary the C-391 tier table maps onto: `cpu` / `8gb` / `16gb` / `any`.
 */
export const ManifestEntryModalitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('image'),
  Type.Literal('tts'),
  Type.Literal('stt'),
]);

export const ManifestEntryTierSchema = Type.Union([
  Type.Literal('cpu'),
  Type.Literal('8gb'),
  Type.Literal('16gb'),
  Type.Literal('any'),
]);

export const ModelManifestEntrySchema = Type.Object({
  id: Type.String(),
  modality: ManifestEntryModalitySchema,
  tier: ManifestEntryTierSchema,
  license: Type.String(),
  requiresAcknowledgement: Type.Boolean(),
  kind: Type.Union([Type.Literal('file'), Type.Literal('archive')]),
  /** file kind: HuggingFace repo (repo/revision/file) or direct url override */
  repo: Type.Optional(Type.String()),
  revision: Type.Optional(Type.String()),
  file: Type.Optional(Type.String()),
  /** archive kind: direct download url */
  url: Type.Optional(Type.String()),
  targetPath: Type.String(),
  bytes: Type.Number(),
  sha256: Type.String(),
});

export const ModelManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  entries: Type.Array(ModelManifestEntrySchema),
});
