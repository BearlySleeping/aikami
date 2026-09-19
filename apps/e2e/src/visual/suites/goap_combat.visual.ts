// apps/e2e/src/visual/suites/goap_combat.visual.ts
// GOAP Combat Tactics — declarative visual test suite.
//
// 🔴 REPOINTED (combat debug workspace consolidation). The old suite targeted
// `/dev/sandbox/combat?testTactics=true`, which is now a 307 redirect to
// `/dev/combat?mode=live` and whose `sandbox_combat.json` map was DELETED.
// `testTactics` is not part of the workspace URL contract (scenario / mode /
// tab / seed only), so the captured surface is now the consolidated
// workspace's LIVE mode on the `environmental-action` scenario: real engine
// session, production combat sidebar, inspector and trace timeline alongside.
//
// WHAT WAS LOST: the previous case claimed enemies "dynamically reposition to
// settle within their preferredRange zones". No scenario in the consolidated
// workspace is authored to force tactical repositioning, so the case no longer
// asserts that claim — it asserts what the surface it now captures can honestly
// be judged on (a live session, visible combat UI, a structured layout). The
// GOAP behaviour itself is asserted by the engine/kernel suites.
//
// Contract: C-197

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const TacticalCombatSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of tactical presentation correctness' }),
  workspaceShellVisible: Type.Boolean({
    description: 'Whether the combat debug workspace shell and toolbar are rendered',
  }),
  combatUIVisible: Type.Boolean({
    description: 'Whether the production combat sidebar is rendered with HP bars',
  }),
  tacticalSurfaceVisible: Type.Boolean({
    description:
      'Whether the direct-control panel (Move / abilities / forecast) is rendered for the live session',
  }),
  layoutCorrect: Type.Boolean({
    description: 'Whether the workspace layout is structurally sound (no overlap, no clipping)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const TACTICS_PROMPT = [
  'This is a screenshot of the Aikami COMBAT DEBUG WORKSPACE on the',
  '/dev/combat route in LIVE mode, running the "environmental-action"',
  'synthetic scenario. One isolated engine session is rendered through the',
  'PRODUCTION combat sidebar, with the debug inspector and trace timeline',
  'alongside it.',
  '',
  'EXPECTED ELEMENTS:',
  '- The workspace shell: a header naming the mode and scenario, and a toolbar',
  '  with Mode / Scenario / Seed / Provider fault controls.',
  '- A production combat sidebar on the left with player and enemy HP bars, a',
  '  turn tracker, and the direct-control panel (Move button, ability buttons,',
  '  target/forecast area).',
  '- A black live canvas and, below it, the inspector + trace timeline panes.',
  '',
  'EVALUATE:',
  '- Is the workspace shell and toolbar rendered (not a blank or error page)?',
  '- Is the production combat sidebar visible with HP bars for both sides?',
  '- Is the direct-control tactical surface present (NOT a frozen or empty',
  '  placeholder)? If the sidebar shows no combat UI, set',
  '  combatUIVisible=false and score below 90.',
  '- Is the layout structurally sound (no overlapping, no cut-off elements)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

/**
 * Boots the consolidated workspace in live mode and waits for the production
 * combat sidebar to mount.
 *
 * The capture harness navigates the suite `route` first, so this hook only
 * switches the scenario and waits for the engine-backed surface. It mirrors the
 * wait discipline used by the production `/game` combat cases.
 */
const bootLiveScenario = async (page: import('playwright').Page): Promise<void> => {
  await page.selectOption('#combat-debug-scenario', 'environmental-action');
  await page.waitForSelector('[data-testid="combat-attack-btn"]', {
    state: 'attached',
    timeout: 45_000,
  });
  await page.waitForFunction(
    () =>
      !!document.querySelector('[data-testid="combat-budget-dots"]') ||
      !!document.querySelector('[data-testid="player-hp-text"]'),
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(1_000);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'goap_combat_tactics',
  route: '/dev/combat',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Tactical workspace — live environmental-action scenario',
      searchParams: { mode: 'live', scenario: 'environmental-action' },
      prompt: TACTICS_PROMPT,
      schema: TacticalCombatSchema,
      screenshotSelector: 'body',
      requiredTrueFields: ['workspaceShellVisible', 'combatUIVisible'],
      minScore: 85,
      setupHook: bootLiveScenario,
    },
  ],
});
