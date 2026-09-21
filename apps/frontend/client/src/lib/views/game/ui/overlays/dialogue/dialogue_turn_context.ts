// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_turn_context.ts
//
// Player-context projection for dialogue model calls (C-487 AC-3). Extracted
// from the ViewModel so the sheet→prompt mapping is pure and testable.

import type { GameCharacterSheet } from '@aikami/types';
import { serializeForAi } from '@aikami/utils';

/** The real player context passed to the dialogue service. */
export type DialoguePlayerContext = {
  characterSheetSummary: string;
  level: number;
  classId: string;
};

/** Serializes the authored character sheet into dialogue model context. */
export const buildPlayerContext = (sheet: GameCharacterSheet): DialoguePlayerContext => ({
  characterSheetSummary: serializeForAi(sheet),
  level: sheet.level,
  classId: sheet.classId ?? 'fighter',
});
