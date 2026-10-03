// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_focus.ts
//
// Focus ownership for the modal Pause Menu dialog.
//
// Keyboard-only players must be able to open the menu, land somewhere
// predictable, cycle inside it, and return to where they were. All of that is
// DOM behaviour, not product state, so it lives here as pure helpers plus one
// Svelte action — the View stays declarative and the ViewModel stays free of
// DOM concerns.

/** Native focusables, plus anything the HUD deliberately made focusable. */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Marks the control that receives focus when the dialog opens. */
export const INITIAL_FOCUS_ATTRIBUTE = 'data-pause-menu-initial-focus';

/** The game surface that owns keyboard input while the HUD has focus. */
export const GAME_SURFACE_SELECTOR = '#game-canvas-container';

/** True when the element is rendered and can therefore take focus. */
const isRendered = (element: HTMLElement): boolean => element.getClientRects().length > 0;

/** The rendered, focusable descendants of `root`, in tab order. */
export const focusableWithin = (root: HTMLElement): readonly HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered);

/**
 * Index of the next control for `step` (+1 Tab, -1 Shift+Tab), wrapping at
 * both ends so the cycle is closed. Returns -1 when there is nothing to focus.
 */
export const nextFocusIndex = (count: number, currentIndex: number, step: 1 | -1): number => {
  if (count === 0) {
    return -1;
  }
  if (currentIndex >= 0) {
    return (currentIndex + step + count) % count;
  }
  // Entering the cycle from outside: Tab lands on the first control,
  // Shift+Tab on the last.
  return step === 1 ? 0 : count - 1;
};

/**
 * Moves focus one step through `root`'s focusables and reports whether the
 * cycle was handled (a caller uses this to decide whether to preventDefault).
 */
export const cycleFocus = (root: HTMLElement, step: 1 | -1): boolean => {
  const focusable = focusableWithin(root);
  if (focusable.length === 0) {
    return false;
  }
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const nextIndex = nextFocusIndex(focusable.length, currentIndex, step);
  if (nextIndex < 0) {
    return false;
  }
  focusable[nextIndex]?.focus();
  return true;
};

/** Moves focus to the dialog's designated landing control, else its first one. */
export const focusInitial = (root: HTMLElement): void => {
  const designated = root.querySelector<HTMLElement>(`[${INITIAL_FOCUS_ATTRIBUTE}]`);
  const target =
    (designated && isRendered(designated) ? designated : focusableWithin(root)[0]) ?? root;
  target.focus();
};

/**
 * The element focus should return to when the dialog closes.
 *
 * The dialog is opened from a global key handler, so `document.activeElement`
 * is often `<body>` at that moment; the game surface is the element that
 * actually owns keyboard input, so it is the fallback.
 */
export const captureRestoreTarget = (
  doc: Document = document,
  surfaceSelector = GAME_SURFACE_SELECTOR,
): HTMLElement | null => {
  const active = doc.activeElement;
  if (active instanceof HTMLElement && active !== doc.body && active.isConnected) {
    return active;
  }
  return doc.querySelector<HTMLElement>(surfaceSelector);
};

/**
 * Focuses an element that is not natively focusable.
 *
 * The game surface is a plain container, so restoring focus there needs a
 * programmatic tab stop. It is removed on blur, leaving no tab order change
 * behind.
 */
const focusWithoutTabStop = (element: HTMLElement): void => {
  if (element.hasAttribute('tabindex')) {
    element.focus();
    return;
  }
  element.setAttribute('tabindex', '-1');
  element.focus();
  // `tabindex="-1"` is programmatically focusable but not a tab stop, so the
  // attribute can go straight back without changing what a player can Tab to.
  // Focus is retained when the attribute is removed.
  queueMicrotask(() => element.removeAttribute('tabindex'));
};

/** Returns focus to a captured target when that element still exists. */
export const restoreFocus = (target: HTMLElement | null): void => {
  if (!target?.isConnected) {
    return;
  }
  if (target.matches(FOCUSABLE_SELECTOR)) {
    target.focus();
    return;
  }
  focusWithoutTabStop(target);
};

export type PauseDialogFocusOptions = {
  /** Shift+Tab wraps backwards instead of forwards. */
  readonly reverse?: boolean;
  /**
   * Identity of the dialog's current content. When it changes (e.g. the menu
   * swaps to the quit confirmation) focus follows to the new primary action
   * instead of being dropped on `<body>` by the re-render.
   */
  readonly focusKey?: unknown;
};

/**
 * Svelte action that gives a modal dialog real focus ownership:
 *
 * - on mount: capture the pre-dialog focus and land on the initial control;
 * - on Tab/Shift+Tab: keep the cycle inside the dialog;
 * - on destroy: return focus to whatever owned it before.
 *
 * The action never decides *what* closing the dialog means — dismissal stays a
 * View/ViewModel decision — it only restores focus when the dialog goes away.
 */
export const pauseDialogFocus = (
  node: HTMLElement,
  { reverse = false, focusKey }: PauseDialogFocusOptions = {},
) => {
  const restoreTarget = captureRestoreTarget();
  let activeFocusKey = focusKey;

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }
    // Contain the cycle: without this, Tab escapes to the HUD behind the scrim.
    event.preventDefault();
    cycleFocus(node, event.shiftKey || reverse ? -1 : 1);
  };

  node.addEventListener('keydown', onKeydown);
  focusInitial(node);

  return {
    update(next: PauseDialogFocusOptions = {}): void {
      const nextFocusKey = next.focusKey;
      if (nextFocusKey === activeFocusKey) {
        return;
      }
      activeFocusKey = nextFocusKey;
      focusInitial(node);
    },
    destroy(): void {
      node.removeEventListener('keydown', onKeydown);
      // The control that held focus is removed with the dialog, and the browser
      // resets focus to <body> when it does — so restore after teardown settles
      // rather than during it.
      queueMicrotask(() => restoreFocus(restoreTarget));
    },
  };
};
