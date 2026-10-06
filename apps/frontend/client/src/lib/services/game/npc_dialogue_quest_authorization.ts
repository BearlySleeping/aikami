// apps/frontend/client/src/lib/services/game/npc_dialogue_quest_authorization.ts
//
// C-568: authoritative quest ownership and offerability.
//
// ---------------------------------------------------------------------------
// Why this is its own module
// ---------------------------------------------------------------------------
//
// `_deriveAllowedCommands` pushes `offerQuest` for EVERY npc, on the stated
// assumption that it is "gated by per-quest precondition in dispatch". That
// precondition checked only that the quest EXISTS in the content pack, because
// `game_composition_root` omitted `offeredByNpcId` from the quest projection —
// so it had no way to know WHO owns the quest.
//
// On the real Emberwatch pack every quest names its offerer, so any NPC could
// be driven to offer any other NPC's quest and the dispatch succeeded. That is
// an authorization defect, not a prompt problem, and it is not specific to the
// decision path: with decision routing off (the default) the command still comes
// from the text model and still reached `executeCommand`.
//
// The check lives here so the dialogue service keeps the ownership RULE and this
// module keeps the reasoning. Both call sites — pre-attach in the turn and
// `executeCommand` at the mutation boundary — go through it, so there is one
// answer to "may this NPC offer this quest".

import type { QuestStateServiceInterface } from './quest_state_service.svelte.ts';

/** The shape the check needs from the quest projection. */
export type OfferableQuestProjection = {
  readonly id: string;
  readonly offeredByNpcId?: string;
};

/** Why an `offerQuest` command is or is not authorized. */
type QuestOfferAuthorization =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: string;
    };

/**
 * Whether a quest is authored as some other NPC's to offer.
 *
 * A quest with no `offeredByNpcId` is open to anyone and is NOT a violation.
 */
const offeredByAnotherNpc = (quest: OfferableQuestProjection, npcId: string): boolean =>
  quest.offeredByNpcId !== undefined && quest.offeredByNpcId !== npcId;

/**
 * The `offerQuest` precondition, in full.
 *
 * Returns exactly the shape `_validateCommandPreconditions` expects so the
 * dialogue service's case body is one call — the ownership RULE and its
 * reasoning stay together rather than being split across a 2 800-line service.
 */
export const questOfferPrecondition = (options: {
  readonly questId: string | undefined;
  readonly npcId: string;
  readonly contentProvider: {
    getQuest(questId: string): OfferableQuestProjection | undefined;
  };
  readonly questState: Pick<QuestStateServiceInterface, 'getOfferableQuests'>;
}): { readonly allowed: boolean; readonly reason?: string } => {
  const { questId, npcId, contentProvider, questState } = options;
  if (!questId) {
    return { allowed: false, reason: 'offerQuest missing questId' };
  }
  const quest = contentProvider.getQuest(questId);
  if (quest === undefined) {
    return { allowed: false, reason: `quest ${questId} not found` };
  }
  return authorizeQuestOffer({ questId, npcId, quest, questState });
};

/**
 * Authorizes an NPC offering a quest.
 *
 * `getOfferableQuests` is the same authoritative enumeration the decision path
 * derives its candidate set from, so the two agree by construction rather than
 * by convention: it filters on `offeredByNpcId` AND `canAcceptQuest`, which
 * means it also refuses a quest that is already active, declined, or blocked by
 * a chain prerequisite.
 *
 * With no quest-state loader configured this refuses everything. That is the
 * conservative reading: an NPC cannot be shown to be permitted to offer
 * anything, so it is not authorized to offer anything.
 */
const authorizeQuestOffer = (options: {
  readonly questId: string;
  readonly npcId: string;
  readonly quest: OfferableQuestProjection | undefined;
  readonly questState: Pick<QuestStateServiceInterface, 'getOfferableQuests'>;
}): QuestOfferAuthorization => {
  const { questId, npcId, quest, questState } = options;
  if (quest === undefined) {
    return { allowed: false, reason: `quest ${questId} is not currently offerable by ${npcId}` };
  }
  if (questState.getOfferableQuests(npcId).some((entry) => entry.id === questId)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: offeredByAnotherNpc(quest, npcId)
      ? `quest ${questId} is offered by another npc`
      : `quest ${questId} is not currently offerable by ${npcId}`,
  };
};
