// apps/e2e/src/visual/suites/dialogue_streaming.visual.ts
// biome-ignore-all lint/style/useNamingConvention: URL search parameter keys
// Dialogue Streaming Tool Orchestrator — declarative visual test suite.
//
// Validates that streaming AI tool invocations are rendered smoothly
// in the dialogue overlay without layout flashes or blank frames.
// Captures the dialogue sandbox with simulated streaming mutations
// and evaluates via AI to verify progressive tool state changes.
//
// Contract: C-193 Client Tool Streaming Orchestrator
//   AC-3: Unidirectional View Synchronization — spatial variables
//         propagate to the view layer via flat shallow reassignments
//         against unproxied $state.raw targets.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

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
  await page.waitForSelector('[data-testid="dialogue-overlay"]', {
    timeout: 15000,
  });

  // Wait a beat for the initial NPC greeting to render
  await page.waitForTimeout(500);

  // Click the input field and type a test message
  const inputSelector =
    '[data-testid="dialogue-input"] textarea, [data-testid="dialogue-input"] input';
  const inputElement = page.locator(inputSelector).first();
  if (await inputElement.isVisible()) {
    await inputElement.click();
    await inputElement.fill('Tell me about the surrounding area.');
  }

  // Click the send button to trigger streaming
  const sendSelector = '[data-testid="dialogue-send"], button:has-text("Send")';
  const sendButton = page.locator(sendSelector).first();
  if (await sendButton.isVisible()) {
    await sendButton.click();
  }

  // Wait for streaming to produce visible output (characters appearing)
  await page.waitForTimeout(3000);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'dialogue_streaming',
  route: '/dev/sandbox/dialogue',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'partial_json_avatar_hydration',
      searchParams: { simulate_stream: 'true' },
      prompt: STREAMING_PROMPT,
      schema: DialogueStreamingSchema,
      setupHook: simulateStream,
    },
  ],
});
