// packages/shared/constants/src/lib/image_style_profiles.ts
//
// Built-in style profiles for the Image Generation Pipeline (C-242).
// Each profile defines a prompt grammar, positive/negative tags, and per-image-type
// tag overrides. Built-in profiles are immutable; users can clone them to create
// custom variants.
//
// Contract: C-242 Image Generation Pipeline

import type { ImageStyleProfile } from '@aikami/types';

// ── Built-in profile definitions ───────────────────────────────────────

const AUTO_PROFILE: ImageStyleProfile = {
  id: 'auto',
  name: 'Auto',
  isBuiltIn: true,
  promptGrammar: 'naturalLanguage',
  positiveTags: '',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry',
  perImageTags: {},
};

const ANIME_PROFILE: ImageStyleProfile = {
  id: 'anime',
  name: 'Anime',
  isBuiltIn: true,
  promptGrammar: 'danbooru',
  positiveTags: 'masterpiece, best quality, detailed, highres, anime style',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry, ugly, deformed, nsfw',
  perImageTags: {
    background: 'scenic, wide shot, detailed environment, anime scenery',
    portrait: 'portrait, upper body, detailed face, anime character',
    illustration: 'dynamic pose, action scene, dramatic angle, anime illustration',
    sprite: 'pixel art, sprite sheet, game asset, RPG maker',
  },
};

const REALISTIC_PROFILE: ImageStyleProfile = {
  id: 'realistic',
  name: 'Realistic',
  isBuiltIn: true,
  promptGrammar: 'naturalLanguage',
  positiveTags:
    'photorealistic, realistic, detailed, professional photography, 8k, highly detailed',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry, cartoon, anime, drawing, painting',
  perImageTags: {
    background: 'wide shot, landscape photography, realistic environment, detailed scenery',
    portrait: 'portrait photography, upper body, realistic face, detailed features',
    illustration: 'cinematic, dramatic lighting, realistic action scene',
    sprite: 'pixel art, game asset, isometric',
  },
};

const CINEMATIC_PROFILE: ImageStyleProfile = {
  id: 'cinematic',
  name: 'Cinematic',
  isBuiltIn: true,
  promptGrammar: 'naturalLanguage',
  positiveTags:
    'cinematic lighting, dramatic shadows, film grain, 8k, epic, atmospheric, volumetric lighting, movie poster',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry, bright, flat lighting, plain background',
  perImageTags: {
    background: 'ultra wide shot, cinematic landscape, establishing shot, atmospheric environment',
    portrait: 'cinematic portrait, dramatic side lighting, film still',
    illustration: 'movie poster, epic composition, dramatic action, cinematic color grading',
    sprite: 'pixel art, cinematic palette, moody coloring',
  },
};

const FANTASY_PROFILE: ImageStyleProfile = {
  id: 'fantasy',
  name: 'Fantasy',
  isBuiltIn: true,
  promptGrammar: 'naturalLanguage',
  positiveTags:
    'fantasy art, detailed, magical, high fantasy, concept art, trending on ArtStation, intricate details',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry, modern, sci-fi, contemporary',
  perImageTags: {
    background: 'fantasy landscape, magical environment, epic scenery, fantasy world',
    portrait: 'fantasy character portrait, ornate detail, medieval fantasy',
    illustration: 'fantasy battle scene, epic fantasy art, magical encounter',
    sprite: 'pixel art, fantasy game asset, RPG sprite',
  },
};

const PIXEL_ART_PROFILE: ImageStyleProfile = {
  id: 'pixel-art',
  name: 'Pixel Art',
  isBuiltIn: true,
  promptGrammar: 'commaTags',
  positiveTags: 'pixel art, 16-bit, retro, game sprite, clean pixel edges, vibrant palette',
  negativeTags:
    'lowres, bad anatomy, bad hands, text, watermark, error, cropped, jpeg artifacts, signature, username, blurry, realistic, 3d, photorealism',
  perImageTags: {
    background: 'pixel art scenery, parallax background, game environment, tileable',
    portrait: 'pixel art portrait, sprite, character portrait, dialog portrait',
    illustration: 'pixel art scene, cinematic pixel art, game cutscene',
    sprite: 'sprite sheet, walking animation, RPG sprite, 32x32',
  },
};

// ── Exports ────────────────────────────────────────────────────────────

/** All built-in style profiles. Immutable reference — built-in profiles cannot be deleted. */
export const BUILT_IN_STYLE_PROFILES: readonly ImageStyleProfile[] = [
  AUTO_PROFILE,
  ANIME_PROFILE,
  REALISTIC_PROFILE,
  CINEMATIC_PROFILE,
  FANTASY_PROFILE,
  PIXEL_ART_PROFILE,
] as const;

/** ID of the default style profile. */
export const DEFAULT_STYLE_PROFILE_ID = 'auto';
