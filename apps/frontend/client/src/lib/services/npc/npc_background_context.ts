// apps/frontend/client/src/lib/services/npc/npc_background_context.ts
//
// The INPUTS of an NPC background memory call: who the NPC is, what the world
// looks like, and which compiled prompt to send. (issue #382)
//
// WHY THIS IS ITS OWN MODULE
//
// Three of the four #382 memory fixes are decisions about these inputs, and all
// three need to be able to ask the same question — "what did the last call see?"
// — at three different moments: before dispatch, after the call returns, and
// when the player finally reads the greeting. Scattering that across a service
// meant the three answers could drift, and they had: the completion-time check
// compared the world fingerprint but never the persona, and no check at all
// existed at consumption time.
//
// Owning the inputs in one place also owns the two costs #422 measured:
//
//   - the world facts are read ONCE and projected down to what a bounded
//     background task can act on (`buildBackgroundWorldStateProjection`);
//   - the persona comes from `buildNpcPersonaForPrompt` WITHOUT the O(manifest)
//     full turn projection the previous code built and discarded for one string.
//
// The compiled-prompt cache is content-keyed, so a changed persona is a
// DIFFERENT key rather than a stale hit, and `clear()` drops everything on a
// campaign switch so one campaign cannot retain another's personas.

import { buildDigestSystemPrompt, buildOpenerSystemPrompt } from './npc_memory_utils.ts';
import {
  buildBackgroundWorldStateProjection,
  createNpcPromptCache,
  digestSystemPromptKey,
  type NpcPromptCache,
  openerPromptRevision,
  openerSystemPromptKey,
} from './npc_prompt_projection.ts';

/**
 * A content-free fingerprint of the world state an opener was generated against.
 *
 * Built from the task-relevant facts the opener prompt actually consumed, not
 * from a frame counter or a revision bumped by unrelated rendering — otherwise
 * every animation frame would invalidate every remembered NPC and the memory
 * would never survive a walk.
 *
 * A collision here costs one extra digest, never a wrong answer, because a
 * mismatch re-queues rather than applying.
 */
const worldStateFingerprint = (facts: readonly string[]): string => {
  let hash = 2166136261;
  for (const fact of [...facts].sort()) {
    for (let i = 0; i < fact.length; i += 1) {
      hash ^= fact.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

/** The NPC whose memory a background call is about. */
export type NpcBackgroundSubject = { npcId: string; npcName: string };

/**
 * What one background call would send, right now.
 *
 * Read once per question, never cached across questions: the point of
 * revalidation is to see the world as it is at the instant of the check, and a
 * memoised projection would defeat that by construction.
 */
export type NpcBackgroundInputs = {
  readonly persona: string;
  readonly gameStateFacts: string[];
  /** Fingerprint of `gameStateFacts`. */
  readonly fingerprint: string;
  /** Fingerprint of the persona, display name and template revision. */
  readonly promptRevision: string;
};

/** Reads the inputs a background memory call needs, and compiles its prompts. */
export type NpcBackgroundContextReader = {
  /** Everything the next call would see, without sending anything. */
  inputs(subject: NpcBackgroundSubject): NpcBackgroundInputs;
  /** The digest system prompt, compiled once per (persona, NPC name). */
  digestSystemPrompt(subject: NpcBackgroundSubject): string;
  /** The opener system prompt, compiled once per (persona, NPC name). */
  openerSystemPrompt(subject: NpcBackgroundSubject): string;
  /** Drops every compiled prompt — called on campaign switch and teardown. */
  clear(): void;
  /** Compiled-prompt cache counters, for the #382 measurement. */
  cacheStats(): NpcPromptCache['stats'];
};

/**
 * The world-fact and persona readers, injected.
 *
 * Injected rather than imported so this module stays free of service imports:
 * the memory service depends on the game state and dialogue services, and a
 * helper that also depended on them would make every consumer of the helper
 * drag in the whole engine.
 */
export const createNpcBackgroundContextReader = (options: {
  /** The task-relevant world facts, already projected for a background task. */
  readGameStateFacts: (npcId: string) => string[];
  /** The NPC's persona block, without a full turn projection. */
  readPersona: (subject: NpcBackgroundSubject) => string;
}): NpcBackgroundContextReader => {
  const { readGameStateFacts, readPersona } = options;
  const promptCache = createNpcPromptCache();

  const inputs = (subject: NpcBackgroundSubject): NpcBackgroundInputs => {
    const gameStateFacts = buildBackgroundWorldStateProjection(readGameStateFacts(subject.npcId));
    const persona = readPersona(subject);
    return {
      persona,
      gameStateFacts,
      fingerprint: worldStateFingerprint(gameStateFacts),
      // Persona + name + template revision. The world fingerprint cannot see
      // any of these, which is exactly why an authored persona rewrite used to
      // leave every prepared greeting in place and looking current.
      promptRevision: openerPromptRevision(persona, subject.npcName),
    };
  };

  const subjectOf = (subject: NpcBackgroundSubject): NpcBackgroundInputs => inputs(subject);

  return {
    inputs,
    cacheStats() {
      return promptCache.stats;
    },
    digestSystemPrompt(subject: NpcBackgroundSubject): string {
      const { persona } = subjectOf(subject);
      return promptCache.get(digestSystemPromptKey(persona, subject.npcName), () =>
        buildDigestSystemPrompt({ persona, npcName: subject.npcName }),
      ).text;
    },
    openerSystemPrompt(subject: NpcBackgroundSubject): string {
      const { persona } = subjectOf(subject);
      return promptCache.get(openerSystemPromptKey(persona, subject.npcName), () =>
        buildOpenerSystemPrompt({ persona, npcName: subject.npcName }),
      ).text;
    },
    clear(): void {
      // Compiled prompts are content-keyed, so an entry could never be served
      // for the wrong content — but a campaign switch should not RETAIN another
      // campaign's personas in memory either, and the bound is the point.
      promptCache.clear();
    },
  };
};
