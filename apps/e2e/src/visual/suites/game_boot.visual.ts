// apps/e2e/src/visual/suites/game_boot.visual.ts
// Game Boot Loading/Error Screen — declarative visual test suite.
//
// Captures the staged boot loading view and error recovery panel.
// Evaluates via AI to verify stage label, progress bar, and
// Retry/Return-to-menu buttons.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const GameBootSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  stageLabelVisible: Type.Boolean({
    description: 'Whether a boot stage label or loading text is visible on screen',
  }),
  progressVisible: Type.Boolean({
    description: 'Whether a progress indicator (progress bar) is visible on screen',
  }),
  retryButtonVisible: Type.Boolean({
    description: 'Whether a Retry button is visible (only expected in error state)',
  }),
  returnToMenuButtonVisible: Type.Boolean({
    description: 'Whether a Return to Menu button is visible (only expected in error state)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const BOOT_LOADING_PROMPT = [
  'This is a screenshot of the Aikami game boot loading screen.',
  '',
  'EXPECTED LAYOUT:',
  '- Centered content over a semi-transparent background overlay.',
  '- A stage label or detail text describing the current boot phase.',
  '- A progress bar (<progress> element) showing boot progression.',
  '- Stage "X of Y" counter text below the progress bar.',
  '',
  'EVALUATE:',
  '- Is there a visible loading text or stage label?',
  '- Is a progress bar visible?',
  '- No raw stack traces or error text should be visible.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const BOOT_ERROR_PROMPT = [
  'This is a screenshot of the Aikami game boot error recovery screen.',
  '',
  'EXPECTED LAYOUT:',
  '- A visible error panel with "Boot Failed" heading or similar error message.',
  '- A Retry button clearly visible.',
  '- A "Return to Menu" button clearly visible.',
  '- Dark-themed error styling (border, background tint).',
  '',
  'EVALUATE:',
  '- Is the error message visible?',
  '- Are both Retry and Return-to-menu buttons visible and clickable?',
  '- No raw stack traces.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'game_boot',
  route: '/game',
  waitCondition: 'pixi_loaded' as const,
  cases: [
    {
      name: 'boot-loading-stage',
      prompt: BOOT_LOADING_PROMPT,
      schema: GameBootSchema,
    },
    {
      name: 'boot-error-stage',
      prompt: BOOT_ERROR_PROMPT,
      schema: GameBootSchema,
    },
  ],
});
