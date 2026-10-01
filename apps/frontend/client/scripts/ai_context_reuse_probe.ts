// apps/frontend/client/scripts/ai_context_reuse_probe.ts
//
// Issue #382, this lane: what does a real turn actually COST, and which of the
// proposed context-reuse mechanisms would pay for themselves?
//
// The other #382 probes each answer one narrow question against the provider.
// This one answers the lane's question, which is about the CLIENT's own work:
//
//   P1 (no provider) — how much text does each real prompt carry, and how much
//     of it is identical to the previous call's? Repeated immutable blocks are
//     the argument for a compiled-prompt cache, and the argument is only worth
//     making if the repetition is real and large.
//   P2 (no provider) — how many provider calls does a realistic session issue
//     for MEMORY work, and how many of them re-ask a question whose inputs have
//     not changed? This is the repeat-hit distribution that decides whether an
//     exact-result cache has any production user at all.
//   P3 (provider) — does the native reasoning control help the bounded
//     background tasks, measured SEPARATELY for opener-refresh, digest and
//     session-summary, because #382 forbids changing a shared preset globally.
//
// Everything is content-free in its output: lengths, counts, hashes, timings.
// No prompt text, no completion text, no credentials.
//
//   bun run --cwd apps/frontend/client probe:ai-context-reuse
//   bun run --cwd apps/frontend/client probe:ai-context-reuse -- --only p3 --reps 5
//
// It lives in the CLIENT app, not in `apps/e2e`, because it imports the real
// prompt builders from this app's own `src`. C-455 forbids one app importing
// another's source, and a probe that re-implements the prompts it is measuring
// measures nothing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import {
  NpcMemoryDigestSchema,
  NpcMemoryOpenerOutputSchema,
  SessionSummaryOutputSchema,
} from '@aikami/schemas';
import type { NpcMemoryRecord } from '@aikami/types';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  buildDigestSystemPrompt,
  buildDigestUserPrompt,
  buildMemoryPromptFacts,
  buildOpenerSystemPrompt,
  buildOpenerUserPrompt,
  mergeNotes,
  toMemoryLines,
} from '../src/lib/services/npc/npc_memory_utils';
import {
  buildBackgroundWorldStateProjection,
  renderBackgroundFacts,
} from '../src/lib/services/npc/npc_prompt_projection';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-context-reuse');

// ---------------------------------------------------------------------------
// Fixtures — a returning NPC mid-campaign, sized like a real long session
// ---------------------------------------------------------------------------

/** An authored persona in the shape `buildNpcPersona` produces. */
const PERSONA = [
  'Voice: warm but measured.',
  'Manner: unhurried, deliberate, rarely raises her voice.',
  '',
  '[AGENDA]',
  '- Keep the ward stone turning until the mill is repaired.',
  '- Learn who drained the river last winter.',
  '',
  '[KNOWLEDGE]',
  '- The ward stone at the mill faded three nights ago.',
  '- The Crimson Covenant pays well and asks nothing.',
  '',
  '[SECRETS]',
  '- She already sold the mill deed and has not told the reeve.',
  '',
  '[BOUNDARIES]',
  '- Never names the Covenant aloud in the square.',
].join('\n');

const NPC_NAME = 'Elder Thalia';

/** A conversation long enough to hit every bound in `NPC_MEMORY_LIMITS`. */
const CONVERSATION: Array<{ role: 'player' | 'npc'; content: string }> = Array.from(
  { length: NPC_MEMORY_LIMITS.digestTranscriptLines + 6 },
  (_, index) =>
    index % 2 === 0
      ? {
          role: 'player' as const,
          content:
            `Turn ${index}: I need to know about the ward stone, the mill deed and who paid the smith.`.repeat(
              2,
            ),
        }
      : {
          role: 'npc' as const,
          content:
            `Turn ${index}: The stone failed at dusk, the deed is not mine to sell, and the smith was paid in silver.`.repeat(
              2,
            ),
        },
);

