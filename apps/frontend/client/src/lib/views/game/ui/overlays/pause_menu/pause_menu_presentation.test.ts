// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_presentation.test.ts
import { describe, expect, test } from 'bun:test';
import {
  END_SESSION_DESCRIPTION,
  formatLastSavedAt,
  QUIT_CONFIRMATION_TITLE,
  QUIT_DESCRIPTION,
} from './pause_menu_presentation';

describe('pause menu presentation', () => {
  test('formats missing and valid save timestamps', () => {
    expect(formatLastSavedAt(undefined)).toBe('Not saved yet');
    expect(formatLastSavedAt('not-a-date')).toBe('Last save time unavailable');
    expect(formatLastSavedAt('2026-09-24T16:57:28Z')).toContain('Last saved');
  });

  test('keeps session and quit consequences distinct', () => {
    expect(END_SESSION_DESCRIPTION).toContain('recap');
    expect(END_SESSION_DESCRIPTION).toContain('local saves');
    expect(QUIT_DESCRIPTION).toContain('stay on this device');
    expect(QUIT_DESCRIPTION).toContain('last save');
    expect(QUIT_CONFIRMATION_TITLE).toBe('Quit to Main Menu?');
  });
});
