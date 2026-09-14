// apps/e2e/src/visual/suites/play_shell.visual.ts
//
// C-527 — visual cases for the production play shell and the management host.
//
// Cases are declared with the production route (`/game`) and only the real
// search params the route understands — the section switches happen through the
// actual HUD Menu entry, not through a bypass parameter.
//
// Contract: C-527 AC-1, AC-2, AC-5, AC-6.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

/**
 * Response schema mandated by the contract's Test Hooks: a headline boolean can
 * never be papered over by a generous score (`requiredTrueFields` enforces
 * this in the runner).
 */
const PlayShellSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  unreadableText: Type.Boolean({ description: 'Any essential text is unreadable at the shown scale' }),
  overlappingControls: Type.Boolean({ description: 'Essential controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description: 'A required action (Menu, section rail, Back) is missing or unreachable',
  }),
  issues: Type.Array(Type.String(), { description: 'Concrete defects found' }),
});

/** Waits for the play shell HUD, then opens the management host. */
const openHost = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-menu-entry"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector('[data-testid="management-host"]', {
    state: 'visible',
    timeout: 10_000,
  });
};

/** Opens the host and activates one section from the rail. */
const openSection = (section: string) => async (page: import('playwright').Page) => {
  await openHost(page);
  await page.getByTestId(`section-tab-${section}`).click();
  await page.waitForTimeout(600);
};

export default defineConfig({
  id: 'play-shell',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'explore-default',
      prompt:
        'Score 90+ only when the scene dominates, the top-start and top-end HUD slots show compact status, exactly one labeled Menu entry is present beside them, and there is NO permanent multi-button management strip across the top. Essential text must be readable at 18px-equivalent scale. Report any overlapping HUD controls or a missing Menu entry.',
      schema: PlayShellSchema,
      requiredTrueFields: ['missingCriticalAction'],
      minScore: 90,
    },
    {
      name: 'dialogue-long',
      prompt:
        'Score 90+ when a long conversation is open and the management HUD chrome is withdrawn: the dialogue panel is readable, the Menu entry is not competing with the conversation, and no control overlaps the transcript. Flag clipped or overlapping controls.',
      schema: PlayShellSchema,
      minScore: 85,
    },
    {
      name: 'inventory-detail',
      prompt:
        'Score 90+ when the management host shows a section rail with five labeled sections above a single section body, the active section is visually marked, a Back control is present, and the inventory content inside the body is readable over the panel. Flag a missing rail, a hidden Back control, or overlapping controls.',
      schema: PlayShellSchema,
      setupHook: openSection('inventory'),
      requiredTrueFields: ['missingCriticalAction'],
      minScore: 90,
    },
    {
      name: 'compare-section-switch',
      prompt:
        'Score 90+ when the management host is showing the Journal section: the rail still lists all five sections with Journal marked active, exactly one section body is visible, and changing section kept a single coherent workspace rather than stacking panels. Flag stacked or duplicated panels.',
      schema: PlayShellSchema,
      setupHook: openSection('journal'),
      minScore: 85,
    },
    {
      name: 'compact',
      prompt:
        'Score 90+ at a compact viewport: the play HUD and the management rail reflow without clipping, the Menu entry and Back control stay reachable, and no essential control is cut off or overlapping. Flag any two-axis scrolling or clipped action.',
      schema: PlayShellSchema,
      setupHook: async (page) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openHost(page);
      },
      requiredTrueFields: ['missingCriticalAction'],
      minScore: 90,
    },
    {
      name: 'large-text',
      prompt:
        'Score 90+ at 200% text scale: section labels, the Back control and the section body text all remain readable and none of them are clipped or overlapping. Flag any unreadable or truncated essential label.',
      schema: PlayShellSchema,
      setupHook: async (page) => {
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await openHost(page);
      },
      requiredTrueFields: ['missingCriticalAction'],
      minScore: 90,
    },
    {
      name: 'high-contrast',
      prompt:
        'Score 90+ when the OS requests high contrast: panels stay opaque enough that scene content behind them does not reduce text legibility, and focus/active states remain apparent. Flag washed-out or low-contrast essential text.',
      schema: PlayShellSchema,
      setupHook: async (page) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await openHost(page);
      },
      minScore: 85,
    },
    {
      name: 'reduced-motion',
      prompt:
        'Score 90+ when reduced motion is requested: the management host is presented without transition animation, the full rail and section body are immediately visible, and no content is mid-animation or translucent. Flag any element that appears only partially transitioned in.',
      schema: PlayShellSchema,
      setupHook: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openHost(page);
      },
      minScore: 85,
    },
  ],
});
