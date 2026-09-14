// apps/frontend/client/src/lib/services/game/game_input_guard.ts
//
// C-527 AC-3 — the input guards shared by the game's key dispatchers.
//
// Two guards must run BEFORE any game action is dispatched:
//   * a higher-priority scope (an open popover, autocomplete, details panel or
//     native dialog) may already have consumed the event — `defaultPrevented`;
//     acting on it again would dispatch the same key twice;
//   * an in-progress IME composition owns its keys — `isComposing`, or the
//     legacy `keyCode === 229` some engines report during composition.
//
// Editable targets are a separate concern: a key typed into a field must reach
// the field, but Escape still has to be able to close an overlay. Keeping these
// tests in one module means every dispatcher applies the same policy instead of
// re-deriving it.

/** True when the event was already handled, or belongs to an IME composition. */
export const isConsumedOrComposing = (event: KeyboardEvent): boolean =>
  event.defaultPrevented || event.isComposing || event.keyCode === 229;

/** True when the event target is a text-entry control. */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (target === null || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
};
