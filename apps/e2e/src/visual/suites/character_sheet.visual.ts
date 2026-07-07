// apps/e2e/src/visual/suites/character_sheet.visual.ts
// Character Sheet — declarative visual test suite.
//
// Captures the /dev/character-sheet sandbox with mock character data.
// Verifies abilities tab (6 scores + color-coded modifiers), skills tab
// (18 skills grouped by ability), traits tab (personality textareas + chips),
// Pro Mode (JSON display/validation), and full-page sandbox.
//
// Contract: C-232 Character Sheet & Traits System

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const AbilitiesSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  abilityCount: Type.Number({ description: 'Number of visible ability score rows (expected 6)' }),
  modifiersVisible: Type.Boolean({
    description: 'Whether ability modifiers are displayed with +/- signs and color coding',
  }),
  allAbilitiesLabelled: Type.Boolean({
    description: 'Whether all 6 abilities (STR/DEX/CON/INT/WIS/CHA) have visible labels',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const SkillsSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  skillCount: Type.Number({
    description: 'Number of visible skill rows (expected 18 total)',
  }),
  groupedByAbility: Type.Boolean({
    description: 'Whether skills appear grouped under their ability headings',
  }),
  proficiencyCheckboxes: Type.Boolean({
    description: 'Whether proficiency/expertise checkboxes are visible for each skill',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const TraitsSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  personalityTextareas: Type.Boolean({
    description: 'Whether personality traits, ideals, bonds, and flaws textareas are visible',
  }),
  narrativeChips: Type.Boolean({
    description:
      'Whether narrative trait chips (Likes, Temptations, Keys) with add/remove controls are visible',
  }),
  addInputVisible: Type.Boolean({
    description: 'Whether an input field for adding new chips is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const ProModeSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  jsonTextareaVisible: Type.Boolean({
    description: 'Whether the JSON editor textarea is visible when Pro Mode is toggled on',
  }),
  containsAbilityData: Type.Boolean({
    description: 'Whether the JSON content contains ability score data',
  }),
  saveValidateButton: Type.Boolean({
    description: 'Whether a Save & Validate button is visible in edit mode',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const SandboxSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  tabBarVisible: Type.Boolean({
    description: 'Whether the tab bar (Abilities/Skills/Traits) is visible',
  }),
  containerVisible: Type.Boolean({
    description: 'Whether the character sheet card/container is visible on the page',
  }),
  layoutIntact: Type.Boolean({
    description: 'Whether the overall layout is correct with no overlapping or cut-off elements',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const ABILITIES_PROMPT = [
  'This is a screenshot of the Aikami Character Sheet — Abilities tab (/dev/character-sheet sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Abilities tab is active (highlighted).',
  '- Six ability scores displayed in a 2×3 grid: STR, DEX, CON, INT, WIS, CHA.',
  '- Each ability shows: label (e.g. "STR"), score value (e.g. "16"), modifier (e.g. "+3").',
  '- Modifiers are color-coded: positive modifiers in green/teal, negative in red, zero in gray.',
  '- Mock data: STR 16(+3), DEX 14(+2), CON 14(+2), INT 12(+1), WIS 10(+0), CHA 8(-1).',
  '',
  'EVALUATE:',
  '- Are all 6 ability scores visible and correctly labelled?',
  '- Are modifiers displayed with the correct sign (+/-)?',
  '- Is the layout clean (2×3 grid, no overflow, no overlapping)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const SKILLS_PROMPT = [
  'This is a screenshot of the Aikami Character Sheet — Skills tab (/dev/character-sheet sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Skills tab is active.',
  '- 18 skills displayed, grouped under their parent ability (STR, DEX, etc.).',
  '- Each skill shows: name, proficiency checkbox, expertise checkbox, computed modifier.',
  '- Mock data has 5 proficient skills including Athletics with expertise.',
  '',
  'EVALUATE:',
  '- Are all 18 skills visible and grouped by ability?',
  '- Are the proficiency/expertise checkboxes rendered?',
  '- Is the layout scrollable and clean (no overflow)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const TRAITS_PROMPT = [
  'This is a screenshot of the Aikami Character Sheet — Traits tab (/dev/character-sheet sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Traits tab is active.',
  '- Personality section with textareas for: Personality Traits, Ideals, Bonds, Flaws.',
  '- Personality Traits textarea pre-filled with: "I always keep my word. I face problems head-on."',
  '- Narrative Traits section with chip-style add/remove for:',
  '  - LIKES (pre-populated: "Gold", "Ancient Lore", "Flattery")',
  '  - TEMPTATIONS (pre-populated: "Power", "Revenge")',
  '  - KEYS (pre-populated: "Lost Sister", "The Crown of Aldren")',
  '- Each chip has a remove (×) button.',
  '- An input field and add button for adding new chips.',
  '',
  'EVALUATE:',
  '- Are all 4 personality textareas visible and labelled?',
  '- Are the narrative trait chips displayed with their content?',
  '- Is the add/remove interface visible and functional-looking?',
  '- Is the layout clean with proper spacing?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const PRO_MODE_PROMPT = [
  'This is a screenshot of the Aikami Character Sheet — Pro Mode toggled on.',
  '',
  'EXPECTED LAYOUT:',
  '- A JSON editor textarea is visible, populated with the character data as JSON.',
  '- The JSON contains ability score data (e.g. "strength", "value": 16).',
  '- A "Save & Validate" button is available for validating edits.',
  '- Pro Mode toggle switch should be in the "on" position.',
  '',
  'EVALUATE:',
  '- Is the JSON textarea visible and populated?',
  '- Does the content look like valid JSON with character data?',
  '- Is there a save/validate control available?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const SANDBOX_PROMPT = [
  'This is a full-page screenshot of the Aikami Character Sheet dev sandbox (/dev/character-sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- The sandbox page has a character sheet card/container.',
  '- A tab bar is visible with at least "Abilities", "Skills", and "Traits" tabs.',
  '- Layout is responsive and fits within the viewport.',
  '- A Pro Mode toggle is visible.',
  '- Equipment slots are visible on the right side.',
  '- An AI Preview button is accessible.',
  '',
  'EVALUATE:',
  '- Is the character sheet card fully visible?',
  '- Are the tabs visible and properly styled?',
  '- Is the overall layout clean and well-spaced?',
  '- Is the page scrollable without horizontal overflow?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ──────────────────────────────────────────────

const setupProMode = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector('text=Pro Mode', { timeout: 10_000 });

  // Toggle Pro Mode on
  const proModeToggle = page.locator('input[type="checkbox"].toggle').first();
  const isChecked = await proModeToggle.isChecked();
  if (!isChecked) {
    await proModeToggle.click();
  }

  // Wait for JSON textarea to appear
  await page.waitForTimeout(500);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'character-sheet',
  route: '/dev/character-sheet',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Character Sheet — Abilities Tab',
      prompt: ABILITIES_PROMPT,
      schema: AbilitiesSchema,
    },
    {
      name: 'Character Sheet — Skills Tab',
      prompt: SKILLS_PROMPT,
      schema: SkillsSchema,
      setupHook: async (page) => {
        await page.waitForSelector('text=Skills', { timeout: 10_000 });
        await page.locator('text=Skills').click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Character Sheet — Traits Tab',
      prompt: TRAITS_PROMPT,
      schema: TraitsSchema,
      setupHook: async (page) => {
        await page.waitForSelector('text=Traits', { timeout: 10_000 });
        await page.locator('text=Traits').click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Character Sheet — Pro Mode',
      prompt: PRO_MODE_PROMPT,
      schema: ProModeSchema,
      setupHook: setupProMode,
    },
    {
      name: 'Character Sheet — Sandbox Full Page',
      prompt: SANDBOX_PROMPT,
      schema: SandboxSchema,
    },
  ],
});
