// apps/frontend/client/src/lib/services/game/quest_ending_selection.ts
//
// C-495 — pure ending-selection helpers.
//
// Evidence UNLOCKS an ending; it must never silently choose one. These helpers
// decide which endings are choosable and which default resolves when the player
// has not made an explicit choice, so `quest_state_service` keeps only the state
// mutation and the public API.
//
// Contract: C-495 Emberwatch dramatic structure

import type { ContentPackQuestEnding } from '@aikami/types';

/** An ending as offered to the player, with whether it is currently unlocked. */
export type EligibleEnding = {
  id: string;
  title: string;
  unlocked: boolean;
  requiresWorldStateFlag?: string;
};

/**
 * Whether an ending is currently choosable: the unconditional ending always
 * is; a conditioned ending only when its required world-state flag is set.
 */
const isEndingUnlocked = (options: {
  ending: ContentPackQuestEnding;
  worldStateFlags: Readonly<Record<string, boolean>>;
}): boolean =>
  !options.ending.requiresWorldStateFlag ||
  Boolean(options.worldStateFlags[options.ending.requiresWorldStateFlag]);

/** Lists the endings a player may currently choose, in authored order. */
export const listEligibleEndings = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
  worldStateFlags: Readonly<Record<string, boolean>>;
}): EligibleEnding[] =>
  Object.entries(options.endings).map(([id, ending]) => ({
    id,
    title: ending.title,
    unlocked: isEndingUnlocked({ ending, worldStateFlags: options.worldStateFlags }),
    ...(ending.requiresWorldStateFlag
      ? { requiresWorldStateFlag: ending.requiresWorldStateFlag }
      : {}),
  }));

/**
 * The ending that resolves when the player made no explicit choice.
 *
 * Always the unconditioned default — never a world-state-conditioned ending
 * merely because its evidence flag is set. A pack with only conditioned
 * endings has no safe no-choice outcome.
 */
export const selectDefaultEnding = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
}): string | undefined =>
  Object.keys(options.endings).find((id) => !options.endings[id]?.requiresWorldStateFlag);

/** Why an explicit ending choice was rejected, or `ok` when it is recordable. */
type EndingChoiceResult = 'ok' | 'inactive-quest' | 'unknown-ending' | 'locked-ending';

/**
 * Validates an explicit ending choice and, when valid, commits it onto the
 * given progress object. The caller owns the progress record; this only writes
 * `chosenEndingId` on success.
 *
 * @returns `ok` when the choice was committed, otherwise the rejection reason.
 */
export const commitEndingChoice = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
  endingId: string;
  questActive: boolean;
  worldStateFlags: Readonly<Record<string, boolean>>;
  progress: { chosenEndingId?: string };
}): EndingChoiceResult => {
  if (!options.questActive) {
    return 'inactive-quest';
  }
  const ending = options.endings[options.endingId];
  if (!ending) {
    return 'unknown-ending';
  }
  if (!isEndingUnlocked({ ending, worldStateFlags: options.worldStateFlags })) {
    return 'locked-ending';
  }
  options.progress.chosenEndingId = options.endingId;
  return 'ok';
};
