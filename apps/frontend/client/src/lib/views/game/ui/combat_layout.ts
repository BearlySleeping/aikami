// apps/frontend/client/src/lib/views/game/ui/combat_layout.ts
//
// C-527 AC-4 — combat container adaptation.
//
// The combat surface is a split-screen: one sidebar column plus the scene. That
// is only a legal layout while BOTH budgets hold: the scene keeps a usable
// width AND the sidebar keeps a readable action-content minimum. The policy
// below answers one question — split or bottom action sheet — from the actual
// container box and the current text scale, so the choice is pure, testable,
// and cannot be re-derived differently in two places.
//
// There is exactly ONE `CombatSidebar`: the resolver decides WHICH container
// renders it, never whether a second one appears.
//
// Text scale: the CSS column is `clamp(20rem, 28vw, 32rem)`. A hard-coded 512px
// cap disagreed with CSS as soon as the root font size changed (32rem is 1024px
// at 200% text), so the policy takes the root font size and works in rem.

/** Which combat container the viewport can afford. */
export type CombatLayout = 'split' | 'sheet';

/** `28vw` — the preferred share of the container the sidebar asks for. */
export const COMBAT_SIDEBAR_WIDTH_RATIO = 0.28;

/** Readable action-content minimum, in rem (`20rem`). */
export const COMBAT_SIDEBAR_MIN_REM = 20;

/** Hard cap on the sidebar column, in rem (`32rem`). */
export const COMBAT_SIDEBAR_MAX_REM = 32;

/** The sidebar cap at the default 16px root, kept for existing callers. */
export const COMBAT_SIDEBAR_MAX_WIDTH = COMBAT_SIDEBAR_MAX_REM * 16;

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

/** The width the split layout's sidebar column occupies. */
export const combatSidebarWidth = (containerWidth: number, rootFontSize = 16): number => {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 0;
  }
  const preferred = containerWidth * COMBAT_SIDEBAR_WIDTH_RATIO;
  const minWidth = COMBAT_SIDEBAR_MIN_REM * rootFontSize;
  const maxWidth = COMBAT_SIDEBAR_MAX_REM * rootFontSize;
  // Never exceed the container: on a narrow viewport the sheet takes over, but
  // a caller that still asks for a width gets a positive, in-bounds number.
  return Math.min(Math.max(preferred, minWidth), maxWidth, containerWidth);
};

export type CombatLayoutInput = {
  width: number;
  height: number;
  /** The actual container width, when it differs from the viewport. */
  containerWidth?: number;
  /** The actual container height, when it differs from the viewport. */
  containerHeight?: number;
  /** Current root font size in px; drives the rem-based budgets. */
  rootFontSize?: number;
};

/**
 * Resolves the combat container from the available box and text scale.
 *
 * `split` while the scene keeps at least {@link COMBAT_SCENE_MIN_WIDTH} after
 * the readable sidebar minimum is reserved; `sheet` (an accessible bottom
 * action sheet) otherwise. A viewport that cannot legally host the side rail
 * therefore never gets a starved scene or an unreadably narrow action column.
 */
export const resolveCombatLayout = (input: CombatLayoutInput): CombatLayout => {
  const rootFontSize =
    input.rootFontSize === undefined ||
    !Number.isFinite(input.rootFontSize) ||
    input.rootFontSize <= 0
      ? 16
      : input.rootFontSize;
  const containerWidth = input.containerWidth ?? input.width;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 'sheet';
  }
  const sidebar = combatSidebarWidth(containerWidth, rootFontSize);
  const sceneWidth = containerWidth - sidebar;
  return sceneWidth >= COMBAT_SCENE_MIN_WIDTH ? 'split' : 'sheet';
};

/**
 * Height of the bottom action sheet.
 *
 * While the container can afford both budgets the sheet is clamped so the scene
 * keeps {@link COMBAT_SCENE_MIN_HEIGHT}. Below the combined budget the two are
 * mutually exclusive, so the sheet takes its own minimum and the scene keeps
 * the remainder — degrading visibly rather than collapsing to a zero-height
 * sheet. The budgets scale with the text so enlarged text keeps the controls
 * reachable. Never returns a negative or NaN height.
 */
export const combatSheetHeight = (containerHeight: number, rootFontSize = 16): number => {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return COMBAT_SHEET_MIN_HEIGHT;
  }
  const scale = Number.isFinite(rootFontSize) && rootFontSize > 0 ? rootFontSize / 16 : 1;
  const minimum = COMBAT_SHEET_MIN_HEIGHT * scale;
  const maximum = COMBAT_SHEET_MAX_HEIGHT * scale;
  const sceneMinimum = COMBAT_SCENE_MIN_HEIGHT * scale;
  const available = containerHeight - sceneMinimum;
  return Math.min(containerHeight, Math.max(minimum, Math.min(maximum, available)));
};
