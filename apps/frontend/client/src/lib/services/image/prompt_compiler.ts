// apps/frontend/client/src/lib/services/image/prompt_compiler.ts
//
// Pure function that compiles a base prompt with a style profile, performing
// tag deduplication (case-insensitive), negative phrase extraction, and
// per-image-type tag injection. Returns { positive, negative } strings.
//
// Contract: C-242 Image Generation Pipeline

import type { CompiledPrompt, ImageStyleProfile, ImageType } from '@aikami/types';

/**
 * Phrases that should be moved from the positive prompt to the negative prompt.
 * Case-insensitive matching. If a tag starts with any of these substrings, it
 * and neighboring related terms are extracted.
 */
const NEGATIVE_EXTRACTION_PATTERNS = [
  'avoid text',
  'no text',
  'no watermark',
  'no signature',
  'watermark',
  'signature',
  'text',
  'cropped',
  'jpeg artifact',
  'blurry',
  'lowres',
  'bad anatomy',
  'bad hands',
  'error',
  'ugly',
  'deformed',
  'nsfw',
] as const;

/**
 * Splits a comma-separated tag string into trimmed individual tags,
 * filtering out empty strings.
 */
const _splitTags = (tags: string): string[] =>
  tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

/**
 * Deduplicates tags case-insensitively, keeping the first occurrence.
 * Returns the cleaned, comma-separated tag string.
 */
const _deduplicateTags = (tags: string[]): string => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(tag);
    }
  }

  return result.join(', ');
};

/**
 * Checks if a single tag matches any negative extraction pattern.
 */
const _isNegativeTag = (tag: string): boolean => {
  const lower = tag.toLowerCase().trim();
  return NEGATIVE_EXTRACTION_PATTERNS.some((pattern) => lower.includes(pattern));
};

/**
 * Compiles an image generation prompt by merging a base prompt with a style profile.
 *
 * Processing pipeline:
 * 1. Start with profile positive tags as the base
 * 2. Append the user's base prompt
 * 3. Append per-image-type tags from the profile
 * 4. Split into individual tags, trim
 * 5. Extract negative-ish phrases → move to negative prompt
 * 6. Deduplicate case-insensitively (keep first occurrence)
 * 7. Return { positive, negative }
 *
 * @param options - Compilation options.
 * @param options.basePrompt - The raw prompt text from the user or trigger.
 * @param options.profile - The style profile to apply.
 * @param options.imageType - The image type (background, portrait, etc.).
 * @returns The compiled positive and negative prompt strings.
 */
export const compileImagePrompt = (options: {
  basePrompt: string;
  profile: ImageStyleProfile;
  imageType: ImageType;
}): CompiledPrompt => {
  const { basePrompt, profile, imageType } = options;

  // 1. Start with profile positive tags
  const positiveParts: string[] = [];
  if (profile.positiveTags.length > 0) {
    positiveParts.push(profile.positiveTags);
  }

  // 2. Add base prompt
  if (basePrompt.length > 0) {
    positiveParts.push(basePrompt);
  }

  // 3. Add per-image-type tags
  const perImageTag = profile.perImageTags[imageType];
  if (perImageTag && perImageTag.length > 0) {
    positiveParts.push(perImageTag);
  }

  // 4. Merge into single string, then split into individual tags
  const allPositive = positiveParts.join(', ');
  const allTags = _splitTags(allPositive);

  // 5. Separate negative-ish tags from positive ones
  const positiveTags: string[] = [];
  const extractedNegativeTags: string[] = [];

  for (const tag of allTags) {
    if (_isNegativeTag(tag)) {
      const processed = tag.toLowerCase().trim();
      if (!extractedNegativeTags.includes(processed)) {
        extractedNegativeTags.push(processed);
      }
    } else {
      positiveTags.push(tag);
    }
  }

  // 5b. Collect profile negative tags as starting point
  const negativeBase = profile.negativeTags.length > 0 ? _splitTags(profile.negativeTags) : [];

  // 5c. Merge profile negatives with extracted negatives (dedup coming up later)
  const allNegativeTags = [...negativeBase, ...extractedNegativeTags];

  // 6. Deduplicate both sets
  const positive = _deduplicateTags(positiveTags);
  const negative = _deduplicateTags(allNegativeTags);

  return { positive, negative };
};
