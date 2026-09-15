// apps/frontend/client/src/lib/views/game/ui/hud_view_state.svelte.ts
//
// C-528 — the measured viewport and text scale the HUD resolver reflows against.
//
// Measurements happen ONLY when the viewport or the root font size changes, and
// the resize handler is coalesced to an animation frame. There is no polling and
// no per-frame DOM read: the resolver is a pure function of these three numbers.
//
// The listener is bound at module load rather than in a caller's `onMount`, so
// there is no entry point that can forget to measure — the same reasoning the
// preference services use for their construction-time restore.

import type { HudViewport } from '$lib/utils/hud/hud_layout_policy.ts';

/** Default used when the DOM is unavailable (SSR/tests). */
const DEFAULT_VIEWPORT: HudViewport = { width: 1920, height: 1080 };

/** Default root font size in px — 100% text scale. */
const BASE_FONT_SIZE = 16;

const readViewport = (): HudViewport => {
  if (typeof window === 'undefined') {
    return DEFAULT_VIEWPORT;
  }
  return { width: window.innerWidth, height: window.innerHeight };
};

/** Reads the effective text scale from the root font size (1 = 100%, 2 = 200%). */
const readTextScale = (): number => {
  if (typeof document === 'undefined' || !document.documentElement) {
    return 1;
  }
  const fontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return 1;
  }
  return Math.round((fontSize / BASE_FONT_SIZE) * 100) / 100;
};

/** Live measurement the HUD resolver reflows against. */
export type HudViewStateInterface = {
  viewport: HudViewport;
  textScale: number;
};

export const hudViewState: HudViewStateInterface = $state<HudViewStateInterface>({
  viewport: readViewport(),
  textScale: readTextScale(),
});

/** Re-measures immediately. Idempotent. */
export const measureHudViewState = (): void => {
  hudViewState.viewport = readViewport();
  hudViewState.textScale = readTextScale();
};

/**
 * Binds a rAF-coalesced resize/text-scale listener.
 *
 * Returns a teardown function; the module binds once at load.
 */
export const bindHudViewState = (): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  let frame = 0;
  const schedule = (): void => {
    if (frame !== 0) {
      return;
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      measureHudViewState();
    });
  };
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  measureHudViewState();
  return () => {
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
};

bindHudViewState();
