// apps/e2e/src/visual/suites/agent_editor.visual.ts
// Agent Editor — declarative visual test suite.
//
// Captures the /dev/agent-editor sandbox with the agent list and
// the agent editor form filled with all fields.
//
// Contract: C-247 Custom Agent Creation

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const ListSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  builtInSectionVisible: Type.Boolean({
    description: 'Whether the Built-in Agents section is visible with agent cards',
  }),
  customSectionVisible: Type.Boolean({
    description: 'Whether the Custom Agents section header is visible',
  }),
  createButtonVisible: Type.Boolean({
    description: 'Whether the Create Agent button is visible',
  }),
  atLeastThreeBuiltInCards: Type.Boolean({
    description: 'Whether at least 3 built-in agent cards are visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const EditorSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  formVisible: Type.Boolean({
    description: 'Whether the agent editor form modal is visible',
  }),
  nameFieldVisible: Type.Boolean({
    description: 'Whether the name input field is visible',
  }),
  phaseDropdownVisible: Type.Boolean({
    description: 'Whether the phase dropdown is visible',
  }),
  promptTextareaVisible: Type.Boolean({
    description: 'Whether the prompt template textarea is visible',
  }),
  schemaTextareaVisible: Type.Boolean({
    description: 'Whether the output schema textarea is visible',
  }),
  testRunSectionVisible: Type.Boolean({
    description: 'Whether the test run section is visible at the bottom',
  }),
  saveButtonVisible: Type.Boolean({
    description: 'Whether the save/create button is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const LIST_PROMPT = [
  'This is a screenshot of the Aikami Agent List settings tab (/dev/agent-editor sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Page title "Agents" at the top left.',
  '- "Create Agent" button at the top right.',
  '- "Built-in Agents" section with a count badge and at least 6 agent cards below.',
  '- Each built-in card shows: agent name, phase badge (Pre-processing or Post-processing), "Built-in" badge, and a toggle switch.',
  '- "Custom Agents" section header below with a count badge.',
  '- Cards use a bordered card style with compact padding.',
  '',
  'EVALUATE:',
  '- Is the Agents header and Create Agent button visible?',
  '- Are the built-in agent cards listed with their badges and toggles?',
  '- Is the layout clean with proper spacing between cards?',
  '- Is there no overlapping or broken layout?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const EDITOR_PROMPT = [
  'This is a screenshot of the Aikami Agent Editor modal (/dev/agent-editor sandbox, create mode).',
  '',
  'EXPECTED LAYOUT:',
  '- A modal dialog with title "Create Agent" at the top.',
  '- Form fields in order: Name (required, with *), Description, Folder, Phase dropdown, Prompt Template textarea, Output Schema textarea, Result Type dropdown, Connection Override dropdown, Timeout slider.',
  '- Cancel and Create Agent buttons at the bottom.',
  '- Test Run section with a text input and Run Test button below the form.',
  '- The modal has a semi-transparent backdrop overlay.',
  '',
  'EVALUATE:',
  '- Is the modal dialog centered and visible?',
  '- Are all form fields (name, description, folder, phase, prompt, schema, result type, connection, timeout) visible?',
  '- Is the layout organized with proper labels?',
  '- Is the backdrop overlay visible behind the modal?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ──────────────────────────────────────────────

const setupEditor = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector('text=Create Agent', { timeout: 10_000 });
  await page.locator('text=Create Agent').click();
  await page.waitForTimeout(500);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'agent-editor',
  route: '/dev/agent-editor',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Agent Editor — List View',
      prompt: LIST_PROMPT,
      schema: ListSchema,
    },
    {
      name: 'Agent Editor — Create Form',
      prompt: EDITOR_PROMPT,
      schema: EditorSchema,
      setupHook: setupEditor,
    },
  ],
});
