// apps/frontend/client/src/lib/services/npc/npc_memory_utils.ts
//
// Pure helpers for per-NPC conversational memory: transcript capture,
// bounded compaction, prompt projection and digest/opener prompt building.
// No state, no I/O — the service owns both and calls into these.

import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import type {
  NpcMemoryLine,
  NpcMemoryRecord,
  NpcMemoryState,
  NpcSuggestionChip,
} from '@aikami/types';

/** A dialogue utterance as the overlay holds it. */
type TranscriptMessage = { role: 'player' | 'npc'; content: string };

/** Collapses whitespace and hard-truncates to `max` characters (with ellipsis). */
export const clampText = (options: { text: string; max: number }): string => {
  const normalized = options.text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= options.max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, options.max - 1)).trimEnd()}…`;
};

/**
 * Keeps the most recent `max` characters of a rolling summary, cutting at a
 * sentence boundary so the oldest detail is what gets dropped.
 */
export const clampSummary = (summary: string): string => {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  const max = NPC_MEMORY_LIMITS.summaryChars;
  if (normalized.length <= max) {
    return normalized;
  }
  const tail = normalized.slice(normalized.length - max);
  const boundary = tail.search(/[.!?]\s/);
  return boundary >= 0 && boundary < tail.length / 2 ? tail.slice(boundary + 2) : tail;
};

/** Normalises transcript messages into bounded memory lines (drops empties). */
export const toMemoryLines = (messages: readonly TranscriptMessage[]): NpcMemoryLine[] =>
  messages
    .map((message) => ({
      role: message.role,
      content: clampText({ text: message.content, max: NPC_MEMORY_LIMITS.lineChars }),
    }))
    .filter((line) => line.content.length > 0);

/** Merges notes, case-insensitively de-duplicated, newest kept, bounded. */
export const mergeNotes = (options: {
  existing: readonly string[];
  incoming: readonly string[];
}): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];
  // Newest first so the cap evicts the oldest notes.
  for (const raw of [...options.incoming].reverse().concat([...options.existing].reverse())) {
    const note = clampText({ text: raw, max: NPC_MEMORY_LIMITS.noteChars });
    const key = note.toLowerCase();
    if (note.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(note);
  }
  return merged.slice(0, NPC_MEMORY_LIMITS.maxNotes).reverse();
};

/**
 * Deterministic memory update used when no AI digest is available (offline,
 * no provider, provider error). Records what the player raised so the NPC
 * still recalls the gist, and keeps the summary bounded.
 */
export const fallbackSummary = (options: {
  previous: string;
  lines: readonly NpcMemoryLine[];
}): string => {
  const playerLines = options.lines.filter((line) => line.role === 'player');
  if (playerLines.length === 0) {
    return options.previous;
  }
  const topics = clampText({
    text: playerLines.map((line) => line.content).join(' / '),
    max: 220,
  });
  const entry = `The player talked with me about: ${topics}.`;
  return clampSummary(options.previous ? `${options.previous} ${entry}` : entry);
};

/** Bounds and sanitises chips from the model (ids unique, count capped). */
export const sanitizeChips = (chips: readonly NpcSuggestionChip[]): NpcSuggestionChip[] => {
  const seen = new Set<string>();
  const result: NpcSuggestionChip[] = [];
  for (const chip of chips) {
    if (seen.has(chip.id)) {
      continue;
    }
    seen.add(chip.id);
    result.push({
      ...chip,
      label: clampText({ text: chip.label, max: 60 }),
      prefillText: clampText({ text: chip.prefillText, max: 200 }),
    });
    if (result.length >= NPC_MEMORY_LIMITS.maxOpenerSuggestions) {
      break;
    }
  }
  return result;
};

/** Evicts least-recently-talked-to records beyond the cap. Mutates `records`. */
export const evictOldest = (records: NpcMemoryState['records']): void => {
  const ids = Object.keys(records);
  if (ids.length <= NPC_MEMORY_LIMITS.maxRecords) {
    return;
  }
  const byAge = ids.sort(
    (a, b) => (records[a]?.lastTalkedAt ?? 0) - (records[b]?.lastTalkedAt ?? 0),
  );
  for (const id of byAge.slice(0, ids.length - NPC_MEMORY_LIMITS.maxRecords)) {
    delete records[id];
  }
};

/**
 * Projects a record into compact prompt facts. Bounded by construction:
 * summary + notes + last exchange are each capped at capture time.
 */
export const buildMemoryPromptFacts = (record: NpcMemoryRecord | undefined): string[] => {
  if (!record || record.conversationCount === 0) {
    return [];
  }
  const facts: string[] = [
    `[MEMORY] You have spoken with the player ${record.conversationCount} time(s) before. Treat them as someone you already know — do not re-introduce yourself or repeat what you already told them.`,
  ];
  if (record.summary) {
    facts.push(`[MEMORY] What you remember: ${record.summary}`);
  }
  if (record.notes.length > 0) {
    facts.push(`[MEMORY] Key facts: ${record.notes.join('; ')}`);
  }
  const tail = record.lastExchange.slice(-4);
  if (tail.length > 0) {
    const exchange = tail
      .map((line) => `${line.role === 'player' ? 'Player' : record.npcName}: ${line.content}`)
      .join(' | ');
    facts.push(`[MEMORY] How your last conversation ended: ${exchange}`);
  }
  return facts;
};

const CHIP_RULES =
  'Each suggestion chip: unique short id (snake_case), label ≤ 6 words, intentType "dialogue" unless clearly trade/quest/skill_check, prefillText a complete first-person sentence the player would say.';

/**
 * System prompt for the end-of-conversation digest: one background call that
 * compacts memory AND prepares the next opener, so a returning player gets a
 * fresh greeting with zero extra latency.
 */
export const buildDigestSystemPrompt = (options: { persona: string; npcName: string }): string =>
  [
    '[NPC CONTEXT]',
    options.persona,
    `You are ${options.npcName}. You are updating your own memory of the player after a conversation.`,
    '',
    'Return JSON with:',
    `- summary: your updated memory of the player, first person, merging the prior summary with this conversation. Keep what matters (who they are, what they asked, what you told or promised, how you feel about them). Max ${NPC_MEMORY_LIMITS.summaryChars} characters. Drop trivia.`,
    `- notes: up to ${NPC_MEMORY_LIMITS.maxNotes} short durable facts (names, promises, debts, secrets revealed, favours). Only new or still-true facts.`,
    `- opener: what you say FIRST the next time the player approaches you, in character, 1–2 sentences, referencing your shared history naturally. Never repeat your previous greeting. Max ${NPC_MEMORY_LIMITS.openerChars} characters.`,
    `- suggestions: 2–3 things the player might say next. ${CHIP_RULES}`,
  ].join('\n');

/** User prompt for the digest call — prior memory, world facts, transcript. */
export const buildDigestUserPrompt = (options: {
  record: NpcMemoryRecord | undefined;
  npcName: string;
  lines: readonly NpcMemoryLine[];
  gameStateFacts: readonly string[];
}): string => {
  const { record, npcName, lines, gameStateFacts } = options;
  const transcript = lines
    .slice(-NPC_MEMORY_LIMITS.digestTranscriptLines)
    .map((line) => `${line.role === 'player' ? 'Player' : npcName}: ${line.content}`);
  return [
    '[PRIOR SUMMARY]',
    record?.summary || '(none — this was your first conversation)',
    '',
    '[PRIOR NOTES]',
    record?.notes.length ? record.notes.map((note) => `- ${note}`).join('\n') : '(none)',
    '',
    '[CURRENT WORLD STATE]',
    gameStateFacts.length > 0 ? gameStateFacts.join('\n') : '(unknown)',
    '',
    '[CONVERSATION JUST FINISHED]',
    ...transcript,
  ].join('\n');
};

/** System prompt for an opener-only refresh (memory unchanged, world moved on). */
export const buildOpenerSystemPrompt = (options: { persona: string; npcName: string }): string =>
  [
    '[NPC CONTEXT]',
    options.persona,
    `You are ${options.npcName}. The player is approaching you again.`,
    '',
    'Return JSON with:',
    `- opener: your first line to them, in character, 1–2 sentences, informed by your memory and the current world state. Never repeat an earlier greeting verbatim. Max ${NPC_MEMORY_LIMITS.openerChars} characters.`,
    `- suggestions: 2–3 things the player might say next. ${CHIP_RULES}`,
  ].join('\n');

/** User prompt for an opener-only refresh. */
export const buildOpenerUserPrompt = (options: {
  record: NpcMemoryRecord;
  gameStateFacts: readonly string[];
}): string =>
  [
    ...buildMemoryPromptFacts(options.record),
    options.record.opener ? `[MEMORY] Your previous greeting was: ${options.record.opener.text}` : '',
    '',
    '[CURRENT WORLD STATE]',
    options.gameStateFacts.length > 0 ? options.gameStateFacts.join('\n') : '(unknown)',
  ]
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .join('\n');
