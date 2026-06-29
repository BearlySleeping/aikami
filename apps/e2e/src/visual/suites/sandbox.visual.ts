// apps/e2e/src/visual/suites/sandbox.visual.ts
// Character Sandbox — declarative visual test suite.
//
// Port of sandbox_visual.spec.ts. Captures the /dev/sandbox page
// to verify a character renders with LPC sprite layers.
//
// Contract: C-139, C-074

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const SandboxSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({
    description: 'Whether a pixel-art character is visible on the canvas',
  }),
  spriteCorrect: Type.Boolean({
    description:
      'Whether the character renders as a pixel-art sprite (not rectangles/solid-color blocks)',
  }),
  canvasLoaded: Type.Boolean({ description: 'Whether the PixiJS canvas has rendered content' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const SANDBOX_PROMPT = [
  'This is a screenshot from the Aikami character sandbox (/dev/sandbox).',
  '',
  'EXPECTED:',
  '- A PixiJS canvas showing a pixel-art character sprite.',
  '- The character should have distinct body parts (head, body, legs).',
  '- The background should be a dark/neutral color (not white).',
  '- No solid-color rectangles — the character should be a proper LPC sprite.',
  '',
  'EVALUATE:',
  '- Is a pixel-art character visible on the canvas?',
  '- Does the character have recognizable body parts?',
  '- Is the rendering correct (no tint blocks, no missing textures)?',
  '',
  'Score: 90-100 for clear character, 70-89 for partial/blocky, 0-69 for missing or broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'sandbox',
  route: '/dev/sandbox/sandbox',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Sandbox — Character Rendering',
      searchParams: { 'skip-onboarding': 'true' },
      prompt: SANDBOX_PROMPT,
      schema: SandboxSchema,
    },
  ],
});
