// packages/shared/schemas/src/lib/game/npc_memory.ts
//
// Per-NPC conversational memory — what an NPC remembers about the player
// between separate conversations. Persisted in the campaign save blob via the
// `npcMemory` serializable service. Every field is bounded (see
// NPC_MEMORY_LIMITS in @aikami/constants) so the save and the prompt budget
// never grow with play time: old detail is folded into the rolling `summary`
// instead of accumulating as raw transcript.

import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import Type, { type Static } from 'typebox';
import { NpcSuggestionChipSchema } from './npc_dialogue_command.ts';

// ---------------------------------------------------------------------------
// Transcript line — a single remembered utterance
// ---------------------------------------------------------------------------

export const NpcMemoryLineSchema = Type.Object(
  {
    /** Who spoke. */
    role: Type.Union([Type.Literal('player'), Type.Literal('npc')]),
    /** Utterance text (truncated to the per-line budget on capture). */
    content: Type.String({ maxLength: NPC_MEMORY_LIMITS.lineChars }),
  },
  { additionalProperties: false },
);

export type NpcMemoryLine = Static<typeof NpcMemoryLineSchema>;

// ---------------------------------------------------------------------------
// Opener — a pre-generated greeting for the next conversation
// ---------------------------------------------------------------------------

export const NpcMemoryOpenerSchema = Type.Object(
  {
    /** The NPC's first line when the player next talks to them. */
    text: Type.String({ minLength: 1 }),
    /** Suggestion chips that follow the opener. */
    suggestions: Type.Array(NpcSuggestionChipSchema),
    /** Epoch ms when the opener was generated — drives staleness. */
    generatedAt: Type.Number(),
    /** `conversationCount` the opener was generated for (invalidates on a new talk). */
    forConversation: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type NpcMemoryOpener = Static<typeof NpcMemoryOpenerSchema>;

// ---------------------------------------------------------------------------
// Record — everything one NPC remembers
// ---------------------------------------------------------------------------

export const NpcMemoryRecordSchema = Type.Object(
  {
    npcId: Type.String({ minLength: 1 }),
    /** Display name — used to resolve proximity events that carry only a name. */
    npcName: Type.String(),
    /** Completed conversations in which the player actually spoke. */
    conversationCount: Type.Integer({ minimum: 0 }),
    /** Epoch ms of the most recent completed conversation. */
    lastTalkedAt: Type.Number(),
    /** Rolling, compacted summary of every past conversation (NPC's point of view). */
    summary: Type.String({ maxLength: NPC_MEMORY_LIMITS.summaryChars }),
    /** Durable key facts (names, promises, favours, secrets shared). Deduplicated. */
    notes: Type.Array(Type.String({ maxLength: NPC_MEMORY_LIMITS.noteChars }), {
      maxItems: NPC_MEMORY_LIMITS.maxNotes,
    }),
    /** Tail of the most recent conversation — verbatim recall for the next talk. */
    lastExchange: Type.Array(NpcMemoryLineSchema, {
      maxItems: NPC_MEMORY_LIMITS.lastExchangeLines,
    }),
    /** Pre-generated greeting for the next conversation, if ready. */
    opener: Type.Optional(NpcMemoryOpenerSchema),
  },
  { additionalProperties: false },
);

export type NpcMemoryRecord = Static<typeof NpcMemoryRecordSchema>;

// ---------------------------------------------------------------------------
// State — the save envelope
// ---------------------------------------------------------------------------

export const NpcMemoryStateSchema = Type.Object(
  {
    /** Campaign the records belong to — records never leak across campaigns. */
    campaignId: Type.Optional(Type.String()),
    /** Records keyed by NPC ID. */
    records: Type.Record(Type.String(), NpcMemoryRecordSchema, {
      maxProperties: NPC_MEMORY_LIMITS.maxRecords,
    }),
  },
  { additionalProperties: false },
);

export type NpcMemoryState = Static<typeof NpcMemoryStateSchema>;

// ---------------------------------------------------------------------------
// Digest — LLM output that folds a finished conversation into memory AND
// prepares the next opener in the same (single, background) call.
// ---------------------------------------------------------------------------

export const NpcMemoryDigestSchema = Type.Object(
  {
    /** Updated rolling summary (prior summary + this conversation), NPC's POV. */
    summary: Type.String({ minLength: 1 }),
    /** Up to a handful of durable facts worth remembering verbatim. */
    notes: Type.Array(Type.String()),
    /** What the NPC says first the next time the player approaches. */
    opener: Type.String({ minLength: 1 }),
    /** 2–3 follow-up suggestion chips for the player after the opener. */
    suggestions: Type.Array(NpcSuggestionChipSchema),
  },
  { additionalProperties: false },
);

export type NpcMemoryDigest = Static<typeof NpcMemoryDigestSchema>;

/** LLM output for an opener-only refresh (memory unchanged, world moved on). */
export const NpcMemoryOpenerOutputSchema = Type.Object(
  {
    opener: Type.String({ minLength: 1 }),
    suggestions: Type.Array(NpcSuggestionChipSchema),
  },
  { additionalProperties: false },
);

export type NpcMemoryOpenerOutput = Static<typeof NpcMemoryOpenerOutputSchema>;
