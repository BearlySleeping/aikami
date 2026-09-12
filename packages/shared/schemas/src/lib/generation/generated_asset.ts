// packages/shared/schemas/src/lib/generation/generated_asset.ts
//
// The single generated-asset descriptor shared by both sinks (C-510): the Bun
// CLI writes it to catalog staging, the client writes it to OPFS + the Turso
// registry. It is never hand-assembled at a call site — see
// `toGeneratedAsset` in `@aikami/local-ai`.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { type Static, Type } from 'typebox';
import { CatalogCategorySchema } from '../catalog/catalog_index.ts';
import { AssetProvenanceSchema } from '../game/asset_provenance.ts';
import { GenerationEngineIdSchema } from './asset_recipe.ts';

/**
 * What a generation produced, described without carrying the bytes. The
 * content hash IS the identity — the bytes travel separately (staging file on
 * disk, cache entry in the client).
 */
export const GeneratedAssetSchema = Type.Object({
  /** Recipe that produced it. */
  recipeId: Type.String({ minLength: 1 }),
  category: CatalogCategorySchema,
  /** Registry tag — must satisfy `AssetRefSchema.tag`. */
  tag: Type.String({ pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$' }),
  /** Hex SHA-256 of the bytes. */
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  sizeBytes: Type.Integer({ minimum: 1 }),
  /** Lowercase extension including the dot. */
  ext: Type.String({ pattern: '^\\.[a-z0-9]+$' }),
  mimeType: Type.String({ minLength: 1 }),
  /** `source` is always `generated:<engine>`. */
  provenance: AssetProvenanceSchema,
  engine: GenerationEngineIdSchema,
  seed: Type.Optional(Type.Integer()),
  /** The original user prompt (not the compiled template). */
  prompt: Type.String(),
});

export type GeneratedAsset = Static<typeof GeneratedAssetSchema>;
