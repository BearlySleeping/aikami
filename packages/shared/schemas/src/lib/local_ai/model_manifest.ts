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

/**
 * Source discriminated by kind. A `file` entry must declare either a direct
 * `url` or the full HuggingFace repo coordinates (repo + revision + file);
 * an `archive` entry must declare a direct `url`. Extra properties are
 * tolerated (e.g. a file with both url and repo coords), but a source that
 * satisfies none of the variants fails validation.
 */
const ManifestEntrySourceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('file'),
    /** file kind: HuggingFace repo (repo/revision/file) or direct url override */
    repo: Type.String(),
    revision: Type.String(),
    file: Type.String(),
    url: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal('file'),
    /** file kind: direct url override */
    url: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal('archive'),
    /** archive kind: direct download url */
    url: Type.String(),
  }),
]);

/**
 * Role a companion file plays alongside a "primary" entry (e.g. Anima,
 * FLUX-family models: the primary diffusion weights ship without a VAE or
 * text encoder, and sd-server needs each passed as its own flag —
 * `--vae` / `--llm` / `--clip_l` / `--clip_g` / `--t5xxl`).
 */
export const ManifestEntryCompanionRoleSchema = Type.Union([
  Type.Literal('vae'),
  Type.Literal('llm'),
  Type.Literal('clip_l'),
  Type.Literal('clip_g'),
  Type.Literal('t5xxl'),
]);

export const ModelManifestEntrySchema = Type.Intersect([
  Type.Object({
    id: Type.String(),
    modality: ManifestEntryModalitySchema,
    tier: ManifestEntryTierSchema,
    license: Type.String(),
    requiresAcknowledgement: Type.Boolean(),
    targetPath: Type.String(),
    bytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ pattern: '^[0-9a-fA-F]{64}$' }),
    /**
     * Other manifest entry ids that MUST be fetched and passed alongside
     * this one — e.g. Anima's VAE + text encoder. Referenced ids are never
     * independently tier-selected (recommend.ts excludes them from the
     * per-modality candidate pool); they ride along with this entry only.
     */
    companions: Type.Optional(
      Type.Array(Type.Object({ role: ManifestEntryCompanionRoleSchema, id: Type.String() })),
    ),
  }),
  ManifestEntrySourceSchema,
]);

export const ModelManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  entries: Type.Array(ModelManifestEntrySchema),
});
