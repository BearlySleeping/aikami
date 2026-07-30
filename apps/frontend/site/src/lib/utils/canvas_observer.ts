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
  const prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // If user prefers reduced motion, keep ticker stopped entirely
  if (prefersReducedMotion) {
    options.app.ticker.stop();

    const mediaQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (e: MediaQueryListEvent) => {
      if (e.matches) {
        options.app.ticker.stop();
      } else {
        options.app.ticker.start();
      }
    };
    mediaQuery.addEventListener('change', listener);

    return () => {
      mediaQuery.removeEventListener('change', listener);
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          options.app.ticker.start();
        } else {
          options.app.ticker.stop();
        }
      }
    },
    { threshold: 0 },
  );

  observer.observe(options.container);

  return () => {
    observer.disconnect();
  };
};
