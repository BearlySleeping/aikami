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

/** Schema for oversize weapon scale test — adds weaponScaleCorrect field. */
const OversizeWeaponSchema = Type.Object({
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
  weaponScaleCorrect: Type.Boolean({
    description:
      'Whether the sword blade is roughly as long as the character torso and the grip meets the hand',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

/** Prompt for oversize weapon scale test — C-428 AC-5. */
const OVERSEIZE_WEAPON_PROMPT = [
  'This is a close-up screenshot of an LPC (Liberated Pixel Cup) character from the Aikami game.',
  'The character is rendered with PixiJS at high zoom on the /dev/lpc sandbox.',
  'The character is holding a longsword (longsword_alt) in their right hand, facing down.',
  '',
  'EVALUATE:',
  '- Is a pixel-art character clearly visible?',
  '- Are the character layers composited correctly (body, head, hair, armor, etc.)?',
  '- Are colors consistent with expected palette (no wrong tints, no missing colors)?',
  "- Is the sword blade roughly as long as the character's torso?",
  "- Does the sword grip meet the character's hand?",
  '',
  "CRITICAL: Score 90+ only if the blade is roughly as long as the character's torso",
  "and the grip meets the character's hand. Score below 50 if the blade is",
  'dagger-sized, floats detached from the hand, or is visibly cropped mid-blade.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

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

    // ── C-370: Neck Gap — Torso Garment Without Body — 4x Zoom ──────
    {
      name: 'C-370 — Neck Continuity (Torso Only, No Body)',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 1, variantIndex: 0 }, // head only
              { slotDefIndex: 2, variantIndex: 6 }, // torso (chainmail) — creates neck gap
            ],
            frame: 0,
            zoom: 4,
          }),
        ),
      ),
      prompt: [
        LPC_PROMPT,
        '',
        'CRITICAL CHECK (C-370): No transparent or background-colored pixels should be visible',
        "between the character's chin and the top of the torso garment. The neck region must",
        'show continuous opaque skin/body pixels filling the gap from chin to garment neckline.',
        'A body layer should be visible beneath the torso chainmail.',
        '',
        'Score 90+: No background pixels in the neck gap.',
        'Score 70-89: Small (< 3px) gap with minor background bleed.',
        'Score 0-69: Clearly visible background bleed in the neck/chest region.',
      ].join('\n'),
      schema: LpcSchema,
      canvasSelector: '#game-canvas',
    },

    // ── C-428 AC-5: Oversize Weapon Scale ────────────────────────
    {
      name: 'C-428 AC-5 — Oversize Weapon Scale (longsword_alt)',
      searchParams: Object.fromEntries(
        new URLSearchParams(
          buildLpcUrl({
            layers: [
              { slotDefIndex: 0, variantIndex: 0 }, // body
              { slotDefIndex: 1, variantIndex: 0 }, // head
              { slotDefIndex: 2, variantIndex: 2 }, // torso
              { slotDefIndex: 3, variantIndex: 0 }, // legs
              { slotDefIndex: 4, variantIndex: 0 }, // feet
              { slotDefIndex: 6, variantIndex: 4 }, // weapon: longsword_alt
            ],
            state: 2, // Walk
            direction: 2, // Down
            frame: 0,
            zoom: 8,
          }),
        ),
      ),
      prompt: OVERSEIZE_WEAPON_PROMPT,
      schema: OversizeWeaponSchema,
      canvasSelector: '#game-canvas',
    },
  ],
});
