// apps/e2e/src/visual/suites/dialogue_streaming.visual.ts
// biome-ignore-all lint/style/useNamingConvention: URL search parameter keys
// Dialogue Streaming Tool Orchestrator — declarative visual test suite.
//
// Validates that streaming AI tool invocations are rendered smoothly
// in the dialogue overlay without layout flashes or blank frames.
// Captures the dialogue sandbox with simulated streaming mutations
// and evaluates via AI to verify progressive tool state changes.
//
// C-547 adds a review matrix for the compact dialogue stage: short line,
// long streaming reply and full view at 1280×720, 1920×1080, a compact
// 800×600 viewport, 200% text and an alternate theme. Those cases ask neutral
// questions (plan §8) and never assert the layout is correct.
//
// Contract: C-193 Client Tool Streaming Orchestrator
//   AC-3: Unidirectional View Synchronization — spatial variables
//         propagate to the view layer via flat shallow reassignments
//         against unproxied $state.raw targets.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import {
  atTextScale,
  atTheme,
  atViewport,
  closeDevTools,
  enterFullView,
  STAGE_REVIEW_PROMPT,
  STAGE_SELECTOR,
  StageReviewSchema,
  withStageHooks,
} from './dialogue_stage_fixtures';

// ── Schema ───────────────────────────────────────────────────

const DialogueStreamingSchema = Type.Object({
  score: Type.Number({
    description: '0-100 score of visual correctness',
  }),
  dialogueVisible: Type.Boolean({
    description: 'Whether the dialogue overlay is visible with NPC name and greeting text',
  }),
  tokensStreaming: Type.Boolean({
    description:
      'Whether streaming textual characters are rendering token-by-token without visible gaps',
  }),
  coordinateOverlay: Type.Boolean({
    description: 'Whether the target NPC coordinate overlay indicators are visible and updating',
  }),
  noLayoutFlashes: Type.Boolean({
    description:
      'Whether the UI is free of layout flashes, blank bounding frames, or visual glitches during active parsing',
  }),
  issues: Type.Array(Type.String(), {
    description: 'List of visual issues detected',
  }),
});

// ── Prompt ───────────────────────────────────────────────────

const STREAMING_PROMPT = [
  'This is a screenshot of the Aikami dialogue sandbox with simulated streaming AI tool invocations.',
  '',
  'EXPECTED BEHAVIOR:',
  '- The dialogue overlay should be visible with NPC name and greeting text (e.g., Elder Thrain).',
  '- Streaming textual characters should render token-by-token in the dialogue area.',
  '- Target NPC coordinate overlay indicators (x, y position panels) should be visible and updating.',
  '- The UI should be free of layout flashes, blank bounding frames, or visual glitches during active parsing.',
  '- The dialogue box should have a stable layout — no jumping or resizing as text streams in.',
  '- Any devtool controls (Dice Outcome, Mock AI toggle, NPC Preset selector, Interaction Mode) should be visible below.',
  '',
  'SCORING:',
  '- Score 90+ if the interface smoothly renders streaming textual characters token-by-token while simultaneously updating the target NPC coordinate overlay indicators.',
  '- Score 70-89 if streaming works but coordinate overlays are missing or have visible glitches.',
  '- Score 50-69 if the dialogue overlay is visible but streaming is broken or layout flashes occur.',
  '- Score below 50 if the page is blank, the overlay is not visible, or there are major rendering issues.',
  '',
  'NO layout flashes or blank bounding frames are permissible during active parsing increments.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ──────────────────────────────────────────────

/**
 * Waits for the dialogue sandbox to fully load and starts simulated
 * streaming by interacting with the devtool controls.
 *
 * Clicks the "Send" button on the dialogue overlay to trigger
 * streaming AI tool mutations, then waits for the stream to
 * produce visible output.
 */
const simulateStream = async (page: import('playwright').Page): Promise<void> => {
  // Wait for the dialogue overlay to appear
  await page.waitForSelector(STAGE_SELECTOR, {
    timeout: 15000,
  });

  // Wait a beat for the initial NPC greeting to render
  await page.waitForTimeout(500);

  // Type a message into the composer and send it.
  const inputElement = page.locator('textarea').first();
  if (await inputElement.isVisible()) {
    await inputElement.click();
    await inputElement.fill('Tell me about the surrounding area.');
  }

  // The shared composer's send affordance is an icon button labelled "Send".
  const sendButton = page.getByRole('button', { name: 'Send' }).first();
  if (await sendButton.isVisible()) {
    await sendButton.click();
  }

  // Wait for streaming to produce visible output (characters appearing)
  await page.waitForTimeout(3000);
};

/** Waits for the stage to render a settled short greeting line. */
const waitForStage = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector(STAGE_SELECTOR, { timeout: 15000 });
  await page.waitForTimeout(800);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'dialogue_streaming',
  route: '/dev/sandbox/dialogue',
  waitCondition: 'game_ready',
  waitSelector: STAGE_SELECTOR,
  cases: [
    {
      name: 'partial_json_avatar_hydration',
      searchParams: { simulate_stream: 'true' },
      prompt: STREAMING_PROMPT,
      schema: DialogueStreamingSchema,
      setupHook: simulateStream,
    },
    // ── C-547 stage review matrix ────────────────────────────
    {
      name: 'short_line_default_1280x720',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(closeDevTools, waitForStage),
    },
    {
      name: 'long_streaming_reply',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(closeDevTools, simulateStream),
    },
    {
      name: 'full_view',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(closeDevTools, waitForStage, enterFullView),
    },
    {
      name: 'compact_800x600',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(atViewport(800, 600), closeDevTools, waitForStage),
    },
    {
      name: 'desktop_1920x1080',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(atViewport(1920, 1080), closeDevTools, waitForStage),
    },
    {
      name: 'text_200pct',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(atTextScale(200), closeDevTools, waitForStage),
    },
    {
      name: 'theme_dark',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: withStageHooks(atTheme('dark'), closeDevTools, waitForStage),
    },
    {
      name: 'dice_skill_check',
      prompt: STAGE_REVIEW_PROMPT,
      schema: StageReviewSchema,
      screenshotSelector: STAGE_SELECTOR,
      setupHook: async (page) => {
        await page.waitForSelector(STAGE_SELECTOR, { timeout: 15_000 });
        await page.getByRole('button', { name: /Force Dice Roll/i }).click();
        await page.waitForTimeout(1200);
      },
    },
  ],
});
