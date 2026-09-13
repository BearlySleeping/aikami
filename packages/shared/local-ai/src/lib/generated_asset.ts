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
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'video/webm',
};

// ---------------------------------------------------------------------------
// C-517 AC-2: one byte-format authority
// ---------------------------------------------------------------------------

/** Reads `length` ASCII bytes at `offset` (a missing byte reads as NUL). */
const _asciiAt = (bytes: Uint8Array, offset: number, length: number): string => {
  let text = '';
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
};

/** True when `bytes` begins with the exact magic-byte sequence. */
const _startsWithBytes = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);

/**
 * True when the payload looks like a text-based SVG rather than a binary
 * container — no NUL bytes, and the root element after optional XML declarations
 * and comments is `svg`.
 */
const _looksLikeSvg = (bytes: Uint8Array): boolean => {
  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
  }
  let remaining = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)
    .replace(/^\uFEFF/, '')
    .trimStart();

  while (remaining.startsWith('<?xml') || remaining.startsWith('<!--')) {
    const closingToken = remaining.startsWith('<?xml') ? '?>' : '-->';
    const closingIndex = remaining.indexOf(closingToken);
    if (closingIndex < 0) {
      return false;
    }
    remaining = remaining.slice(closingIndex + closingToken.length).trimStart();
  }

  return /^<svg(?:\s[^>]*)?\/?>/i.test(remaining);
};

/**
 * Sniffs the container a byte payload actually is.
 *
 * The result is the canonical MIME type for the container's magic bytes, or
 * `undefined` when the payload is not a container this pipeline can describe.
 * It deliberately does not consult any declared `Content-Type`: a provider
 * that lies about its output must be caught, not believed.
 *
 * @param bytes - The raw payload (image or audio container).
 * @returns The sniffed MIME type, or undefined for an unrecognised payload.
 */
