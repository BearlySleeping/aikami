// apps/frontend/client/src/lib/services/game/quest_ending_selection.ts
//
// C-495 — pure ending-selection helpers.
//
// Evidence UNLOCKS an ending; it must never silently choose one, and finishing
// the last required objective must not resolve a quest the player has not
// decided. These helpers decide which endings are choosable, whether a quest
// must wait for an explicit choice, and which ending (if any) is the safe
// no-choice fallback — so `quest_state_service` keeps only the state mutation
// and the public API.
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
 * endings has no safe no-choice outcome, so it returns `undefined` and no
 * ending (and no ending world-state flag) is committed.
 *
 * Only reached by quests that author nothing to choose between: no endings at
 * all, a single ending, or a multi-ending quest whose conclusions are all still
 * locked. A quest with two or more reachable endings waits for
 * {@link commitEndingChoice} instead (see {@link requiresEndingChoice}).
 */
export const selectDefaultEnding = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
}): string | undefined =>
  Object.keys(options.endings).find((id) => !options.endings[id]?.requiresWorldStateFlag);

/**
 * Whether finishing the last required objective must WAIT for the player's
 * explicit choice instead of resolving the quest immediately.
 *
 * A quest only authors a real decision when it offers more than one conclusion
 * AND at least one of them is currently reachable. A quest with no endings, or
 * with a single ending that simply records the completion outcome (the shape
 * the shipped side quests use), has nothing to choose between and keeps
 * normal auto-completion.
 *
 * A quest whose conclusions are all still locked has no valid choice to offer,
 * so it must not be parked in a resolution state the player cannot leave; the
 * caller resolves it through the ordinary no-choice path, which commits no
 * ending at all.
 *
 * @param options.endings - The quest's authored endings.
 * @param options.worldStateFlags - Current world state, for lock checks.
 * @returns True when the quest is resolution-ready and needs a player choice.
 */
export const requiresEndingChoice = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
  worldStateFlags: Readonly<Record<string, boolean>>;
}): boolean => {
  const endings = Object.values(options.endings);
  if (endings.length < 2) {
    return false;
  }
  return endings.some((ending) =>
    isEndingUnlocked({ ending, worldStateFlags: options.worldStateFlags }),
  );
};

/** Why an explicit ending choice was rejected, or `ok` when it is recordable. */
type EndingChoiceResult =
  | 'ok'
  | 'inactive-quest'
  | 'not-resolvable'
  | 'unknown-ending'
  | 'locked-ending';

/**
 * Validates an explicit ending choice and, when valid, commits it onto the
 * given progress object. The caller owns the progress record; this only writes
 * `chosenEndingId` on success.
 *
 * The choice is only recordable while the quest is genuinely at its resolution
 * point (`resolutionReady`). Accepting a quest, or walking its objectives, must
 * never expose the conclusion as an actionable decision — the ending belongs to
 * the final resolution moment, not to the whole quest.
 *
 * @returns `ok` when the choice was committed, otherwise the rejection reason.
 */
export const commitEndingChoice = (options: {
  endings: Readonly<Record<string, ContentPackQuestEnding>>;
  endingId: string;
  questActive: boolean;
  /** The quest has finished its objectives and awaits the final choice. */
  resolutionReady: boolean;
  worldStateFlags: Readonly<Record<string, boolean>>;
  progress: { chosenEndingId?: string };
}): EndingChoiceResult => {
  if (!options.questActive) {
    return 'inactive-quest';
  }
  if (!options.resolutionReady) {
    return 'not-resolvable';
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
