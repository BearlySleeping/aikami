// apps/e2e/src/visual/suites/framing_baseline.visual.ts
//
// C-497 — Camera-framing & default-asset baseline capture.
//
// Records the new deliberate framing as the visual baseline for future
// asset/readability reviews (AC-4). Three framing captures plus the HUD
// hotbar capture:
//   (a) normal campaign boot at two viewport sizes (desktop 1280×720 and
//       small window 800×600);
//   (b) default/transient boot (fresh context, no completed onboarding);
//   (c) in-game HUD hotbar — only assigned slots render (no empty `+` slots).
//
// The world renders at the named base-scale policy (BASE_WORLD_SCALE = 4 →
// 32px tiles at 128 CSS px) and, because setMapBounds substitutes a default
// map extent for missing/zero dimensions (AC-2), a default boot must not show
// unbounded empty space around the map edge.
//
// Baseline captures land in apps/e2e/test-results/visual/ and are referenced
// from the C-497 execution report.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Framing schema ────────────────────────────────────────────

const FramingSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  worldFillsViewport: Type.Boolean({
    description: 'Whether the rendered world fills the viewport without large empty margins',
  }),
  tilesAtStatedScale: Type.Boolean({
    description: 'Whether tiles render at the stated base scale (32px tile ≈ 128 CSS px)',
  }),
  noUnboundedEmptySpace: Type.Boolean({
    description: 'Whether no large empty/void background appears around the map edge',
  }),
  crispPixelArt: Type.Boolean({
    description: 'Whether tiles are sharp pixel art with no blur/softening',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Hotbar schema ─────────────────────────────────────────────

const HotbarSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  onlyAssignedSlots: Type.Boolean({
    description:
      'Whether every visible hotbar slot has an assigned ability (no empty `+` slots or blank keybinds)',
  }),
  keybindLabelsVisible: Type.Boolean({
    description: 'Whether assigned hotbar slots show a keybind number label',
  }),
  hotbarOnscreen: Type.Boolean({
    description: 'Whether the hotbar bar is visible at the bottom of the HUD',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ───────────────────────────────────────────────────

const FRAMING_PROMPT = [
  'This is a screenshot of the Aikami game world at boot (top-down pixel-art JRPG).',
  '',
  'EXPECTED FRAMING:',
  '- The rendered world fills the viewport — the map surface occupies the screen with no large empty/black margins at the edges.',
  '- Tiles are rendered at the stated base scale (each 32px world tile ≈ 128 CSS pixels on screen) — readable pixel art, not tiny or blown out.',
  '- There is NO unbounded void/empty background beyond the map edge — the camera is clamped to the map so empty space is not visible.',
  '- Tile edges are sharp pixel art (no blurring, softening, or bilinear smearing).',
  '',
  'EVALUATE:',
  '- Does the world fill the viewport without large empty margins?',
  '- Are tiles at a deliberate, readable scale?',
  '- Is there any large empty/void background around the map edge (would indicate unbounded camera)?',
  '',
  'Score breakdown: 90+ coherent filled world; 70-89 mostly filled with minor margins; 40-69 partial/awkward framing; 0-39 blank, void, or severely broken.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const HOTBAR_PROMPT = [
  'This is a screenshot of the Aikami in-game HUD showing the hotbar ability bar.',
  '',
  'EXPECTED (C-497 AC-3):',
  '- Only ASSIGNED ability slots are rendered — every visible hotbar slot shows an ability.',
  '- There are NO empty placeholder slots with a "+" glyph and NO empty keybind labels.',
  '- Assigned slots show a keybind number label (e.g. 1-6) in the top corner.',
  '- The hotbar sits at the bottom center of the HUD.',
  '',
  'EVALUATE:',
  '- Does every visible slot have an assigned ability (no "+" empty slots)?',
  '- Are keybind labels visible on assigned slots?',
  '- Is the hotbar onscreen and readable?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ───────────────────────────────────────────────

/** Small-window viewport for the AC-1 "common viewport sizes" capture. */
const setSmallWindow = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 800, height: 600 });
  // Allow the renderer to re-layout after the resize before capturing.
  await page.waitForTimeout(500);
};

/**
 * Seeds an authored character sheet with a PARTIALLY-filled hotbar before the
 * production boot reads it, via the sanctioned E2E hook (C-487):
 * `globalThis.__AIKAMI_E2E_SHEET__`.
 *
 * AC-3 is about *assigned* slots. With the default (empty) sheet the hotbar
 * group renders zero slots, so the capture could not show a hotbar at all —
 * AC-3's verification explicitly asks for "a visual capture of the /game HUD
 * with a partially-filled hotbar". Seeding two of the six slots produces
 * exactly that state, while the remaining empty slots must still render no
 * button, no `+` glyph and no keybind label.
 */
const seedPartialHotbar = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__AIKAMI_E2E_SHEET__ = {
      abilities: {
        strength: { value: 15, modifier: 2 },
        dexterity: { value: 13, modifier: 1 },
        constitution: { value: 14, modifier: 2 },
        intelligence: { value: 10, modifier: 0 },
        wisdom: { value: 12, modifier: 1 },
        charisma: { value: 8, modifier: -1 },
      },
      skills: [],
      savingThrows: [],
      traits: { personalityTraits: '', ideals: '', bonds: '', flaws: '' },
      narrativeTraits: { likes: [], temptations: [], keys: [] },
      proficiencyBonus: 2,
      level: 1,
      xp: 0,
      hp: 12,
      maxHp: 12,
      attack: 0,
      defense: 15,
      classId: 'fighter',
      classFeatures: ['fighter_fighting_style', 'fighter_second_wind'],
      // Slots 1 and 3 assigned, slots 2/4/5/6 empty → partially-filled hotbar.
      hotbarSlots: ['fighter_second_wind', '', 'fighter_action_surge'],
    };
  });
  // The seed is read when the player-state service is constructed, so reload
  // the route after registering the init script.
  await page.reload({ waitUntil: 'domcontentloaded' });
};

// ── Suite ─────────────────────────────────────────────────────

export default defineConfig({
  id: 'framing_baseline',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'normal-boot-desktop',
      prompt: FRAMING_PROMPT,
      schema: FramingSchema,
      // Full-viewport capture (not the default 256x256 center-crop) so the
      // AC-1 framing claim is assessable.
      screenshotSelector: 'body',
      requiredTrueFields: ['worldFillsViewport', 'noUnboundedEmptySpace', 'crispPixelArt'],
    },
    {
      name: 'normal-boot-small-window',
      prompt: FRAMING_PROMPT,
      schema: FramingSchema,
      screenshotSelector: 'body',
      setupHook: setSmallWindow,
      requiredTrueFields: ['worldFillsViewport', 'noUnboundedEmptySpace'],
    },
    {
      name: 'default-boot',
      prompt: FRAMING_PROMPT,
      schema: FramingSchema,
      screenshotSelector: 'body',
      // Fresh browser context with no persisted campaign → transient/default
      // state. Shares the normal framing (AC-2): must still fill the viewport
      // and not show unbounded empty space even without a completed boot.
      requiredTrueFields: ['noUnboundedEmptySpace'],
    },
    {
      name: 'hotbar-hud',
      prompt: HOTBAR_PROMPT,
      schema: HotbarSchema,
      // The hotbar is a DOM overlay fixed at the bottom of the viewport — the
      // default canvas center-crop never contains it, so capture the full page.
      screenshotSelector: 'body',
      setupHook: seedPartialHotbar,
      requiredTrueFields: ['onlyAssignedSlots', 'hotbarOnscreen'],
    },
  ],
});