export const sniffMimeType = (bytes: Uint8Array): string | undefined => {
  if (bytes.length < 4) {
    return undefined;
  }

  // 8-byte signatures first — they are unambiguous.
  if (_startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (_startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (_startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return 'video/webm';
  }

  const prefix = _asciiAt(bytes, 0, 4);
  if (prefix === 'GIF8') {
    return 'image/gif';
  }
  if (prefix === 'OggS') {
    return 'audio/ogg';
  }
  if (prefix === 'fLaC') {
    return 'audio/flac';
  }
  if (prefix === 'RIFF') {
    // RIFF is shared by WAV and WebP — the format tag at offset 8 decides.
    const format = _asciiAt(bytes, 8, 4);
    if (format === 'WEBP') {
      return 'image/webp';
    }
    if (format === 'WAVE') {
      return 'audio/wav';
    }
    return undefined;
  }
  if (_asciiAt(bytes, 4, 4) === 'ftyp') {
    // ISO-BMFF: inspect the complete ftyp box, including compatible brands.
    // A generic `isom`/`mp4` container is not claimed to be media just because
    // it is BMFF.
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) {
      return undefined;
    }
    const brands = [_asciiAt(bytes, 8, 4)];
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
      brands.push(_asciiAt(bytes, offset, 4));
    }
    const normalizedBrands = brands.map((brand) => brand.toLowerCase());
    if (normalizedBrands.some((brand) => brand === 'avif' || brand === 'avis')) {
      return 'image/avif';
    }
    if (normalizedBrands.some((brand) => brand.startsWith('m4a') || brand.startsWith('m4b'))) {
      return 'audio/mp4';
    }
    return undefined;
  }

  if (_startsWithBytes(bytes, [0x49, 0x44, 0x33])) {
    return 'audio/mpeg'; // an ID3-tagged MP3
  }
  const syncByte = bytes[1] ?? 0;
  if (bytes[0] === 0xff && (syncByte & 0xf6) === 0xf0) {
    // ADTS sync (0xFFF1 / 0xFFF9) is 12 bits where an MPEG frame sync is 11.
    return 'audio/aac';
  }
  if (bytes[0] === 0xff && (syncByte & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  return _looksLikeSvg(bytes) ? 'image/svg+xml' : undefined;
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

/** Reverse of {@link MIME_BY_EXT} — the canonical extension for a MIME type. */
const EXT_BY_MIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

/**
 * The canonical file extension for a MIME type, or `undefined` when unknown.
 *
 * Used by the C-512 byte/descriptor seam to reconcile a recipe's declared
 * `output.ext` with what the engine actually returned (an engine that emits
 * PNG for a recipe that declared `.webp` must not be registered under a MIME
 * the bytes do not have).
 */
export const extForMimeType = (mimeType: string): string | undefined => {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return EXT_BY_MIME[normalized];
};

/** Options for {@link toGeneratedAsset}. */
export type ToGeneratedAssetOptions = {
  /**
   * The original user prompt. Defaults to `result.metadata.prompt`, which
   * every adapter sets, and finally to the recipe's own template.
   */
  prompt?: string;
  /**
   * Explicit registry tag, overriding `deriveTag`'s prompt-slug derivation
   * (C-512). Required for NPC-bound assets: the resolver looks a portrait or
   * expression up by `expressionAssetTag({ npcId, emotion })`
   * (`portraits:<npcId>-<emotion>`), which the prompt slug never produces.
   *
   * Validated against the same `AssetRefSchema.tag` grammar as a derived tag —
   * an invalid override fails loudly rather than registering an unreachable row.
   */
  tag?: string;
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
  const ext = recipe.output.ext.toLowerCase();
  const expectedMimeType = mimeTypeForExt(ext);
  const declaredMimeType = result.mimeType || expectedMimeType;
  const normalizedDeclared = declaredMimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';

  // The bytes decide the format — never the provider's `Content-Type`, which
  // an engine (or a proxy in front of it) can get wrong. Both the declared
  // MIME and the recipe's declared extension must agree with the sniff.
  const sniffedMimeType = sniffMimeType(result.bytes);
  if (sniffedMimeType === undefined) {
    throw new Error(
      `Recipe "${recipe.id}" received ${result.bytes.length} bytes in an unrecognised image or media container (declared ${declaredMimeType}) — refusing to register an undecodable payload`,
    );
  }
  if (normalizedDeclared !== sniffedMimeType) {
    throw new Error(
      `Recipe "${recipe.id}" was returned bytes the engine declared "${declaredMimeType}" but the bytes are ${sniffedMimeType} — refusing to trust a mislabeled payload`,
    );
  }
  if (expectedMimeType !== 'application/octet-stream' && sniffedMimeType !== expectedMimeType) {
    throw new Error(
      `Recipe "${recipe.id}" declares ${ext} (${expectedMimeType}) but the engine returned ${sniffedMimeType}`,
    );
  }
  const mimeType = sniffedMimeType;

  const prompt =
    options.prompt ??
    (typeof result.metadata.prompt === 'string' ? result.metadata.prompt : undefined) ??
    recipe.promptTemplate;

  // The producing model id (C-511 AC-4) — the only handle the catalog
  // attribution preflight has on the licence that gates publication. Read
  // from the engine's flat metadata, falling back to the recipe's model.
  const model =
    (typeof result.metadata.model === 'string' ? result.metadata.model : undefined) ?? recipe.model;

  const sha256 = await sha256Hex(result.bytes);
  const tag = options.tag ?? deriveTag(recipe, prompt);
  if (options.tag !== undefined && !TAG_PATTERN.test(options.tag)) {
    throw new Error(
      `Recipe "${recipe.id}" was given the invalid tag override "${options.tag}" — it must match ${TAG_PATTERN}`,
    );
  }

  return {
    recipeId: recipe.id,
    category: recipe.category,
    tag,
    sha256,
    sizeBytes: result.bytes.length,
    ext,
    mimeType,
    provenance: { source: `generated:${engine}` },
    engine,
    model,
    seed: result.seed,
    prompt,
  };
};
