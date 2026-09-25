// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_presentation.ts
//
// Pure pause-menu copy and time projections. Keeping these derivations outside
// the View and ViewModel makes the session consequences explicit and testable.

/** Formats the campaign's last successful save for the pause menu. */
export const formatLastSavedAt = (value: string | undefined): string => {
  if (!value) {
    return 'Not saved yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Last save time unavailable';
  }

  return `Last saved ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)}`;
};

/** Copy for the action that ends the current session without leaving the game. */
export const END_SESSION_DESCRIPTION =
  'Save a recap of this session, then start a new session when you are ready. Your campaign and local saves stay available.';

/** Copy for leaving the current game without ending the session flow. */
export const QUIT_DESCRIPTION =
  'Your campaign and existing local saves stay on this device. Changes since the last save may not be available when you return.';

/** Returns the confirmation heading for quitting to the main menu. */
export const QUIT_CONFIRMATION_TITLE = 'Quit to Main Menu?';
