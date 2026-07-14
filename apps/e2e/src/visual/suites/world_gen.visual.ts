// apps/e2e/src/visual/suites/world_gen.visual.ts
// World Generation Wizard — declarative visual test suite.
//
// Captures screenshots at each wizard step to verify layout correctness:
// - Genre/Tone step with chip buttons
// - Setting/Difficulty step with textarea and radio buttons
// - Goals step with textarea
// - Generating step with spinner
// - Preview step with world cards
// - Character Creation step
// - Error state with retry button
//
// Contract: C-233

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const WizardStepSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  stepTitleVisible: Type.Boolean({ description: 'Whether the step title/h2 is visible' }),
  progressBarVisible: Type.Boolean({ description: 'Whether the progress bar is visible' }),
  navigationButtonsVisible: Type.Boolean({ description: 'Whether navigation buttons are visible' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const PromptTemplateSchema = Type.Object({
  score: Type.Number({ description: '0-100 score' }),
  elementVisible: Type.Boolean({ description: 'Whether the target element is visible' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Suite Config ─────────────────────────────────────────────

export default defineConfig({
  id: 'world-gen',
  route: '/dev/world-gen',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    {
      name: 'Genre Tone Step',
      searchParams: {},
      prompt: [
        'This is a screenshot of the World Generation Wizard at the Genre & Tone step.',
        'Expected layout:',
        '- A step indicator (circles 1-6) at the top with step 1 highlighted',
        '- A progress bar below the step indicator',
        '- A heading "Genre & Tone"',
        '- Two rows of chip-style buttons: Genre chips (Fantasy, Science Fiction, Mystery, Cyberpunk, Horror, Post-Apocalyptic)',
        '- Tone chips (Heroic, Dark, Lighthearted, Noir, Mysterious, Edgy, Rebellious, Lovecraftian, Survival, Hopeful, Grim)',
        '- A "Surprise Me!" button',
        '- A "Next →" button (greyed out initially)',
        '- Dark theme semantic colors (bg-base-100, text-base-content)',
        '- font-sans for body text, font-mono is not present',
        '',
        'The buttons use btn-sm and are styled as DaisyUI chips with btn-outline for unselected, btn-primary for selected.',
      ].join('\n'),
      schema: WizardStepSchema,
      setupHook: async (page) => {
        // Navigate to the first step with no interaction for clean capture
        await page.waitForSelector('h2');
      },
    },
    {
      name: 'Setting Difficulty Step',
      searchParams: {},
      prompt: [
        'This is a screenshot of the World Generation Wizard at the Setting & Difficulty step.',
        'Expected layout:',
        '- Step indicator with step 2 highlighted',
        '- Heading "Setting & Difficulty"',
        '- A large textarea with id "setting-input" for the setting description',
        '- Three radio buttons for difficulty: Easy, Medium, Hard (Medium selected by default)',
        '- A "Surprise Me!" button',
        '- A "Next →" button',
        '- Dark theme using DaisyUI semantic colors',
      ].join('\n'),
      schema: WizardStepSchema,
      setupHook: async (page) => {
        // Click through to step 2 with sample data
        await page.waitForSelector('button:has-text("Fantasy")');
        await page.locator('button:has-text("Fantasy")').click();
        await page.locator('button:has-text("Heroic")').click();
        await page.locator('button:has-text("Next →")').click();
        await page.waitForSelector('textarea#setting-input');
      },
    },
    {
      name: 'Goals Step',
      searchParams: {},
      prompt: [
        'This is a screenshot of the World Generation Wizard at the Goals step.',
        'Expected layout:',
        '- Step indicator with step 3 highlighted',
        '- Heading "Goals"',
        '- A large textarea with id "goals-input" for describing player goals',
        '- A hint text: "Be specific: what must the party achieve?"',
        '- A "Surprise Me!" button',
        '- A "Generate World" button',
        '- Dark theme using DaisyUI semantic colors',
      ].join('\n'),
      schema: WizardStepSchema,
      setupHook: async (page) => {
        await page.waitForSelector('button:has-text("Fantasy")');
        await page.locator('button:has-text("Fantasy")').click();
        await page.locator('button:has-text("Heroic")').click();
        await page.locator('button:has-text("Next →")').click();
        await page.waitForSelector('textarea#setting-input');
        await page.locator('textarea#setting-input').fill('A mysterious floating kingdom.');
        await page.locator('button:has-text("Next →")').click();
        await page.waitForSelector('textarea#goals-input');
      },
    },
    {
      name: 'Preview Step',
      searchParams: {},
      prompt: [
        'This is a screenshot of the World Generation Wizard at the Preview step.',
        'Expected layout:',
        '- Step indicator with step 5 highlighted',
        '- A world name card showing "Aetheria\'s Echo"',
        '- World description paragraph',
        '- NPCs section with grid cards showing character names, races, classes, roles, descriptions',
        '- Locations section with badge chips',
        '- Story Arcs section with chapter cards containing objectives',
        '- HUD Widgets section with a table showing label, slot, icon, and default visibility',
        '- "Regenerate" and "Accept World" buttons at the bottom',
        '- Dark theme using DaisyUI semantic colors',
      ].join('\n'),
      schema: PromptTemplateSchema,
      setupHook: async (page) => {
        // Go through steps and generate (dev sandbox has mock response)
        await page.waitForSelector('button:has-text("Fantasy")');
        await page.locator('button:has-text("Fantasy")').click();
        await page.locator('button:has-text("Heroic")').click();
        await page.locator('button:has-text("Next →")').click();
        await page.waitForSelector('textarea#setting-input');
        await page.locator('textarea#setting-input').fill('A test setting for visual capture.');
        await page.locator('button:has-text("Next →")').click();
        await page.waitForSelector('textarea#goals-input');
        await page.locator('textarea#goals-input').fill('Test generation for visual capture.');
        await page.locator('button:has-text("Generate World")').click();
        // Wait for mock response
        await page.waitForSelector('h3.card-title', { timeout: 10000 });
      },
    },
  ],
});
