// apps/frontend/client/src/lib/services/game/npc_dialogue_extraction.ts
//
// The C-401 call-2 contract: what the model is asked to produce after call 1
// has already streamed the narrative, and how the answer is validated.
//
// Issue #382 measured the previous contract on the local configuration and it
// did not work at all: `NpcDialogueAiEnvelopeSchema` required a `narrative`
// and the prompt told the model to "reuse the given narrative verbatim", so
// call 2 regenerated prose the client already had and treated as authoritative.
// Every measured envelope call hit its 6 000 ms budget and was discarded, which
// meant the player got deterministically derived choices instead of
// model-authored ones, at the cost of ~6 s of provider work per turn.
//
// The fix is to stop asking for output the task does not need. Call 2 now
// extracts state-changing metadata only. The narrative is never returned,
// never repaired, and never authoritative here — call 1 owns it.
//
// This module is deliberately pure: the caller supplies the narrative length
// used for log context, and decides what to do with a rejection. Nothing in
// here knows about the turn lifecycle, deadlines, or cancellation.

import { NpcDialogueExtractionSchema } from '@aikami/schemas';
import type { NpcDialogueChoice, NpcDialogueCommand } from '@aikami/types';
import { Value } from 'typebox/value';

/** The metadata call 2 is allowed to return. Neither field is required. */
export type DialogueExtraction = {
  command?: NpcDialogueCommand;
  choices?: NpcDialogueChoice[];
};

/** Why a call-2 payload was rejected. `keys` is for log context only. */
export type DialogueExtractionRejection =
  | { reason: 'not-an-object' }
  | { reason: 'schema-invalid'; keys: string[] };

export type DialogueExtractionParse =
  | { ok: true; value: DialogueExtraction }
  | ({ ok: false } & DialogueExtractionRejection);

/** The projection fields the extraction prompt actually needs. */
export type DialogueExtractionContext = {
  persona: string;
  npcName: string;
  allowedCommands: readonly string[];
};

/**
 * Builds the call-2 system prompt.
 *
 * Two requirements pull against each other here. The prompt must not ask the
 * model to reproduce the narrative — that is the bottleneck #382 measured. It
 * also must not strip the NPC context, because the model cannot infer a command
 * or a plausible set of choices without knowing who the NPC is and what they
 * are allowed to do. So the context is kept and the echo instruction is
 * inverted into an explicit prohibition.
 */
export function buildDialogueExtractionSystemPrompt(context: DialogueExtractionContext): string {
  return [
    '[NPC CONTEXT]',
    context.persona,
    `You are ${context.npcName}, staying in character.`,
    '',
    '[EXTRACTION]',
    'The narrative below was ALREADY spoken to the player, verbatim.',
    'Do not rewrite, summarize, quote, continue or return it.',
    '',
    'Return only the state-changing metadata for that narrative:',
    '- "command": optional, one of the allowed actions below.',
    '- "choices": optional array of at most 4 player options, each with "id",',
    '  "label", and optionally "command" or "nextDialogueKey".',
    '',
    'Return no other fields, and no prose outside the JSON.',
    `Allowed actions: ${context.allowedCommands.join(', ') || 'none'}.`,
    'Omit both fields when the narrative implies neither a command nor a choice.',
  ].join('\n');
}

/**
 * Validates raw call-2 output against {@link NpcDialogueExtractionSchema}.
 *
 * There is no repair path, and that is the point. The previous parser made one
 * repair attempt that merged the call-1 narrative into a malformed payload so
 * the envelope's required `narrative` field could be satisfied. With a metadata
 * -only schema there is nothing left to repair, so unknown fields and stray
 * output are rejected outright and the caller degrades to the streamed
 * narrative (AC-7).
 *
 * An empty object is VALID: "this narrative implies no command and no choice" is
 * a real, common outcome, not a failure.
 */
export function parseDialogueExtraction(rawOutput: unknown): DialogueExtractionParse {
  if (!rawOutput || typeof rawOutput !== 'object') {
    return { ok: false, reason: 'not-an-object' };
  }

  const candidate = rawOutput as Record<string, unknown>;
  if (Value.Check(NpcDialogueExtractionSchema, candidate)) {
    return { ok: true, value: candidate as DialogueExtraction };
  }

  return { ok: false, reason: 'schema-invalid', keys: Object.keys(candidate) };
}
