import type { GameOverlayServiceInterface } from './game_overlay_types.ts';

type JournalShortcutService = Pick<
  GameOverlayServiceInterface,
  'activeOverlay' | 'canOpenOverlay' | 'closeJournal' | 'openJournal'
>;

export type JournalShortcutOptions = {
  actionId: string | undefined;
  event: KeyboardEvent;
  service: JournalShortcutService;
};

/**
 * Handles the journal shortcut without adding another branch ladder to the
 * overlay service's main key handler.
 */
export const handleJournalShortcut = ({
  actionId,
  event,
  service,
}: JournalShortcutOptions): boolean => {
  if (actionId !== 'open_journal') {
    return false;
  }

  if (service.activeOverlay === 'JOURNAL') {
    event.preventDefault();
    service.closeJournal();
    return true;
  }

  if (!service.canOpenOverlay('JOURNAL')) {
    return false;
  }

  if (service.activeOverlay !== 'NONE' && service.activeOverlay !== 'PAUSE_MENU') {
    return false;
  }

  event.preventDefault();
  service.openJournal();
  return true;
};
