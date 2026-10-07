// apps/frontend/client/src/browser_tests/settings_audio_observer.svelte.ts

/** Observes busy-state reads with compiled Svelte effects for the browser test. */
export const observeAudioBusy = (observe: () => void): (() => void) =>
  $effect.root(() => {
    $effect(observe);
  });
