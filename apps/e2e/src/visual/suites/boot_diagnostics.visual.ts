// apps/e2e/src/visual/suites/boot_diagnostics.visual.ts
// Boot Diagnostics Terminal — declarative visual test suite.
//
// Port of boot_diagnostics_visual.spec.ts. Captures the retro-terminal
// boot screen in various provider configurations using route mocking
// via setupHook. Evaluates via AI to verify terminal rendering, status
// indicators, and provider toggle UI.
//
// Contract: C-130, C-133, C-134

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const BootDiagSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  terminalRendered: Type.Boolean({
    description: 'Whether the retro-terminal UI is visible with title bar and content area',
  }),
  statusIndicators: Type.Boolean({
    description: 'Whether colored status dots (green/red/yellow) are visible for provider rows',
  }),
  buttonVisible: Type.Boolean({
    description: 'Whether the Initialize/Awaiting Text Provider button is visible at the bottom',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const BOOT_PROMPT = [
  'This is a screenshot of the Aikami Core Boot Sequence terminal screen.',
  '',
  'EXPECTED LAYOUT:',
  '- Dark terminal-style background (neutral-950/900).',
  '- Top bar with three colored dots (red, yellow, green) and "Aikami Core Boot Sequence v3.0" text.',
  '- "INITIALIZING SUBSYSTEMS..." heading in green.',
  '- "REQUIRED SYSTEM" section with Text AI (Logic Engine) row.',
  '- "OPTIONAL SUBSYSTEMS" section with Image AI and Voice AI rows.',
  '- Provider selection buttons (Local Ollama / Cloud OpenRouter toggle).',
  '- Status indicators (ONLINE, OFFLINE, SCANNING..., NO KEY).',
  '- A button at the bottom (may be disabled with spinner).',
  '',
  'EVALUATE:',
  '- Is the terminal layout rendered correctly?',
  '- Are the status indicator dots visible and correctly colored?',
  '- Is the Text AI provider row present with toggle buttons?',
  '- Is the bottom action button visible?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Mock helpers ─────────────────────────────────────────────

/**
 * Sets up route mocks so Ollama appears online and ComfyUI appears offline.
 */
const mockTextOnlineImageOffline = async (page: import('playwright').Page): Promise<void> => {
  // Mock Ollama — return 200 for the Ollama ping endpoint
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({ status: 200, body: '{}' });
  });

  // Mock ComfyUI — abort connection
  await page.route('**/api/image/object_info', (route) => {
    route.abort('connectionrefused');
  });

  // Reload to trigger provider checks
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
};

/**
 * Sets up route mocks so both Ollama and ComfyUI appear online.
 */
const mockBothOnline = async (page: import('playwright').Page): Promise<void> => {
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({ status: 200, body: '{}' });
  });

  await page.route('**/api/image/object_info', (route) => {
    route.fulfill({ status: 200, body: '{}' });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'boot_diagnostics',
  route: '/',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Boot Terminal — SCANNING State',
      prompt: BOOT_PROMPT,
      schema: BootDiagSchema,
    },
    {
      name: 'Boot Terminal — Text Online, Image Offline',
      prompt: BOOT_PROMPT,
      schema: BootDiagSchema,
      setupHook: mockTextOnlineImageOffline,
    },
    {
      name: 'Boot Terminal — Both Providers Online',
      prompt: [
        ...BOOT_PROMPT.split('\n'),
        '',
        'NOTE: Both providers should show ONLINE status with green dots. The Initialize Core button should be enabled.',
      ].join('\n'),
      schema: BootDiagSchema,
      setupHook: mockBothOnline,
    },
  ],
});
