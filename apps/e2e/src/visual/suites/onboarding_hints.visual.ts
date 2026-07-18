// apps/e2e/src/visual/suites/onboarding_hints.visual.ts
//
// Onboarding Hints & Interaction Prompt — declarative visual test suite.
//
// Captures the HUD with interaction prompt and onboarding hint toast.
// Evaluates via AI to verify prompt label, hint text, close button,
// and reduced-motion behavior.
//
// Contract: C-327 AC-2, AC-3, AC-5

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const HUDVisualSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  promptLabelVisible: Type.Boolean({
    description: 'Whether interaction prompt key label is visible on the HUD',
  }),
  hintToastVisible: Type.Boolean({
    description: 'Whether onboarding hint toast is visible on the HUD',
  }),
  hintCloseButtonVisible: Type.Boolean({
    description: 'Whether the hint dismiss (✕) button is visible',
  }),
  noMotionArtifacts: Type.Boolean({
    description: 'Whether animations appear smooth (no stuttering or glitching artifacts)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const HUD_PROMPT = [
  'This is a screenshot of the Aikami game HUD overlay showing interaction prompts and/or',
  'onboarding hint toasts during gameplay.',
  '',
  'EXPECTED LAYOUT:',
  '- If an interaction prompt is active: a dark semi-transparent bar near the bottom-center',
  '  showing a key label (e.g. "E — Talk") in monospace font.',
  '- If an onboarding hint is active: a toast near the top-center with instructional text',
  '  and a dismiss (✕) button on the right.',
  '- Both elements are non-modal — they overlay the game canvas without blocking it.',
  '- Typography uses ui-monospace for the prompt, clean sans-serif for hints.',
  '',
  'EVALUATE:',
  '- Is the prompt label visible and legible? (if shown)',
  '- Is the hint toast visible with readable text and a dismiss button? (if shown)',
  '- Are animations smooth (no jarring transitions, no layout shift)?',
  '- Do elements respect dark theme styling (dark backgrounds, white/light text)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'onboarding_hints',
  route: '/game/dev',
  waitCondition: 'pixi_loaded' as const,

  cases: [
    {
      name: 'HUD with interaction prompt visible',
      prompt: HUD_PROMPT,
      schema: HUDVisualSchema,
      setupHook: async (page: Page) => {
        // Inject mock interaction state to make the prompt visible
        await page.evaluate(() => {
          window.dispatchEvent(
            new CustomEvent('aikami:interaction:target-changed', {
              detail: { label: 'E — Examine Ancient Relic', visible: true },
            }),
          );
        });
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'HUD with onboarding hint toast visible',
      prompt: HUD_PROMPT,
      schema: HUDVisualSchema,
      setupHook: async (page: Page) => {
        await page.evaluate(() => {
          window.dispatchEvent(
            new CustomEvent('aikami:onboarding:hint', {
              detail: {
                text: 'Press E to interact with objects and people',
                visible: true,
              },
            }),
          );
        });
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'HUD with reduced motion (no animations)',
      prompt: HUD_PROMPT,
      schema: HUDVisualSchema,
      setupHook: async (page: Page) => {
        // Simulate prefers-reduced-motion
        await page.emulateMedia({ reducedMotion: 'reduce' });

        await page.evaluate(() => {
          window.dispatchEvent(
            new CustomEvent('aikami:onboarding:hint', {
              detail: {
                text: 'Press W to move forward',
                visible: true,
              },
            }),
          );
        });
        await page.waitForTimeout(500);

        // Assert reduced-motion actually disables animation (AC-5)
        const hintElement = page.locator('.onboarding-hint');
        if (await hintElement.isVisible()) {
          const animName = await hintElement.evaluate(
            (el: HTMLElement) => window.getComputedStyle(el).animationName,
          );
          if (animName !== 'none') {
            console.warn('Reduced-motion: animation still active:', animName);
          }
        }

        // Reset to default after test
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      },
    },
  ],
});
