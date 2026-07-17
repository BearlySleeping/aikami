// apps/e2e/src/visual/suites/onboarding_appearance.visual.ts
// Onboarding Appearance — declarative visual test suite for LPC preview.
//
// Captures the LPC preview canvas at /dev/lpc-preview with different
// preset recipes. Each preset produces a visually distinct character
// that AI evaluation can verify.
//
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const PreviewSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({
    description: 'Whether a pixel-art character sprite is visible in the preview',
  }),
  layersVisible: Type.Boolean({
    description: 'Whether multiple body/clothing layers are visibly composited',
  }),
  animationState: Type.String({
    description: 'Description of the animation state seen (idle, walking, etc.)',
  }),
  issues: Type.Array(Type.String(), {
    description: 'List of visual issues detected',
  }),
});

// ── Prompts ──────────────────────────────────────────────────

const BASE_PROMPT = [
  'This is a screenshot of an LPC (Liberated Pixel Cup) character preview from the Aikami game.',
  'The character is rendered at 256x256 resolution in a PixiJS canvas with a dark navy background.',
  'The character should be centered in the frame, showing a pixel-art sprite in idle pose (facing down).',
  '',
  'EVALUATE:',
  '- Is a pixel-art character clearly visible?',
  '- Are body, head, and hair layers composited correctly?',
  '- Is the character well-centered (not cut off at edges)?',
  '- Is the rendering clean (no magenta artifacts, no missing textures)?',
  '',
  'Score: 90-100 for perfect multi-layer composite, 70-89 for minor issues, 0-69 for broken rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const BATTLE_SCARRED_PROMPT = [
  BASE_PROMPT,
  '',
  'This character should show:',
  '- A muscular male body',
  '- Plate armor on torso and legs',
  '- Messy dark hair',
  '- Brown basic boots',
  '- A human male head',
].join('\n');

const SCHOLARLY_PROMPT = [
  BASE_PROMPT,
  '',
  'This character should show:',
  '- A female body type',
  '- A scholarly robe (full-length fabric covering torso and legs)',
  '- Page-style hair with silver-white tint',
  '- Formal thin legs under the robe',
  '- Basic thin shoes',
].join('\n');

const MYSTERIOUS_PROMPT = [
  BASE_PROMPT,
  '',
  'This character should show:',
  '- A male body type',
  '- Leather armor on the torso',
  '- Messy/wild hair',
  '- Basic pants and boots',
  '- A human male head',
].join('\n');

const NOBLE_PROMPT = [
  BASE_PROMPT,
  '',
  'This character should show:',
  '- A female body type',
  '- A corset-style torso (fitted waist garment)',
  '- Princess-style hair with golden tint',
  '- Formal thin legs',
  '- Elegant thin shoes',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'onboarding-appearance',
  route: '/dev/lpc-preview',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    // ── Default recipe ──────────────────────────────────────
    {
      name: 'Preview — Default Recipe',
      searchParams: { preset: 'default' },
      prompt: BASE_PROMPT,
      schema: PreviewSchema,
      canvasSelector: '#lpc-preview-canvas',
      clipSize: 256,
    },

    // ── Battle-Scarred Veteran ──────────────────────────────
    {
      name: 'Preview — Battle-Scarred Veteran',
      searchParams: { preset: 'battle_scarred' },
      prompt: BATTLE_SCARRED_PROMPT,
      schema: PreviewSchema,
      canvasSelector: '#lpc-preview-canvas',
      clipSize: 256,
    },

    // ── Scholarly Robes ─────────────────────────────────────
    {
      name: 'Preview — Scholarly Robes',
      searchParams: { preset: 'scholarly' },
      prompt: SCHOLARLY_PROMPT,
      schema: PreviewSchema,
      canvasSelector: '#lpc-preview-canvas',
      clipSize: 256,
    },

    // ── Mysterious Wanderer ─────────────────────────────────
    {
      name: 'Preview — Mysterious Wanderer',
      searchParams: { preset: 'mysterious' },
      prompt: MYSTERIOUS_PROMPT,
      schema: PreviewSchema,
      canvasSelector: '#lpc-preview-canvas',
      clipSize: 256,
    },

    // ── Noble Bearing ───────────────────────────────────────
    {
      name: 'Preview — Noble Bearing',
      searchParams: { preset: 'noble' },
      prompt: NOBLE_PROMPT,
      schema: PreviewSchema,
      canvasSelector: '#lpc-preview-canvas',
      clipSize: 256,
    },
  ],
});
