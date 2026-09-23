// apps/e2e/src/visual/suites/dialogue_stage_fixtures.ts
//
// Shared helpers for the C-547 dialogue-stage visual matrix.
//
// NOT a suite: the runner only loads `*.visual.ts`, so this module is imported
// by the dialogue suites. It applies the SAME mechanisms the product uses to
// review the stage across viewport, text scale and theme — it does not fake a
// separate layout. The prompts deliberately ask neutral questions (plan §8):
// they describe what to look for, never assert that the layout is correct.

import type { Page } from 'playwright';
import { Type } from 'typebox';

/** The dialogue stage root. */
export const STAGE_SELECTOR = '[data-testid="dialogue-overlay"]';

/** A setup hook that receives the Playwright page. */
export type StageHook = (page: Page) => Promise<void>;

/** Composes setup hooks, in order. */
export const withStageHooks =
  (...hooks: StageHook[]): StageHook =>
  async (page) => {
    for (const hook of hooks) {
      await hook(page);
    }
  };

/** Resizes the viewport to a fixed review size. */
export const atViewport =
  (width: number, height: number): StageHook =>
  async (page) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
  };

/**
 * Applies the product's real text-scale mechanism: the root font size drives
 * `rem`-based game geometry (the ViewModel probes it with a ResizeObserver).
 */
export const atTextScale =
  (percent: number): StageHook =>
  async (page) => {
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale}%`;
    }, percent);
    await page.waitForTimeout(400);
  };

/** Switches the theme through the app's `data-theme` contract. */
export const atTheme =
  (theme: 'light' | 'dark'): StageHook =>
  async (page) => {
    await page.evaluate((value) => {
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    await page.waitForTimeout(400);
  };

/** Clicks the stage's full-view toggle. */
export const enterFullView: StageHook = async (page) => {
  await page.getByRole('button', { name: 'Enter full view' }).click();
  await page.waitForTimeout(400);
};

/**
 * Hides the sandbox devtools panel so the stage itself is the captured
 * subject. Dev-only harness: the panel is not part of the production surface.
 */
export const closeDevTools: StageHook = async (page) => {
  // Clicked via evaluate: a real click is blocked by the sandbox shell chrome
  // sitting above the panel, and the panel must not cover the stage.
  await page
    .evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="devtools-close"]')?.click();
    })
    .catch(() => {});
  await page.waitForTimeout(300);
};

// ── Production /game host evidence ──────────────────────────────────────

/**
 * Boots the production `/game` route against the Emberwatch candidate plane and
 * walks to a real NPC until a real dialogue opens.
 *
 * The game's movement bindings are WASD (its own onboarding hint says "Use W to
 * move"). Driving it with arrow keys leaves the player at spawn, which is why
 * this case previously timed out waiting for a dialogue overlay.
 */
export const walkToEmberwatchNpc: StageHook = async (page) => {
  await page.goto('http://localhost:5274/game?forceOffline=1', { waitUntil: 'domcontentloaded' });
  // The overlay layer mounts only once the game view is up.
  await page.locator('[data-testid="game-ui-overlay-layer"]').waitFor({
    state: 'attached',
    timeout: 60_000,
  });
  const overlay = page.locator(STAGE_SELECTOR);
  // World boot (content preload + entity spawn) finishes after the canvas
  // appears, and input stays locked until then — walking too early burns the
  // whole walk budget against a locked input.
  await page.waitForTimeout(30_000);

  const pattern = [
    'w',
    'w',
    'd',
    'w',
    'd',
    's',
    'd',
    'w',
    'a',
    'w',
    'a',
    's',
    'a',
    'w',
    'd',
    's',
    'a',
    'w',
    'd',
  ] as const;

  for (let i = 0; i < 150; i++) {
    if ((await overlay.count()) > 0) {
      return;
    }
    const key = pattern[i % pattern.length] as string;
    await page.keyboard.down(key);
    await page.waitForTimeout(140);
    await page.keyboard.up(key);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }

  await overlay.waitFor({ state: 'visible', timeout: 30_000 });
};

// ── Neutral evaluation schema + prompt ──────────────────────────────────

/**
 * Neutral stage-review schema. Every field is an observable question, not a
 * correctness assertion; the evaluator is never told the layout is right.
 */
export const StageReviewSchema = Type.Object({
  score: Type.Number({ description: '0-100 confidence that the surface is readable and usable' }),
  speakerIdentityVisible: Type.Boolean({
    description: 'Whether a speaker name is visible together with a portrait/identity mark',
  }),
  transcriptVisible: Type.Boolean({
    description: 'Whether conversation text (a message or streaming text) is visible',
  }),
  composerVisible: Type.Boolean({
    description: 'Whether a message input and a send control are visible at the same time',
  }),
  spaceMatchesContent: Type.Boolean({
    description:
      'Whether the amount of empty conversation area is proportionate to the amount of text shown',
  }),
  issues: Type.Array(Type.String(), { description: 'List of observed visual or usability issues' }),
});

/**
 * Neutral stage prompt. The questions mirror plan §8's examples and avoid
 * telling the evaluator that the current layout is correct.
 */
export const STAGE_REVIEW_PROMPT = [
  'This is a screenshot of the Aikami in-game dialogue surface.',
  '',
  'Answer only what you can observe:',
  '- Where is the speaker identity shown, and is it attached to the conversation?',
  '- What action can the player take next?',
  '- Is the message composer (input + send control) visible at the same time as the conversation?',
  '- Is space allocated according to the content, or is a short line surrounded by a large empty area?',
  '- Does the stage look like a compact panel anchored to the bottom of the screen?',
  '',
  'Report the issues you actually see. Do not assume any layout is intended or correct.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');
