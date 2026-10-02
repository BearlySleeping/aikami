// apps/frontend/client/src/lib/services/npc/npc_opener_freshness.ts
//
// Is a PREPARED NPC greeting still the right thing to say? (issue #382)
//
// Extracted from the memory service because the answer is a pure function of
// three inputs — the opener, the state it was generated against, and the state
// right now — and because the question it answers is a PRODUCT question with
// three different answers depending on which input moved. Keeping it beside the
// service made all three look like one boolean, and the boolean was wrong in the
// direction that showed the player a stale line.
//
// THE THREE FAILURES, AND WHY THEY ARE NOT ONE
//
//   `no-opener`           There is nothing prepared. Ordinary background
//                         progress, not a correctness problem: the authored
//                         greeting is the correct answer and always was.
//   `wrong-conversation`  The opener was prepared for an EARLIER conversation.
//                         It has nothing to say to the player arriving for this
//                         one, however recently it was generated — the
//                         conversation it was written for has already happened.
//   `world-moved-on`      The quest it referenced is done, the item is carried,
//                         the save predates the stamps. Same shape, different
//                         cause, and the two are separated because only one of
//                         them is repairable by re-dating.
//   `prompt-revised`      The PERSONA or the template moved on. The world is
//                         byte-identical; the voice is one the author deleted.
//
// 🔴 AGE IS NOT ONE OF THEM. The max age bounds how often memory is looked at,
// not whether the answer became wrong. An opener that is old but whose world
// and persona are unchanged is still the right greeting, and #422 measured that
// re-asking the provider for it is a full call spent on a byte-identical
// prompt. Conflating age with validity would force a choice between suppressing
// a correct greeting and re-spending a call on every fifteen minutes of play.
//
// The asymmetry is deliberate throughout: an UNKNOWN stamp never matches a
// computed one, so a save written before these checks existed refreshes rather
// than being displayed on the strength of a comparison that could not be made.
// Refusing costs a background call; displaying a wrong line costs the player's
// sense that the game knows what just happened.

import type { NpcMemoryRecord } from '@aikami/types';

/** Why a prepared opener may not be shown. `undefined` means it may. */
export type OpenerRejection =
  | 'no-opener'
  | 'wrong-conversation'
  | 'world-moved-on'
  | 'prompt-revised';

/** The semantic state a prepared opener was generated against. */
export type OpenerInputs = {
  /** Fingerprint of the projected world facts the prompt consumed. */
  readonly worldFingerprint: string;
  /** Fingerprint of the persona, display name and template revision. */
  readonly promptRevision: string;
};

/**
 * Whether a record's opener may still be shown to the player.
 *
 * Pure: it reads the record and the state computed NOW, touches nothing, and
 * cannot change either. That is what makes it safe to call on the
 * dialogue-opening path, where anything expensive or stateful would be a bug.
 */
export const revalidateOpener = (
  record: NpcMemoryRecord,
  current: OpenerInputs,
): OpenerRejection | undefined => {
  const opener = record.opener;
  if (opener === undefined) {
    return 'no-opener';
  }
  if (opener.forConversation !== record.conversationCount) {
    return 'wrong-conversation';
  }
  // An ABSENT stamp never matches a computed one. A save from a build that did
  // not write them cannot be checked, and an unchecked greeting must not be
  // presented as though it had been.
  if (opener.worldFingerprint === undefined || opener.promptRevision === undefined) {
    return 'world-moved-on';
  }
  if (opener.worldFingerprint !== current.worldFingerprint) {
    return 'world-moved-on';
  }
  if (opener.promptRevision !== current.promptRevision) {
    return 'prompt-revised';
  }
  return undefined;
};
