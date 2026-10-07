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
export const nextFocusIndex = ({
  count,
  currentIndex,
  step,
}: {
  count: number;
  currentIndex: number;
  step: 1 | -1;
}): number => {
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
export const cycleFocus = ({ root, step }: { root: HTMLElement; step: 1 | -1 }): boolean => {
  const focusable = focusableWithin(root);
  if (focusable.length === 0) {
    return false;
  }
  const active = root.ownerDocument.activeElement;
  const currentIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
  const nextIndex = nextFocusIndex({ count: focusable.length, currentIndex, step });
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
export const captureRestoreTarget = ({
  document: doc = document,
  surfaceSelector = GAME_SURFACE_SELECTOR,
}: {
  document?: Document;
  surfaceSelector?: string;
} = {}): HTMLElement | undefined => {
  const active = doc.activeElement;
  if (active instanceof HTMLElement && active !== doc.body && active.isConnected) {
    return active;
  }
  return doc.querySelector<HTMLElement>(surfaceSelector) ?? undefined;
};

/** Returns focus without scrolling; the canvas region has a stable tabindex=-1. */
export const restoreFocus = (target: HTMLElement | undefined): void => {
  if (!target?.isConnected) {
    return;
  }
  target.focus({ preventScroll: true });
};

/** DOM ownership and the ViewModel's dismissal callback for the pause dialog. */
export type PauseDialogFocusOptions = {
  /**
   * Identity of the dialog's current content. When it changes (e.g. the menu
   * swaps to the quit confirmation) focus follows to the new primary action
   * instead of being dropped on `<body>` by the re-render.
   */
  readonly focusKey?: unknown;
  /** Dismiss the owning menu after consuming Escape exactly once. */
  readonly onEscape?: () => void;
};

/** A newer overlay/control owns connected focus after this dialog retires. */
const hasNewFocusOwner = (node: HTMLElement): boolean => {
  const { activeElement, body, documentElement } = node.ownerDocument;
  return (
    activeElement?.isConnected === true &&
    activeElement !== body &&
    activeElement !== documentElement &&
    !node.contains(activeElement)
  );
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
  { focusKey, onEscape }: PauseDialogFocusOptions = {},
) => {
  const restoreTarget = captureRestoreTarget();
  let activeFocusKey = focusKey;

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Escape' && onEscape) {
      // The window-level overlay dispatcher honours defaultPrevented.
      // Without consumption it reopens Pause after this callback closes it.
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    // Contain the cycle: without this, Tab escapes to the HUD behind the scrim.
    event.preventDefault();
    cycleFocus({ root: node, step: event.shiftKey ? -1 : 1 });
  };

  node.addEventListener('keydown', onKeydown);
  focusInitial(node);

  return {
    update(next: PauseDialogFocusOptions = {}): void {
      onEscape = next.onEscape;
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
      queueMicrotask(() => {
        if (hasNewFocusOwner(node)) {
          return;
        }
        restoreFocus(restoreTarget);
      });
    },
  };
};
