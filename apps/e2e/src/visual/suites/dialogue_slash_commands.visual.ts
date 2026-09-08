// apps/e2e/src/visual/suites/dialogue_slash_commands.visual.ts
// biome-ignore-all lint/style/useNamingConvention: URL search parameter keys
// Dialogue Slash Commands Visual Suite — declarative visual test.
//
// Validates that slash commands render inline within the dialogue overlay:
// a `/generate` image block appears in the thread, and the generated image is
// visible. Evaluated via AI against the OpenRouter-backed visual runner.
//
// Contract: C-501 Dialogue Slash Commands

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const DialogueSlashCommandsSchema = Type.Object({
  score: Type.Number({
    description: '0-100 score of visual correctness',
  }),
  dialogueVisible: Type.Boolean({
    description: 'Whether the dialogue overlay is visible with NPC name and greeting text',
  }),
  imageBlockVisible: Type.Boolean({
    description: 'Whether an inline image block appears in the dialogue thread after /generate',
  }),
  generatedImageVisible: Type.Boolean({
    description:
      'Whether the generated scene image (or its generating skeleton) is visible inline in the thread',
  }),
  noLayoutFlashes: Type.Boolean({
    description:
      'Whether the UI is free of layout flashes, blank bounding frames, or visual glitches',
  }),
  issues: Type.Array(Type.String(), {
    description: 'List of visual issues detected',
  }),
});

// ── Prompt ───────────────────────────────────────────────────

const SLASH_COMMANDS_PROMPT = [
  'This is a screenshot of the Aikami dialogue sandbox after a player typed a slash command.',
  '',
  'EXPECTED BEHAVIOR:',
  '- The dialogue overlay should be visible with the NPC name (e.g., Elder Thrain) and greeting text.',
  '- After typing /generate, an inline image block should appear within the dialogue thread — either a generating skeleton placeholder or a rendered scene image.',
  '- The generated image (alt "Generated scene") should be visible inline in the conversation history.',
  '- The UI should be free of layout flashes, blank bounding frames, or visual glitches.',
  '- Slash command input should not produce a text NPC response bubble.',
  '',
  'SCORING:',
  '- Score 90+ if the generated image is visible inline in the dialogue thread and the layout is clean.',
  '- Score 70-89 if an image block is present but the rendered image is missing or mispositioned.',
  '- Score 50-69 if the dialogue overlay is visible but the image block is absent or broken.',
  '- Score below 50 if the page is blank, the overlay is not visible, or there are major rendering issues.',
  '',
  'NO layout flashes or blank bounding frames are permissible.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hook ───────────────────────────────────────────────

/**
 * Waits for the dialogue sandbox to load, then types and sends a
 * `/generate` slash command so the inline image block renders.
 */
const triggerGenerate = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector('[data-testid="dialogue-overlay"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  const inputSelector =
    '[data-testid="dialogue-input"] textarea, [data-testid="dialogue-input"] input';
  const inputElement = page.locator(inputSelector).first();
  if (await inputElement.isVisible()) {
    await inputElement.click();
    await inputElement.fill('/generate a forest clearing at dusk');
  }

  const sendSelector = '[data-testid="dialogue-send"], button:has-text("Send")';
  const sendButton = page.locator(sendSelector).first();
  if (await sendButton.isVisible()) {
    await sendButton.click();
  }

  // Wait for the image block to render (generating or done).
  await page.waitForTimeout(4000);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'dialogue_slash_commands',
  route: '/dev/sandbox/dialogue',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'generate_inline_image',
      searchParams: { simulate_stream: 'true' },
      prompt: SLASH_COMMANDS_PROMPT,
      schema: DialogueSlashCommandsSchema,
      setupHook: triggerGenerate,
    },
  ],
});
