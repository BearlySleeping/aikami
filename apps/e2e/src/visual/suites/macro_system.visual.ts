// apps/e2e/src/visual/suites/macro_system.visual.ts
// Macro Template Sandbox — declarative visual test suite.
//
// Captures the /dev/macros sandbox page to verify template editing,
// macro autocomplete, live resolution output, and preset management.
//
// Contract: C-237

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const MacroSystemSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  splitPanelVisible: Type.Boolean({
    description: 'Whether the left (editor) and right (output) panels are visible',
  }),
  templateEditorVisible: Type.Boolean({
    description: 'Whether the template textarea with macro placeholders is visible',
  }),
  resolvedOutputVisible: Type.Boolean({
    description: 'Whether the resolved output panel shows substituted text',
  }),
  presetSectionVisible: Type.Boolean({
    description: 'Whether the preset editor section at the bottom is rendered',
  }),
  layoutCorrect: Type.Boolean({
    description: 'Whether the 3-panel layout (editor, output, presets) is properly structured',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt shared by all cases ───────────────────────────────

const MACRO_PROMPT = [
  'This is a screenshot from the Aikami Macro Template Sandbox (/dev/macros).',
  '',
  'EXPECTED ELEMENTS:',
  '- Header: "Macro Template Sandbox" title with instructional subtitle.',
  '- Left panel: Template textarea with {{char}}, {{personality}} style macros.',
  '- Left panel: Context mock input fields labelled userName, characterName, etc.',
  '- Right panel: Resolved Output panel showing macro-expanded text.',
  '- Bottom panel: Prompt Presets section with preset list and editor.',
  '- DaisyUI dark theme with form controls (inputs, textareas, selects, buttons).',
  '',
  'EVALUATE:',
  '- Is the split-panel layout rendered and properly aligned?',
  '- Are macro placeholders visible in the template editor?',
  '- Is the resolved output showing substituted text (not raw {{macros}})?',
  '- Is the preset editor section visible and functional-looking?',
  '- Are there any overlapping elements or layout issues?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Case-specific prompts ────────────────────────────────────

const CASE_PROMPTS: Record<string, string> = {
  default:
    'This shows the initial sandbox state — default template with context placeholders, live-resolved output, and built-in presets listed in the sidebar.',
  resolution:
    'After typing a custom template "Hello {{user}}, meet {{char}}!", the right panel should show resolved text: "Hello Alice, meet Thorn!" with updated character count.',
};

// ── Selectors to mask (non-deterministic UI elements) ────────

const MACRO_MASK_SELECTORS = ['.animate-pulse', '.loading'];

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'macro-system',
  route: '/dev/macros',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Macro Sandbox — Default State',
      prompt: [MACRO_PROMPT, '', CASE_PROMPTS.default].join('\n'),
      schema: MacroSystemSchema,
      // Screenshot the entire sandbox viewport — no canvas, DOM-only page
      screenshotSelector: 'h1',
      mask: MACRO_MASK_SELECTORS,
    },
    {
      name: 'Macro Sandbox — Live Resolution',
      prompt: [MACRO_PROMPT, '', CASE_PROMPTS.resolution].join('\n'),
      schema: MacroSystemSchema,
      screenshotSelector: 'h1',
      mask: MACRO_MASK_SELECTORS,
      // Setup: type a custom template to verify live resolution updates
      setupHook: async (page) => {
        // Clear and type a custom template
        const textarea = page.locator('.textarea.textarea-bordered').first();
        await textarea.fill('Hello {{user}}, meet {{char}}!');
        // Wait for Svelte reactivity to update the resolved output
        await page.waitForTimeout(1000);
      },
    },
  ],
});
