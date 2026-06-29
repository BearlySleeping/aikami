// apps/e2e/src/visual/suites/lpc.visual.ts
// LPC Character Rendering — declarative visual test suite.
//
// Port of lpc_visual.spec.ts. Captures isolated PixiJS canvas
// screenshots at high zoom for AI visual validation of LPC
// character layer compositing.
//
// Uses the /dev/lpc route with URL query params for layer/variant
// selection. Each test case configures a specific character assembly.
//
// Contract: C-050, C-073, C-074

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const LpcSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({
    description: 'Whether a pixel-art character sprite is visible',
  }),
  layersVisible: Type.Boolean({
    description: 'Whether multiple clothing/equipment layers are visible',
  }),
  colorsCorrect: Type.Boolean({
    description: 'Whether colors match expected palette (no wrong tints)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const LPC_PROMPT = [
  'This is a close-up screenshot of an LPC (Liberated Pixel Cup) character from the Aikami game.',
  'The character is rendered with PixiJS at high zoom on the /dev/lpc sandbox.',
  '',
  'EVALUATE:',
  '- Is a pixel-art character clearly visible?',
  '- Are the character layers composited correctly (body, head, hair, armor, etc.)?',
  '- Are colors consistent with expected palette (no wrong tints, no missing colors)?',
  '- Is the character well-centered in the frame (not cut off at edges)?',
  '',
  'Score: 90-100 for perfect multi-layer composite, 70-89 for minor misalignment/color issues, 0-69 for broken/missing layers.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── URL builder helper ───────────────────────────────────────

const buildLpcUrl = (options: {
  layers: Array<{ slotDefIndex: number; variantIndex: number }>;
  paletteOverrides?: Record<string, string>;
  state?: number;
  direction?: number;
  frame?: number;
  zoom?: number;
}): string => {
  const params = new URLSearchParams();

  for (let i = 0; i < options.layers.length; i++) {
    const layer = options.layers[i];
    if (layer === undefined) {
      continue;
    }
    params.set(`l${i}`, `${layer.slotDefIndex}:${layer.variantIndex}`);
  }

  if (options.paletteOverrides) {
    for (const [key, hex] of Object.entries(options.paletteOverrides)) {
      params.set(`p${key}`, hex);
    }
  }

  if (options.state !== undefined) {
    params.set('state', String(options.state));
  }
  if (options.direction !== undefined) {
    params.set('dir', String(options.direction));
  }
  if (options.frame !== undefined) {
    params.set('frame', String(options.frame));
  }
  if (options.zoom !== undefined) {
    params.set('zoom', String(options.zoom));
  }

  params.set('visual-testing', 'true');

  return params.toString();
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'lpc',
  route: '/dev/lpc',
  waitCondition: 'pixi_loaded',
  cases: [
    // ── Bare body ──────────────────────────────────────────
    {
      name: 'LPC — Bare Body',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({ layers: [{ slotDefIndex: 0, variantIndex: 0 }], frame: 0, zoom: 8 }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        'This should show a bare body (skin tone) character sprite with no equipment.',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── Body + Head ────────────────────────────────────────
    {
      name: 'LPC — Body + Head',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 },
              { slotDefIndex: 1, variantIndex: 0 },
            ],
            frame: 0,
            zoom: 8,
          }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        'This should show a character with body and head layers composited.',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── Full Knight ────────────────────────────────────────
    {
      name: 'LPC — Full Knight',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 },
              { slotDefIndex: 1, variantIndex: 0 },
              { slotDefIndex: 2, variantIndex: 0 },
              { slotDefIndex: 3, variantIndex: 3 },
              { slotDefIndex: 4, variantIndex: 0 },
              { slotDefIndex: 5, variantIndex: 1 },
              { slotDefIndex: 6, variantIndex: 0 },
              { slotDefIndex: 6, variantIndex: 3 },
            ],
            frame: 0,
            zoom: 8,
          }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        'This should show a fully equipped knight — body, head, hair, plate armor, greaves, boots, sword, and shield.',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── Tinted Hair ────────────────────────────────────────
    {
      name: 'LPC — Tinted Hair',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 },
              { slotDefIndex: 1, variantIndex: 0 },
              { slotDefIndex: 2, variantIndex: 3 },
            ],
            paletteOverrides: {
              '2:64': 'FF44AA',
              '2:65': 'FF66CC',
              '2:66': 'CC2288',
              '0:8': '44FF44',
            },
            frame: 0,
            zoom: 8,
          }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        'The hair should have a pink/magenta tint (FF44AA palette override) — NOT the default brown/black.',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── Walk Cycle Frame 0 ─────────────────────────────────
    {
      name: 'LPC — Walk Frame 0',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 },
              { slotDefIndex: 1, variantIndex: 0 },
              { slotDefIndex: 2, variantIndex: 2 },
              { slotDefIndex: 3, variantIndex: 0 },
              { slotDefIndex: 4, variantIndex: 0 },
            ],
            state: 2,
            direction: 2,
            frame: 0,
            zoom: 8,
          }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        'This should show frame 0 of a walk cycle animation (facing down).',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── Walk Cycle Frame 4 ─────────────────────────────────
    {
      name: 'LPC — Walk Frame 4',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 },
              { slotDefIndex: 1, variantIndex: 0 },
              { slotDefIndex: 2, variantIndex: 2 },
              { slotDefIndex: 3, variantIndex: 0 },
              { slotDefIndex: 4, variantIndex: 0 },
            ],
            state: 2,
            direction: 2,
            frame: 4,
            zoom: 8,
          }),
        ),
      ),
      prompt: [LPC_PROMPT, 'This should show frame 4 of a walk cycle animation (mid-stride).'].join(
        '\n',
      ),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },
  ],
});
