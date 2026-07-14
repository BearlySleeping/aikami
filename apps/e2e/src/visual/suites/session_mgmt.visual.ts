// apps/e2e/src/visual/suites/session_mgmt.visual.ts
// Session Management — declarative visual test suite.
//
// Captures the /dev/session sandbox to verify the session management
// UI renders correctly: status cards, action buttons, session list,
// test log, and mock message alert.
//
// Contract: C-240 Session Management

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const SandboxSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headingVisible: Type.Boolean({
    description: 'Whether the "Session Management Sandbox" heading is visible',
  }),
  statusCardsVisible: Type.Boolean({
    description:
      'Whether all 3 status cards (Active Session, Chat Locked, Saved Sessions) are visible',
  }),
  actionButtonsVisible: Type.Boolean({
    description: 'Whether the 5 action buttons are present',
  }),
  sessionsSectionVisible: Type.Boolean({
    description: 'Whether the Sessions section is visible',
  }),
  testLogVisible: Type.Boolean({
    description: 'Whether the Test Log section with Clear button is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const SessionListSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  sessionsListed: Type.Boolean({
    description: 'Whether saved sessions are displayed as cards with session numbers',
  }),
  activeBadgeVisible: Type.Boolean({
    description: 'Whether the active session has a green "Active" badge',
  }),
  synopsisVisible: Type.Boolean({
    description: 'Whether the session summary synopsis text is visible (if any)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const SANDBOX_PROMPT = [
  'This is a screenshot from the Aikami Session Management dev sandbox (/dev/session).',
  '',
  'EXPECTED:',
  '- Dark theme (bg-base-200 background)',
  '- Heading: "Session Management Sandbox" with a subtitle',
  '- 3 status cards in a grid: Active Session, Chat Locked, Saved Sessions',
  '- 5 action buttons: Start Session (primary/purple), End Session (disabled/grey), New Session, Load Sessions, +10 Messages',
  '- A "Sessions" section with "No saved sessions" placeholder',
  '- A "Test Log" section at the bottom with a "Clear" button and "No log entries"',
  '',
  'Score: 90-100 for complete layout, 70-89 for partial, 0-69 for broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const SESSION_LIST_PROMPT = [
  'This is a screenshot from the Aikami Session Management dev sandbox (/dev/session)',
  'after creating and ending a session.',
  '',
  'EXPECTED:',
  '- Active Session status card shows "—" (session ended, not active)',
  '- Chat Locked status shows "Yes"',
  '- Saved Sessions shows at least 1',
  '- The Sessions section shows session cards with session numbers, badges',
  '- Session cards show date/time and message count',
  '',
  'Score: 90-100 for complete session listing, 70-89 for partial, 0-69 for broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'session-mgmt',
  route: '/dev/session',
  waitCondition: 'pixi_loaded',
  cases: [
    {
      name: 'Session Sandbox — Initial State',
      prompt: SANDBOX_PROMPT,
      schema: SandboxSchema,
    },
    {
      name: 'Session Sandbox — After End Session (Session List)',
      prompt: SESSION_LIST_PROMPT,
      schema: SessionListSchema,
      setupHook: async (page) => {
        // Click Start Session
        const startBtn = page.getByRole('button', { name: 'Start Session' });
        await startBtn.click();
        await page.waitForTimeout(500);

        // Click End Session
        const endBtn = page.getByRole('button', { name: 'End Session' });
        await endBtn.click();
        await page.waitForTimeout(2000);

        // Click Load Sessions to ensure list is populated
        const loadBtn = page.getByRole('button', { name: 'Load Sessions' });
        await loadBtn.click();
        await page.waitForTimeout(500);
      },
    },
  ],
});
