// apps/e2e/src/visual/suites/onboarding_hints.visual.ts
//
// Onboarding Hints & Interaction Prompt — declarative visual test suite.
//
// Captures the HUD with interaction prompt and onboarding hint toast.
// Evaluates via AI to verify prompt label, hint text, close button,
// and reduced-motion behavior.
//
// Contract: C-327 AC-2, AC-3, AC-5

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

// ── Config ───────────────────────────────────────────────────

export default defineConfig({
  contract: 'C-327',
  title: 'Onboarding Hints and Interaction HUD',

  suites: [
    {
      label: 'HUD with interaction prompt visible',
      description: 'Game view with an active interaction prompt near a game object',
      page: '/game/dev',
      prompt: HUD_PROMPT,
      responseSchema: HUDVisualSchema,
      beforeSnapshot: async (page) => {
        // Inject mock interaction state to make the prompt visible
        await page.evaluate(() => {
          // Inject a synthetic INTERACTION_TARGET_CHANGED event payload
          // to trigger the prompt HUD
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
      label: 'HUD with onboarding hint toast visible',
      description: 'Game view with a visible onboarding tutorial hint',
      page: '/game/dev',
      prompt: HUD_PROMPT,
      responseSchema: HUDVisualSchema,
      beforeSnapshot: async (page) => {
        await page.evaluate(() => {
          // Inject a synthetic onboarding hint
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
      label: 'HUD with reduced motion (no animations)',
      description: 'Game view with prefers-reduced-motion enabled (AC-5)',
      page: '/game/dev',
      prompt: HUD_PROMPT,
      responseSchema: HUDVisualSchema,
      beforeSnapshot: async (page) => {
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
          const animName = await hintElement.evaluate((el) =>
            window.getComputedStyle(el).animationName,
          );
          expect(animName).toBe('none');
        }
      },
      afterSnapshot: async (page) => {
        // Reset to default
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      },
    },
  ],
});
