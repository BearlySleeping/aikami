// apps/frontend/client/src/lib/services/game/npc_dialogue_prompts.ts
//
// Pure prompt assembly for the C-401 two-call NPC dialogue split.
//
// Extracted from `npc_dialogue_service.svelte.ts` (issue #382) so the prompt
// TEXT — its sections, their order and their stability — is a pure function
// that can be tested directly, rather than a private method reachable only
// through a configured service and a mocked transport.
//
// 🔴 WHY THE ORDER IS WHAT IT IS
//
// A provider's prompt/KV cache can only reuse a PREFIX of the prompt. A block
// placed after per-turn state is a block that re-transmits on every turn that
// state changes. The narrative system prompt therefore emits its STABLE blocks
// first:
//
//   - `[NPC CONTEXT]` + persona — authored identity. Constant for the NPC.
//   - `[ALLOWED ACTIONS]` — derived from content-pack capabilities. Constant
//     for the NPC.
//
// and its PER-TURN blocks after:
//
//   - `[GAME STATE]` — gold, inventory, quests, difficulty, relationship.
//   - `[RELATIONSHIPS]`, `[CONVERSATION HISTORY]`, `[COMPANION WITNESSED]`.
//
// Before this change `[ALLOWED ACTIONS]` was the LAST section, after the state
// it describes, so the cacheable prefix stopped at the persona. The section
// CONTENTS are unchanged and nothing was removed: a model still receives every
// instruction, and now receives it above the state it applies to.
//
// The ordering claim is bounded honestly: whether a given provider actually
// caches a prefix, and how much that saves, is a property of THAT provider on
// THAT runtime. On the pinned local runtime `prompt_eval_cached_count` exists
// and is reported per call in telemetry; on any other provider it is UNKNOWN,
// and this module does not assume otherwise.

import type { NpcDialogueCommandKind } from '@aikami/types';

/** The per-turn context a narrative system prompt is assembled from. */
export type NarrativePromptContext = {
  persona: string;
  npcName: string;
  /** Bounded recent-conversation window, already formatted. */
  memory: readonly string[];
  gameStateFacts: readonly string[];
  relationshipFacts: readonly string[];
  allowedCommands: readonly NpcDialogueCommandKind[];
  /** Events a companion NPC witnessed, already formatted. */
  companionWitnessed: readonly string[];
};

/**
 * The system prompt for the streamed narrative call (call 1).
 *
 * Asks for plain prose — never JSON — so tokens stream as readable narrative.
 */
export const buildNarrativeSystemPrompt = (context: NarrativePromptContext): string => {
  const lines: string[] = [
    '[NPC CONTEXT]',
    context.persona,
    `Your name is ${context.npcName}.`,
    '',
    // STABLE: derived from the NPC's content-pack capabilities.
    '[ALLOWED ACTIONS]',
    `In this scene the NPC has these actions available: ${context.allowedCommands.join(', ') || 'none'}.`,
    'These are scene context only — do not output actions in your reply.',
    '',
    'Stay in character at all times. Respond as the NPC would.',
    'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
    'Do not break character. Do not mention being an AI.',
    "Reply with the NPC's spoken narrative ONLY — plain prose, no JSON.",
  ];

  // PER-TURN from here down.
  if (context.gameStateFacts.length > 0) {
    lines.push('', '[GAME STATE]', ...context.gameStateFacts);
  }

  if (context.relationshipFacts.length > 0) {
    lines.push('', '[RELATIONSHIPS]', ...context.relationshipFacts);
  }

  if (context.memory.length > 0) {
    lines.push('', '[CONVERSATION HISTORY]', ...context.memory);
  }

  // C-494 AC-3: witness recall surfaces an event this companion actually
  // witnessed, in their own voice. Injected as background — the companion
  // raises it unprompted rather than as a numeric readout.
  if (context.companionWitnessed.length > 0) {
    lines.push(
      '',
      '[COMPANION WITNESSED]',
      ...context.companionWitnessed,
      'Bring this up naturally, in your own voice, without being asked.',
    );
  }

  return lines.join('\n');
};
