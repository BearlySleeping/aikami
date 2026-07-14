// apps/e2e/src/visual/suites/persona_list.visual.ts
// Persona List / Character Selection View — declarative visual test suite.
//
// Captures the /characters route with mock persona data injected via
// localStorage. Verifies template bindings (name, race, class, level,
// alignment, background, avatar) survived the C-215 terminology refactor.
//
// Contract: C-215 — Data and Terminology Unification

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const PersonaListSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headerVisible: Type.Boolean({
    description: 'Whether "My Personas" header is visible at the top',
  }),
  personaCardsVisible: Type.Boolean({
    description: 'Whether persona cards with avatars and info are rendered in the list',
  }),
  newPersonaButtonVisible: Type.Boolean({
    description: 'Whether "+ New Persona" button is visible',
  }),
  personaCountCorrect: Type.Boolean({
    description: 'Whether the persona count badge shows "2 personas saved"',
  }),
  noUndefinedErrors: Type.Boolean({
    description:
      'Whether all template bindings resolved correctly (no "undefined" or "Unnamed Persona" fallbacks)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const PERSONA_LIST_PROMPT = [
  'This is a screenshot of the Aikami Persona List / Character Selection screen.',
  '',
  'EXPECTED LAYOUT:',
  '- Top bar with "Back" button on left and "My Personas" heading in center.',
  '- Persona count badge showing "2 personas saved".',
  '- "+ New Persona" button on the right side of the header area.',
  '- Two persona cards, each with:',
  '  - A 80x80 avatar image (colored square).',
  '  - Character name in bold (should NOT show "Unnamed Persona").',
  '  - Badge chips for race, class, level, and alignment.',
  '  - Background story text (truncated to 2 lines).',
  '  - "Saved" date, "Set Active" button, and "Delete" button.',
  '- One card should have an "Active" badge in the top-right corner.',
  '',
  'EVALUATE:',
  '- Is "My Personas" header visible?',
  '- Are two persona cards rendered?',
  '- Does each card show a name, badges, and an avatar?',
  '- Is there a number count of personas?',
  '- Are all text values populated (no "undefined" or empty placeholders)?',
  '- Is the "+ New Persona" button visible?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Mock persona data ────────────────────────────────────────

const MOCK_PERSONAS = [
  {
    persona: {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Thalia Stormwind',
      race: 'Elf',
      class: 'Wizard',
      level: 3,
      alignment: 'Chaotic Good',
      background:
        'Born under a blood moon in the Whispering Woods, Thalia discovered her arcane gift when she accidentally set fire to the village well at age six. Since then she has trained relentlessly, seeking to master the elemental forces.',
      abilityScores: {
        strength: 8,
        dexterity: 12,
        constitution: 10,
        intelligence: 16,
        wisdom: 14,
        charisma: 13,
      },
      isActive: true,
    },
    avatarUrl: '',
    savedAt: '2026-06-15T12:00:00.000Z',
  },
  {
    persona: {
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      name: 'Grimm Ironhide',
      race: 'Dwarf',
      class: 'Paladin',
      level: 2,
      alignment: 'Lawful Good',
      background:
        'A former blacksmith turned holy warrior, Grimm carries the weight of his fallen clan on his shoulders. He seeks redemption through righteous combat and unwavering faith.',
      abilityScores: {
        strength: 15,
        dexterity: 10,
        constitution: 14,
        intelligence: 8,
        wisdom: 12,
        charisma: 13,
      },
      isActive: false,
    },
    avatarUrl: '',
    savedAt: '2026-07-01T08:30:00.000Z',
  },
];

// ── Setup hook ────────────────────────────────────────────────

/**
 * Injects mock persona data into localStorage so the
 * PersonaListViewModel loads it on initialization.
 */
const setupPersonaList = async (page: import('playwright').Page): Promise<void> => {
  // Inject mock persona data into localStorage
  await page.evaluate((data) => {
    localStorage.setItem('aikami-characters', JSON.stringify(data));
  }, MOCK_PERSONAS);

  // Navigate — skip-onboarding bypasses the boot diagnostics gate
  await page.goto('http://localhost:5274/characters?skip-onboarding', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });

  // Wait for the persona list to render
  await page.waitForSelector('[data-testid="persona-list"]', { timeout: 10_000 });

  // Give DaisyUI a moment to finish rendering
  await page.waitForTimeout(1500);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'persona_list',
  route: '/characters',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Persona List — Two Mock Personas',
      prompt: PERSONA_LIST_PROMPT,
      schema: PersonaListSchema,
      setupHook: setupPersonaList,
    },
  ],
});
