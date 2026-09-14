// apps/frontend/client/src/lib/views/game/ui/combat_layout.ts
//
// C-527 AC-4 — combat container adaptation.
//
// The combat surface is a split-screen: one sidebar column plus the scene. That
// is only a legal layout while the scene still has a usable width left over. The
// policy below answers one question — split or bottom action sheet — from the
// viewport alone, so the choice is pure, testable, and cannot be re-derived
// differently in two places.
//
// There is exactly ONE `CombatSidebar`: the resolver decides WHICH container
// renders it, never whether a second one appears.

/** Which combat container the viewport can afford. */
export type CombatLayout = 'split' | 'sheet';

/** `min(28vw, 32rem)` — the sidebar width the split layout asks for. */
export const COMBAT_SIDEBAR_WIDTH_RATIO = 0.28;
export const COMBAT_SIDEBAR_MAX_WIDTH = 512;

/** The scene must keep at least this much width, or the sidebar becomes a sheet. */
export const COMBAT_SCENE_MIN_WIDTH = 520;

/** The scene must keep at least this much height underneath a sheet. */
export const COMBAT_SCENE_MIN_HEIGHT = 320;

export const COMBAT_SHEET_MIN_HEIGHT = 200;
export const COMBAT_SHEET_MAX_HEIGHT = 420;

/**
 * Viewport height at which both the sheet minimum AND the scene minimum can be
 * honoured at once. Below this the viewport simply cannot afford both, and the
 * sheet takes its minimum while the scene keeps whatever is left.
 */
export const COMBAT_MIN_VIEWPORT_HEIGHT_FOR_SCENE =
  COMBAT_SCENE_MIN_HEIGHT + COMBAT_SHEET_MIN_HEIGHT;

/** Viewport below which even the scene-minimum rule cannot be satisfied. */
export const COMBAT_SHEET_BREAKPOINT = COMBAT_SIDEBAR_MAX_WIDTH + COMBAT_SCENE_MIN_WIDTH;

/** The width the split layout's sidebar column occupies at this viewport width. */
export const combatSidebarWidth = (viewportWidth: number): number =>
  Math.max(0, Math.min(viewportWidth * COMBAT_SIDEBAR_WIDTH_RATIO, COMBAT_SIDEBAR_MAX_WIDTH));

/**
 * Resolves the combat container from the available viewport.
 *
 * `split` while the scene keeps at least {@link COMBAT_SCENE_MIN_WIDTH} after
 * the sidebar takes its share; `sheet` (an accessible bottom action sheet)
 * otherwise. A viewport that cannot legally host the side rail therefore never
 * gets a starved scene — which is the whole point of the directive.
 */
export const resolveCombatLayout = (viewport: { width: number; height: number }): CombatLayout => {
  if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
    return 'sheet';
  }
  return viewport.width - combatSidebarWidth(viewport.width) >= COMBAT_SCENE_MIN_WIDTH
    ? 'split'
    : 'sheet';
};

/**
 * Height of the bottom action sheet.
 *
 * While the viewport can afford both budgets the sheet is clamped so the scene
 * keeps {@link COMBAT_SCENE_MIN_HEIGHT}. Below
 * {@link COMBAT_MIN_VIEWPORT_HEIGHT_FOR_SCENE} the two budgets are mutually
 * exclusive, so the sheet takes its own minimum and the scene keeps the
 * remainder — degrading visibly rather than collapsing to a zero-height sheet.
 * Never returns a negative or NaN height.
 */
export const combatSheetHeight = (viewportHeight: number): number => {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return COMBAT_SHEET_MIN_HEIGHT;
  }
  const available = viewportHeight - COMBAT_SCENE_MIN_HEIGHT;
  return Math.max(COMBAT_SHEET_MIN_HEIGHT, Math.min(COMBAT_SHEET_MAX_HEIGHT, available));
};
