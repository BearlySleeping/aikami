// apps/frontend/site/src/lib/utils/canvas_observer.ts
/**
 * IntersectionObserver wrapper for PixiJS v8 Applications.
 * Pauses the ticker when canvas leaves viewport, resumes when visible.
 * Saves GPU/CPU by stopping WebGL renders on off-screen sections.
 */
import type { Application } from 'pixi.js';

/**
 * Attaches an IntersectionObserver to a PixiJS Application's canvas container.
 * Automatically calls `app.ticker.stop()` when out of viewport and
 * `app.ticker.start()` when visible. Respects `prefers-reduced-motion`.
 *
 * @returns A cleanup function that disconnects the observer.
 */
export const observeCanvas = (options: {
  app: Application;
  container: HTMLElement;
}): (() => void) => {
  let isIntersecting = false;
  let prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Update ticker based on both states
  const updateTicker = () => {
    if (prefersReducedMotion || !isIntersecting) {
      options.app.ticker.stop();
    } else {
      options.app.ticker.start();
    }
  };

  // Initial state check
  updateTicker();

  // Listen for reduced motion preference changes
  const mediaQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
  const mediaListener = (e: MediaQueryListEvent) => {
    prefersReducedMotion = e.matches;
    updateTicker();
  };
  mediaQuery.addEventListener('change', mediaListener);

  // Listen for intersection changes
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        isIntersecting = entry.isIntersecting;
        updateTicker();
      }
    },
    { threshold: 0 },
  );

  observer.observe(options.container);

  return () => {
    mediaQuery.removeEventListener('change', mediaListener);
    observer.disconnect();
  };
};