/** World-state facts as `buildGameStateFacts` produces them at MAX_TOTAL_FACTS. */
const WORLD_STATE_FACTS: string[] = [
  'Gold: 412',
  'Inventory: Ward Wand x1, Lantern (oil) x3, Cracked Seal, Rope, Hard Bread x2, Iron Key, Travel Rations, …',
  "Equipped: Ward Wand (main hand), Traveller's Cloak (chest)",
  'Active quest: "The Faded Stone" — next objective: Reach the mill before dusk',
  'Hint (easy mode only): the player needs "Ward Wand".',
  'Offerable quests: "A Debt Repaid" (id: debt_repaid), "Salt and Iron" (id: salt_iron) — elder_thalia can offer these.',
  'Game difficulty: easy. be very direct — openly name the item, person, and location the player needs (e.g. "Rollo at the inn has the Ward Wand"). NPCs volunteer helpful directions unprompted.',
  'Relationship: Elder Thalia trusts the player (rank 2).',
];

/** A record with a prior conversation already folded in. */
const buildRecord = (overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord => ({
  npcId: 'elder_thalia',
  npcName: NPC_NAME,
  conversationCount: 3,
  lastTalkedAt: 1_700_000_000_000,
  summary:
    'The player asked about the ward stone and the mill deed. I told them the stone failed at dusk and the deed is not mine to sell. They seem to be working for the reeve.',
  notes: mergeNotes({
    existing: ['Knows the smith was paid in silver.'],
    incoming: [
      'Promised to ask the reeve about the mill deed.',
      'Carries the Ward Wand.',
      'Does not yet know the Covenant paid the smith.',
    ],
  }),
  lastExchange: toMemoryLines(CONVERSATION).slice(-NPC_MEMORY_LIMITS.lastExchangeLines),
  opener: {
    text: 'Back so soon? The stone is no quieter than when you left, if you want to talk numbers instead of signs.',
    suggestions: [],
    generatedAt: 1_700_000_000_000,
    forConversation: 3,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// P1 — prompt composition: what is repeated, and how much of it
// ---------------------------------------------------------------------------

/**
 * Fraction of a prompt's characters that also appear in an earlier prompt.
 *
 * Computed on whitespace-normalised lines, because the reuse question is "does
 * the model re-read these exact lines", not "do these strings share
 * substrings". A substring measure would call the word "the" a repeat.
 */
const repeatedLineChars = (current: string, previous: readonly string[]): number => {
  const seen = new Set(previous.flatMap((prompt) => prompt.split('\n')));
  return current
    .split('\n')
    .filter((line) => line.trim().length > 0 && seen.has(line))
    .reduce((sum, line) => sum + line.length, 0);
};

const runP1 = (): Record<string, unknown> => {
  const record = buildRecord();
  const priorRecord = buildRecord({
    conversationCount: 2,
    summary: 'The player asked about the ward stone.',
    notes: ['Carries the Ward Wand.'],
    lastExchange: toMemoryLines(CONVERSATION).slice(0, 4),
    opener: undefined,
  });

  const digestSystem = buildDigestSystemPrompt({ persona: PERSONA, npcName: NPC_NAME });
  // Rendered BOTH ways, so the probe reports the before/after of the
  // projection rather than only the state after it.
  const render = renderBackgroundFacts;
  const join = (facts: readonly string[]): string => render(facts);
  // BEFORE (unprojected dialogue-grade facts, as the task used to receive them).
  const digestUserUnprojected = buildDigestUserPrompt({
    record: priorRecord,
    npcName: NPC_NAME,
    lines: record.lastExchange,
    gameStateFacts: WORLD_STATE_FACTS,
    renderFacts: join,
  });
  // AFTER (projected for a bounded background task).
  const digestUser = buildDigestUserPrompt({
    record: priorRecord,
    npcName: NPC_NAME,
    lines: record.lastExchange,
    gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
    renderFacts: join,
  });
  const openerSystem = buildOpenerSystemPrompt({ persona: PERSONA, npcName: NPC_NAME });
  const openerUser = buildOpenerUserPrompt({
    record,
    gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
    renderFacts: join,
  });
  const openerUserUnprojected = buildOpenerUserPrompt({
    record,
    gameStateFacts: WORLD_STATE_FACTS,
    renderFacts: join,
  });
  const memoryFacts = buildMemoryPromptFacts(record);

  const dialogueSystem = [
    '[NPC CONTEXT]',
    PERSONA,
    `Your name is ${NPC_NAME}.`,
    'Stay in character at all times. Respond as the NPC would.',
    '',
    'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
    'Do not break character. Do not mention being an AI.',
    "Reply with the NPC's spoken narrative ONLY — plain prose, no JSON.",
    '',
    '[GAME STATE]',
    ...WORLD_STATE_FACTS,
    ...memoryFacts,
    '',
    '[CONVERSATION HISTORY]',
    ...record.lastExchange.map(
      (line) => `${line.role === 'player' ? 'Player' : NPC_NAME}: ${line.content}`,
    ),
    '',
    '[ALLOWED ACTIONS]',
    'In this scene the NPC has these actions available: trade, offerQuest, skillCheck, presentEvidence.',
    'These are scene context only — do not output actions in your reply.',
  ].join('\n');

  // The opener prompt is the one that repeats ACROSS CALLS for the same NPC:
  // the persona, the rules, the memory block and the world facts are all
  // unchanged between two refreshes a minute apart.
  const openerUserLater = buildOpenerUserPrompt({
    record: buildRecord({ lastTalkedAt: 1_700_000_060_000 }),
    gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
    renderFacts: join,
  });
  const digestSystemLater = buildDigestSystemPrompt({ persona: PERSONA, npcName: NPC_NAME });

  const prompts: Record<string, string> = {
    digestSystem,
    digestUser,
    digestUserUnprojected,
    openerSystem,
    openerUser,
    openerUserUnprojected,
    dialogueSystem,
  };

  const sizes = Object.fromEntries(
    Object.entries(prompts).map(([name, text]) => [
      name,
      { chars: text.length, estTokens: Math.round(text.length / 4) },
    ]),
  );

  const openerUserRepeat = repeatedLineChars(openerUserLater, [openerUser]);
  const digestSystemRepeat = repeatedLineChars(digestSystemLater, [digestSystem]);

  // Persona is the single largest immutable block and appears in THREE of the
  // four production prompts. This is the number a compiled-template cache
  // would have to justify itself against.
  const personaChars = PERSONA.length;

  return {
    promptSizes: sizes,
    immutableBlock: {
      personaChars,
      personaShareOfDigestSystem: round(personaChars / digestSystem.length),
      personaShareOfOpenerSystem: round(personaChars / openerSystem.length),
      personaShareOfDialogueSystem: round(personaChars / dialogueSystem.length),
    },
    crossCallRepetition: {
      // What a second opener refresh for the same NPC, same world, re-reads.
      openerUserRepeatChars: openerUserRepeat,
      openerUserRepeatShare: round(openerUserRepeat / openerUserLater.length),
      openerUserTotalChars: openerUserLater.length,
      // The digest system prompt is pure template: 100% of it is re-read.
      digestSystemRepeatShare: round(digestSystemRepeat / digestSystem.length),
    },
    backgroundProjection: {
      // BEFORE: the unprojected dialogue-grade fact list, as the two bounded
      // background tasks used to receive it.
      digestUserCharsBefore: digestUserUnprojected.length,
      openerUserCharsBefore: openerUserUnprojected.length,
      // AFTER: the same prompts, projected.
      digestUserCharsAfter: digestUser.length,
      openerUserCharsAfter: openerUser.length,
      digestUserCharsSaved: digestUserUnprojected.length - digestUser.length,
      openerUserCharsSaved: openerUserUnprojected.length - openerUser.length,
      openerUserShareSaved: round(
        (openerUserUnprojected.length - openerUser.length) / openerUserUnprojected.length,
      ),
      // What was carried and could not be acted on.
      dropped: {
        difficultyGuidanceChars:
          WORLD_STATE_FACTS.find((fact) => fact.startsWith('Game difficulty:'))?.length ?? 0,
        equippedChars: WORLD_STATE_FACTS.find((fact) => fact.startsWith('Equipped:'))?.length ?? 0,
        hintChars: WORLD_STATE_FACTS.find((fact) => fact.startsWith('Hint ('))?.length ?? 0,
      },
      kept: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS).length,
      droppedCount:
        WORLD_STATE_FACTS.length - buildBackgroundWorldStateProjection(WORLD_STATE_FACTS).length,
    },
  };
};

// ---------------------------------------------------------------------------
// P2 — repeat-hit distribution: would an exact-result cache ever fire?
// ---------------------------------------------------------------------------

/**
 * Replays a realistic session against the CURRENT staleness rule and counts,
 * for each background call the service would issue, whether it re-asks a
 * question whose inputs are byte-identical to the call that produced the
 * opener already in hand.
 *
 * The inputs to an opener refresh are exactly: the memory record's projected
 * fields, and the world-state facts. The service already computes a
 * fingerprint of the world facts to REJECT a result; this counts how often
 * that same fingerprint would have answered "do not ask" instead.
 */
const runP2 = (): Record<string, unknown> => {
  const OpenerMaxAgeMs = 15 * 60 * 1000;
  const CooldownMs = 60 * 1000;

  // 40 minutes of play, sampled every 30 s: four map loads, one conversation,
  // and a walk past the same remembered NPC repeatedly.
  const samples: Array<{ atMs: number; event: string }> = [];
  for (let atMs = 0; atMs <= 40 * 60 * 1000; atMs += 30_000) {
    samples.push({ atMs, event: 'map-loaded' });
  }
  samples.push({ atMs: 5 * 60_000, event: 'map-loaded' });
  samples.push({ atMs: 6 * 60_000, event: 'conversation-end' });
  samples.push({ atMs: 6 * 60_000 + 1_000, event: 'proximity' });
  samples.push({ atMs: 7 * 60_000, event: 'proximity' });
  samples.push({ atMs: 8 * 60_000, event: 'proximity' });
  samples.sort((a, b) => a.atMs - b.atMs);

  const record = buildRecord();
  const worldFacts = [...WORLD_STATE_FACTS];
  const fingerprint = (facts: readonly string[]): string => {
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

  // The replay runs on a RELATIVE clock. `record.opener.generatedAt` is an
  // absolute epoch from the fixture; mixing it with relative sample times
  // produced negative ages, which read as "never stale" and made every call
  // look unnecessary. The opener is, by construction, the one the player was
  // just handed — so it starts at t=0.
  const StartGeneratedAt = 0;
  let opener: NpcMemoryRecord['opener'] = {
    ...record.opener!,
    generatedAt: StartGeneratedAt,
  };
  let conversationCount = record.conversationCount;
  let lastPrefetchAt = Number.NEGATIVE_INFINITY;
  // The inputs that decided the opener currently in hand.
  let appliedInputFingerprint = fingerprint([
    buildMemoryPromptFacts(record).join('\n'),
    ...worldFacts,
  ]);
  let memoryRevision = 0;

  const calls: Array<{
    atMs: number;
    event: string;
    issued: boolean;
    reason: string;
  }> = [];

  for (const sample of samples) {
    // A finished conversation CONSUMES the opener and bumps the count, exactly
    // as `recordConversation` does. Without this the replay would never
    // reproduce the case that matters most: an opener that is missing because
    // the player just spoke to the NPC.
    if (sample.event === 'conversation-end') {
      memoryRevision += 1;
      conversationCount += 1;
      opener = undefined;
    }
    const age = sample.atMs - (opener?.generatedAt ?? Number.NEGATIVE_INFINITY);
    const stale =
      opener === undefined || opener.forConversation !== conversationCount || age > OpenerMaxAgeMs;
    if (!stale) {
      calls.push({ atMs: sample.atMs, event: sample.event, issued: false, reason: 'opener-fresh' });
      continue;
    }
    if (sample.atMs - lastPrefetchAt < CooldownMs) {
      calls.push({ atMs: sample.atMs, event: sample.event, issued: false, reason: 'cooldown' });
      continue;
    }
    // The inputs that decide the answer: memory projection + world facts.
    const memoryProjection = buildMemoryPromptFacts(buildRecord({ conversationCount })).join('\n');
    const inputFingerprint = fingerprint([memoryProjection, ...worldFacts]);
    const sameInputsAsLastApplied = inputFingerprint === appliedInputFingerprint;
    lastPrefetchAt = sample.atMs;
    calls.push({
      atMs: sample.atMs,
      event: sample.event,
      issued: true,
      reason: sameInputsAsLastApplied ? 'unchanged-inputs' : 'inputs-changed',
    });
    // The applied opener updates generatedAt, which is what resets the timer.
    opener = {
      text: 'A greeting the model produced for exactly these inputs.',
      suggestions: [],
      generatedAt: sample.atMs,
      forConversation: conversationCount,
    };
    appliedInputFingerprint = inputFingerprint;
  }

  const issued = calls.filter((call) => call.issued);
  return {
    samplesConsidered: calls.length,
    callsIssued: issued.length,
    callsAvoidable: issued.filter((call) => call.reason === 'unchanged-inputs').length,
    callsWithChangedInputs: issued.filter((call) => call.reason === 'inputs-changed').length,
    repeatHitShare: round(
      issued.filter((call) => call.reason === 'unchanged-inputs').length /
        Math.max(1, issued.length),
    ),
    memoryRevision,
    // The digest, for contrast: one per conversation, and every one of them
    // carries a DIFFERENT transcript, so none of them is ever a repeat.
    digestCalls: 1,
    digestRepeatable: false,
    perCall: calls,
  };
};

// ---------------------------------------------------------------------------
// P3 — native reasoning control, measured per background task
// ---------------------------------------------------------------------------

type NativeCallResult = {
  label: string;
  ok: boolean;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningChars: number;
  contentChars: number;
  valid: boolean;
  doneReason: string;
  error?: string;
};

/** The three bounded background tasks, each with its OWN prompt. */
const backgroundTasks = (): Array<{
  label: string;
  system: string;
  user: string;
  shape: 'digest' | 'opener' | 'summary';
}> => {
  const record = buildRecord();
  return [
    {
      label: 'opener-refresh',
      shape: 'opener',
      system: buildOpenerSystemPrompt({ persona: PERSONA, npcName: NPC_NAME }),
      user: buildOpenerUserPrompt({
        record,
        gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
        renderFacts: renderBackgroundFacts,
      }),
    },
    {
      label: 'npc-digest',
      shape: 'digest',
      system: buildDigestSystemPrompt({ persona: PERSONA, npcName: NPC_NAME }),
      user: buildDigestUserPrompt({
        record: buildRecord({ conversationCount: 2, opener: undefined }),
        npcName: NPC_NAME,
        lines: record.lastExchange,
        gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
        renderFacts: renderBackgroundFacts,
      }),
    },
    {
      label: 'session-summary',
      shape: 'summary',
      system: 'Summarize RPG sessions concisely. JSON only. No markdown, no explanations.',
      user: [
        'Summarize a 95-minute play session in Emberwatch.',
        '',
        'Respond with JSON:',
        '{',
        '  "synopsis": "3-5 sentence summary of the session",',
        '  "keyEvents": ["Event 1", "Event 2", ...],',
        '  "npcInteractions": [{"npcName": "...", "context": "..."}]',
        '}',
        '',
        'Keep the entire response under 2 KB.',
      ].join('\n'),
    },
  ];
};

const runNativeCall = async (options: {
  system: string;
  user: string;
  schema: TSchema;
  think: boolean;
  numPredict: number;
}): Promise<NativeCallResult> => {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    stream: false,
    format: options.schema,
    options: { num_predict: options.numPredict },
  };
  // A 200 is NOT a honoured field. `think` is only counted as honoured if the
  // response actually carries no reasoning characters — which is what this
  // probe measures rather than assumes.
  if (!options.think) {
    body.think = false;
  }

  const start = performance.now();
  try {
    const response = await fetch(`${ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = JSON.parse(text) as {
      message?: { content?: string; thinking?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
      error?: string;
    };
    const content = payload.message?.content ?? '';
    const reasoning = payload.message?.thinking ?? '';
    let valid = false;
    try {
      const parsed: unknown = JSON.parse(content);
      valid = Value.Check(options.schema, parsed);
    } catch {
      valid = false;
    }
    return {
      label: options.think ? 'reasoning-on' : 'reasoning-off',
      ok: response.ok,
      totalMs: Math.round(performance.now() - start),
      promptTokens: payload.prompt_eval_count ?? -1,
      completionTokens: payload.eval_count ?? -1,
      reasoningChars: reasoning.length,
      contentChars: content.length,
      valid,
      doneReason: payload.done_reason ?? '',
      ...(payload.error === undefined ? {} : { error: payload.error }),
    };
  } catch (error: unknown) {
    return {
      label: options.think ? 'reasoning-on' : 'reasoning-off',
      ok: false,
      totalMs: Math.round(performance.now() - start),
      promptTokens: -1,
      completionTokens: -1,
      reasoningChars: 0,
      contentChars: 0,
      valid: false,
      doneReason: '',
      error: String(error),
    };
  }
};

const BACKGROUND_SCHEMAS = {
  digest: NpcMemoryDigestSchema,
  opener: NpcMemoryOpenerOutputSchema,
  summary: SessionSummaryOutputSchema,
} as const satisfies Record<string, TSchema>;

const runP3 = async (): Promise<Record<string, unknown>> => {
  const results: Array<NativeCallResult & { task: string; rep: number }> = [];
  for (const task of backgroundTasks()) {
    for (let rep = 0; rep < REPS; rep += 1) {
      for (const think of [true, false]) {
        const result = await runNativeCall({
          system: task.system,
          user: task.user,
          schema: BACKGROUND_SCHEMAS[task.shape],
          think,
          numPredict: 400,
        });
        results.push({ ...result, task: task.label, rep });
      }
    }
  }
  const summarize = (task: string, label: string): Record<string, unknown> => {
    const rows = results.filter((row) => row.task === task && row.label === label);
    const ok = rows.filter((row) => row.ok);
    return {
      n: rows.length,
      ok: ok.length,
      valid: ok.filter((row) => row.valid).length,
      medianMs: median(ok.map((row) => row.totalMs)),
      maxMs: ok.length === 0 ? 0 : Math.max(...ok.map((row) => row.totalMs)),
      medianCompletionTokens: median(ok.map((row) => row.completionTokens)),
      medianReasoningChars: median(ok.map((row) => row.reasoningChars)),
      medianPromptTokens: median(ok.map((row) => row.promptTokens)),
    };
  };
  const out: Record<string, unknown> = {};
  for (const task of backgroundTasks()) {
    out[task.label] = {
      'reasoning-on': summarize(task.label, 'reasoning-on'),
      'reasoning-off': summarize(task.label, 'reasoning-off'),
    };
  }
  return { endpoint: ENDPOINT, model: MODEL, perTask: out, raw: results };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const round = (value: number): number => Math.round(value * 1000) / 1000;
const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};
function readNumberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function readStringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ENDPOINT = process.env.AIKAMI_PROBE_ENDPOINT ?? 'http://127.0.0.1:11434';
const MODEL = process.env.AIKAMI_PROBE_MODEL ?? 'ornith-1.5:9b';
const REPS = readNumberFlag('--reps') ?? 3;
const ONLY = readStringFlag('--only');

const main = async (): Promise<void> => {
  mkdirSync(OUT_DIR, { recursive: true });
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    lane: 'perf/382-measured-context-reuse',
    base: '98df13ddc041e58c1d501363240d727e23935b96',
  };
  if (ONLY === undefined || ONLY === 'p1') {
    report.p1PromptComposition = runP1();
  }
  if (ONLY === undefined || ONLY === 'p2') {
    report.p2RepeatHitDistribution = runP2();
  }
  if (ONLY === undefined || ONLY === 'p3') {
    report.p3NativeReasoningControl = await runP3();
  }
  const name = ONLY === undefined ? 'full' : ONLY;
  const path = join(OUT_DIR, `context-reuse-${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nevidence: ${path}`);
};

await main();
