// apps/frontend/client/src/lib/views/game/ui/hud/clock_hud_preference.svelte.ts
//
// C-527 Directive 7 / AC-1 — the clock/weather HUD is OFF for a new player.
//
// Only the visibility *preference* lives here; the clock itself is still
// projected from TimeService. A small reactive module (rather than a service
// class) keeps this transient HUD preference next to the widget that consumes
// it, and reads storage at module load so there is no forgotten call site.
// The HUD editor (C-528) will provide the setter; until then no code needs one.

const CLOCK_HUD_VISIBLE_KEY = 'aikami:clock-hud:visible';

/** Reads the persisted preference; missing means off. */
const readStoredClockHudVisible = (): boolean => {
  try {
    return localStorage.getItem(CLOCK_HUD_VISIBLE_KEY) === '1';
  } catch {
    // localStorage unavailable (SSR/privacy mode) — default off.
    return false;
  }
};

/**
 * The persisted clock HUD visibility. `auto` follows the stored preference;
 * an absent key is off, which is the new-player default.
 */
export const clockHudPreference = $state<{ visible: boolean }>({
  visible: readStoredClockHudVisible(),
});
