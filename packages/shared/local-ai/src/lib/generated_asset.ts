// packages/shared/local-ai/src/lib/generated_asset.ts
//
// The single `GeneratedAsset` derivation (C-510) — hashing, tag templating and
// provenance in one place. Both sinks call it: the Bun CLI writes the result
// to catalog staging, the client writes it to OPFS + the Turso registry. The
// descriptor is never hand-assembled at a call site, or the two sinks drift.
//
// Portable: uses `globalThis.crypto.subtle` (Bun and browsers both provide
// it) — no Node/Bun-only imports.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { slugifyAssetToken } from '@aikami/constants';
import type {
  AssetRecipe,
  GeneratedAsset,
  GenerationEngineId,
  GenerationResult,
} from '@aikami/types';

/** `AssetRefSchema.tag` — the registry tag grammar. */
const TAG_PATTERN = /^[a-z0-9]+(:[a-z0-9_.-]+)+$/;

/** Fallback MIME types when an engine reports none. */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

/**
 * Slugifies a prompt: lowercased, every run of non-`[a-z0-9]` collapsed to a
 * single `-`, leading/trailing `-` trimmed. Delegates to
 * `slugifyAssetToken` in `@aikami/constants` so the expression tag convention
 * and the recipe `{{slug}}` expansion cannot drift.
 *
 * @example "Rusty iron gate!" → "rusty-iron-gate"
 */
export const slugifyPrompt = (prompt: string): string => slugifyAssetToken(prompt);

/**
 * Expands a recipe's `tagTemplate`, substituting `{{slug}}` with the
 * slugified prompt. Templates without the placeholder pass through unchanged.
 */
export const expandTagTemplate = (template: string, slug: string): string =>
  template.replaceAll('{{slug}}', slug);

/**
 * Derives the registry tag for a recipe + prompt.
 *
 * @throws Error when the derived tag does not satisfy `AssetRefSchema.tag` —
 *         registering an invalid tag must fail loudly, never silently.
 */
export const deriveTag = (recipe: AssetRecipe, prompt: string): string => {
  const slug = slugifyPrompt(prompt);
  if (slug.length === 0) {
    throw new Error(
      `Cannot derive a tag for recipe "${recipe.id}" — the prompt slugifies to an empty string`,
    );
  }
  const template = recipe.tagTemplate ?? `${recipe.category}:{{slug}}`;
  const tag = expandTagTemplate(template, slug);
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(
      `Recipe "${recipe.id}" produced the invalid tag "${tag}" — it must match ${TAG_PATTERN}`,
    );
  }
  return tag;
};

/** Hex SHA-256 of the bytes. Shared by the Bun CLI and the browser. */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // WebCrypto accepts any ArrayBufferView at runtime, but a view typed over
  // `ArrayBufferLike` is not assignable to `BufferSource`. Copying into a
  // fresh, `ArrayBuffer`-backed view costs one pass and needs no cast.
  const buffer = new Uint8Array(bytes.byteLength);
  buffer.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** MIME type for an extension, with an `application/octet-stream` fallback. */
export const mimeTypeForExt = (ext: string): string =>
  MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';

/** Options for {@link toGeneratedAsset}. */
export type ToGeneratedAssetOptions = {
  /**
   * The original user prompt. Defaults to `result.metadata.prompt`, which
   * every adapter sets, and finally to the recipe's own template.
   */
  prompt?: string;
};

/**
 * Derives the shared `GeneratedAsset` descriptor from a generation result.
 *
 * `provenance.source` is always `generated:<engine>` — generated work has no
 * upstream licence to declare and no human author to credit. The model id is
 * recorded in `metadata` on the result so the catalog attribution preflight
 * can gate publication.
 *
 * @param result — Engine result (bytes + MIME type + engine id).
 * @param recipe — The recipe that produced it (category, ext, tag template).
 * @param engine — Resolved engine id (the provenance provider).
 * @param options — Prompt override.
 * @returns The descriptor, validated against the tag grammar.
 */
export const toGeneratedAsset = async (
  result: GenerationResult,
  recipe: AssetRecipe,
  engine: GenerationEngineId,
  options: ToGeneratedAssetOptions = {},
): Promise<GeneratedAsset> => {
  const prompt =
    options.prompt ??
    (typeof result.metadata.prompt === 'string' ? result.metadata.prompt : undefined) ??
    recipe.promptTemplate;

  const sha256 = await sha256Hex(result.bytes);
  const ext = recipe.output.ext.toLowerCase();
  const tag = deriveTag(recipe, prompt);

  return {
    recipeId: recipe.id,
    category: recipe.category,
    tag,
    sha256,
    sizeBytes: result.bytes.length,
    ext,
    mimeType: result.mimeType || mimeTypeForExt(ext),
    provenance: { source: `generated:${engine}` },
    engine,
    seed: result.seed,
    prompt,
  };
};
