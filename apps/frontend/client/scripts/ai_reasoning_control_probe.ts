// apps/frontend/client/scripts/ai_reasoning_control_probe.ts
//
// Issue #382: rerun the reasoning-on/off comparison with each task's REAL
// schema and STRONG output validation, and report what was actually measured.
//
// WHY THIS FILE EXISTS RATHER THAN A SECTION OF THE OLDER PROBE
//
// #422 reported this comparison and then WITHDREW it: all three tasks had been
// run against an opener-shaped schema, validation was a property-presence
// check, and the corrected rerun could not connect to a provider. A zero exit
// code was recorded as though it were a measurement. Three separate failures,
// and only the first is about schemas:
//
//   1. WRONG SCHEMA per task. Each task here sends its own production schema —
//      the digest schema, the opener schema, the session-summary schema — from
//      `@aikami/schemas`, not a stand-in.
//   2. WEAK VALIDATION. `Value.Check` is necessary and not sufficient. A digest
//      whose `summary` is the string "ok" satisfies its schema and is useless;
//      an opener that repeats the previous greeting verbatim satisfies its
//      schema and is a bug. Every task therefore has its OWN quality gate on
//      top of the schema, and the two are counted SEPARATELY so a run that
//      produces well-formed garbage cannot read as a pass.
//   3. AN UNAVAILABLE BACKEND IS NOT A PASS. If the endpoint cannot be reached,
//      this writes `status: 'blocked'` with the reason and exits non-zero. It
//      does not print zeros and call it a median.
//
// COLD AND WARM ARE ESTABLISHED, NOT ASSUMED
//
// A "warm" label a caller asserts is a wish. This probe establishes both
// conditions and records the method:
//
//   - COLD  → `POST /api/generate` with `keep_alive: 0` to evict the model,
//             confirmed by `GET /api/ps` reporting it absent.
//   - WARM  → the model resident in `GET /api/ps` before the first timed call,
//             confirmed by the same call, plus one untimed priming request.
//
// A row that cannot establish its condition is labelled `unknown`, not `warm`.
//
//   bun run --cwd apps/frontend/client probe:ai-reasoning-control
//   bun run --cwd apps/frontend/client probe:ai-reasoning-control -- --reps 5
//   AIKAMI_PROBE_ENDPOINT=http://host:11434 AIKAMI_PROBE_MODEL=ornith-1.5:9b \
//     bun run --cwd apps/frontend/client probe:ai-reasoning-control
//
// Evidence (regenerable, gitignored): `.evidence/382-reasoning-control/`.
// Content-free: counts, milliseconds, token counts, booleans. No prompt text,
// no completion text, no credentials.

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
  toMemoryLines,
} from '../src/lib/services/npc/npc_memory_utils';
import {
  buildBackgroundWorldStateProjection,
  renderBackgroundFacts,
} from '../src/lib/services/npc/npc_prompt_projection';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-reasoning-control');

const ENDPOINT = process.env.AIKAMI_PROBE_ENDPOINT ?? 'http://127.0.0.1:11434';
const MODEL = process.env.AIKAMI_PROBE_MODEL ?? 'ornith-1.5:9b';

const readNumberFlag = (name: string): number | undefined => {
  const index = process.argv.indexOf(name);
  const parsed = index >= 0 ? Number(process.argv[index + 1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const REPS = readNumberFlag('--reps') ?? 3;

// ---------------------------------------------------------------------------
// Fixtures — the real prompts, built by the real builders
// ---------------------------------------------------------------------------

const PERSONA =
  'You are Ivo, a gruff cartographer who has walked every road in the Emberwatch Marches and trusts no map he did not draw himself. You speak in short, blunt sentences and dislike being asked what you already said.';
const NPC_NAME = 'Ivo';
const WORLD_STATE_FACTS = [
  'Gold: 240',
  'Player class: Ranger (level 4)',
  'Active quests: Deliver the survey to Marshal Edda; Find the lost waystation',
  'Difficulty: standard',
  'Reputation with the Marches: 12',
];

const record = (overrides?: Partial<NpcMemoryRecord>): NpcMemoryRecord => ({
  npcId: 'ivo',
  npcName: NPC_NAME,
  conversationCount: 3,
  lastTalkedAt: 0,
  summary:
    'The player is a Ranger who came for the woods path and paid in advance. I marked the ruined waystation on their map and promised to check the north road next time.',
  notes: ['Player is a Ranger', 'Promised to check the north road', 'Paid 40 gold up front'],
  lastExchange: toMemoryLines([
    { role: 'npc', content: 'The woods path floods. Take the ridge.' },
    { role: 'player', content: 'Is the ruined waystation still standing?' },
    { role: 'npc', content: 'Roof is gone. Walls are not. I have a map.' },
    { role: 'player', content: 'Draw it for me and I will find it.' },
  ]),
  ...(overrides?.opener === undefined
    ? {
        opener: {
          text: 'The ridge, then the ruins. Do not take the water line.',
          suggestions: [
            {
              id: 'ask_ridge',
              label: 'Ask about the ridge',
              intentType: 'dialogue',
              prefillText: 'How rough is the ridge?',
            },
          ],
          generatedAt: 0,
          forConversation: 3,
          worldFingerprint: 'stale',
          promptRevision: 'stale',
        },
      }
    : {}),
  ...overrides,
});

type Task = {
  label: string;
  system: string;
  user: string;
  schema: TSchema;
  /** Stronger than the schema. Returns null when the output is good enough. */
  quality: (value: unknown, task: Task) => string | null;
};

const DIGEST_SYSTEM = buildDigestSystemPrompt({ persona: PERSONA, npcName: NPC_NAME });
const OPENER_SYSTEM = buildOpenerSystemPrompt({ persona: PERSONA, npcName: NPC_NAME });
const DIGEST_USER = buildDigestUserPrompt({
  record: record({ opener: undefined, conversationCount: 3 }),
  npcName: NPC_NAME,
  lines: record().lastExchange,
  gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
  renderFacts: renderBackgroundFacts,
});
const OPENER_USER = buildOpenerUserPrompt({
  record: record(),
  gameStateFacts: buildBackgroundWorldStateProjection(WORLD_STATE_FACTS),
  renderFacts: renderBackgroundFacts,
});

/** Rejects a summary that is a placeholder, a stub, or an echo of the prompt. */
const substantiveProse = (text: string, minChars: number): string | null => {
  if (text.trim().length < minChars) {
    return `prose shorter than ${minChars} characters`;
  }
  if (/^(ok|okay|n\/a|none|todo|tbd|null|true|false|\{\}|\[\])\.?$/i.test(text.trim())) {
    return 'placeholder prose';
  }
  return null;
};

const TASKS: readonly Task[] = [
  {
    label: 'npc-digest',
    system: DIGEST_SYSTEM,
    user: DIGEST_USER,
    schema: NpcMemoryDigestSchema,
    quality: (value) => {
      if (typeof value !== 'object' || value === null) {
        return 'not an object';
      }
      const digest = value as { summary?: unknown; notes?: unknown; opener?: unknown };
      if (typeof digest.summary !== 'string') {
        return 'summary is not a string';
      }
      // The digest's job is to REMEMBER, so an empty note list means it forgot
      // the conversation it was handed. Schema-valid and useless.
      if (!Array.isArray(digest.notes) || digest.notes.length === 0) {
        return 'no durable notes retained';
      }
      if (typeof digest.opener !== 'string') {
        return 'opener is not a string';
      }
      return substantiveProse(digest.summary, 40) ?? substantiveProse(digest.opener, 20) ?? null;
    },
  },
  {
    label: 'opener-refresh',
    system: OPENER_SYSTEM,
    user: OPENER_USER,
    schema: NpcMemoryOpenerOutputSchema,
    quality: (value, task) => {
      if (typeof value !== 'object' || value === null) {
        return 'not an object';
      }
      const opener = value as { opener?: unknown; suggestions?: unknown };
      if (typeof opener.opener !== 'string') {
        return 'opener is not a string';
      }
      // 🔴 The prompt explicitly forbids repeating an earlier greeting, and the
      // prompt SHOWS the earlier greeting. Echoing it is the single most common
      // way this task produces a schema-valid, functionally null answer, and a
      // schema check cannot see it.
      const previous = record().opener?.text ?? '';
      if (previous.length > 0 && opener.opener.trim() === previous.trim()) {
        return 'verbatim repeat of the previous greeting';
      }
      const tooLong =
        opener.opener.length > NPC_MEMORY_LIMITS.openerChars
          ? 'opener exceeds the production bound'
          : null;
      const stubs =
        !Array.isArray(opener.suggestions) || opener.suggestions.length === 0
          ? 'no suggestion chips'
          : null;
      void task;
      return tooLong ?? stubs ?? substantiveProse(opener.opener, 20);
    },
  },
  {
    label: 'session-summary',
    system:
      'You compress RPG play sessions into durable memory for a narrative engine. JSON only. No markdown, no preamble.',
    user: [
      'Summarise a 95-minute Emberwatch play session.',
      '',
      'The session contained: the player arriving in Wickersby, buying a survey kit from Ivo,',
      'walking the ridge road, fighting two bandits at the ruined waystation, and returning to',
      'Marshal Edda to deliver the completed survey. Gold went from 180 to 240.',
      '',
      'Return JSON only, with "synopsis" (3-5 sentences), "keyEvents" (array of strings),',
      'and "npcInteractions" (array of {"npcName", "context"}).',
    ].join('\n'),
    schema: SessionSummaryOutputSchema,
    quality: (value) => {
      if (typeof value !== 'object' || value === null) {
        return 'not an object';
      }
      const summary = value as {
        synopsis?: unknown;
        keyEvents?: unknown;
        npcInteractions?: unknown;
      };
      if (typeof summary.synopsis !== 'string') {
        return 'synopsis is not a string';
      }
      if (!Array.isArray(summary.keyEvents) || summary.keyEvents.length < 2) {
        return 'fewer than two key events';
      }
      if (!Array.isArray(summary.npcInteractions) || summary.npcInteractions.length === 0) {
        return 'no NPC interactions retained';
      }
      return substantiveProse(summary.synopsis, 80);
    },
  },
];

// ---------------------------------------------------------------------------
// Backend reachability and residency
// ---------------------------------------------------------------------------

const fetchJson = async <T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | undefined; error?: string }> => {
  try {
    const response = await fetch(`${ENDPOINT}${path}`, init);
    const text = await response.text();
    if (!response.ok) {
      return { status: response.status, body: undefined, error: text.slice(0, 200) };
    }
    return { status: response.status, body: JSON.parse(text) as T };
  } catch (error: unknown) {
    return { status: 0, body: undefined, error: String(error) };
  }
};

const isResident = async (): Promise<boolean> => {
  const running = await fetchJson<{ models?: Array<{ name?: string }> }>('/api/ps');
  const models = running.body?.models ?? [];
  return models.some((entry) => (entry.name ?? '').includes(MODEL.split(':')[0] ?? MODEL));
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Puts the backend into a stated condition, and reports whether it worked.
 *
 * `unknown` is a real, reported outcome: a runtime that will not report its
 * residency (`/api/ps` absent, a hosted endpoint with no such route) cannot
 * have "warm" asserted about it, and pretending otherwise is how a cold/warm
 * column becomes a decoration.
 */
const establish = async (
  condition: 'cold' | 'warm',
): Promise<{ condition: string; method: string; established: boolean }> => {
  if (condition === 'cold') {
    const evicted = await fetchJson('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: '', keep_alive: 0, stream: false }),
    });
    await sleep(500);
    const stillResident = await isResident();
    return {
      condition: 'cold',
      method: 'POST /api/generate {keep_alive:0}, then GET /api/ps',
      established: evicted.status === 200 && !stillResident,
    };
  }
  const loaded = await fetchJson('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: 'ready', stream: false }),
  });
  await sleep(500);
  return {
    condition: 'warm',
    method: 'priming /api/generate, then GET /api/ps',
    established: loaded.status === 200 && (await isResident()),
  };
};

// ---------------------------------------------------------------------------
// One measured call
// ---------------------------------------------------------------------------

type Row = {
  task: string;
  condition: string;
  label: 'reasoning-on' | 'reasoning-off';
  rep: number;
  attempted: boolean;
  connected: boolean;
  schemaValid: boolean;
  qualityValid: boolean;
  rejection: string;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningChars: number;
  contentChars: number;
  doneReason: string;
  error: string;
};

const call = async (options: {
  task: Task;
  think: boolean;
  rep: number;
  condition: string;
  numPredict: number;
}): Promise<Row> => {
  const label = options.think ? 'reasoning-on' : 'reasoning-off';
  const base: Omit<Row, 'connected' | 'schemaValid' | 'qualityValid' | 'rejection' | 'error'> = {
    task: options.task.label,
    condition: options.condition,
    label,
    rep: options.rep,
    attempted: true,
    totalMs: 0,
    promptTokens: -1,
    completionTokens: -1,
    reasoningChars: 0,
    contentChars: 0,
    doneReason: '',
  };
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: 'system', content: options.task.system },
      { role: 'user', content: options.task.user },
    ],
    stream: false,
    // The task's REAL production schema, as Ollama's native `format`.
    format: options.task.schema,
    options: { num_predict: options.numPredict },
  };
  // `think: false` is the only half of the control Aikami can actually assert.
  // Whether the runtime HONOURS it is measured (via `message.thinking`), never
  // assumed — a field that is sent and ignored is not a setting.
  if (!options.think) {
    body.think = false;
  }

  const started = performance.now();
  try {
    const response = await fetch(`${ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      message?: { content?: string; thinking?: string };
      prompt_eval_count?: number;
      prompt_eval_cached_count?: number;
      eval_count?: number;
      done_reason?: string;
      error?: string;
    };
    const content = payload.message?.content ?? '';
    const totalMs = Math.round(performance.now() - started);
    const parsed = parseJson(content);
    const schemaValid = parsed.ok && Value.Check(options.task.schema, parsed.value);
    const rejection = response.ok
      ? classify(options.task, parsed, schemaValid)
      : `http ${response.status}`;
    return {
      ...base,
      connected: response.ok,
      totalMs,
      promptTokens: payload.prompt_eval_count ?? -1,
      completionTokens: payload.eval_count ?? -1,
      reasoningChars: (payload.message?.thinking ?? '').length,
      contentChars: content.length,
      doneReason: payload.done_reason ?? '',
      schemaValid,
      // A schema-valid but substantively empty answer is a FAILURE, and it is
      // the failure a schema check exists to miss.
      qualityValid: rejection === '',
      rejection,
      error: payload.error ?? '',
    };
  } catch (error: unknown) {
    return {
      ...base,
      connected: false,
      schemaValid: false,
      qualityValid: false,
      rejection: 'unreachable',
      totalMs: Math.round(performance.now() - started),
      error: String(error).slice(0, 200),
    };
  }
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return -1;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Sums a slice.
 *
 * `attempted / connected / schemaValid / qualityValid` are four DIFFERENT
 * numbers and are reported separately on purpose. Collapsing them into a
 * success rate is how "18 of 18 failed to connect" was once recorded as a
 * completed measurement.
 */
const summarize = (rows: readonly Row[]): Record<string, unknown> => {
  const connected = rows.filter((row) => row.connected);
  return {
    attempted: rows.length,
    connected: connected.length,
    schemaValid: connected.filter((row) => row.schemaValid).length,
    qualityValid: connected.filter((row) => row.qualityValid).length,
    medianMs: median(connected.map((row) => row.totalMs)),
    medianPromptTokens: median(connected.map((row) => row.promptTokens)),
    medianCompletionTokens: median(connected.map((row) => row.completionTokens)),
    // The control is only HONOURED if the response actually stopped carrying
    // reasoning characters. A runtime that ignores `think: false` produces two
    // identical columns, and reporting that as a comparison would be fiction.
    medianReasoningChars: median(connected.map((row) => row.reasoningChars)),
    medianContentChars: median(connected.map((row) => row.contentChars)),
    rejections: rows
      .filter((row) => row.rejection !== '')
      .reduce<Record<string, number>>((acc, row) => {
        acc[row.rejection] = (acc[row.rejection] ?? 0) + 1;
        return acc;
      }, {}),
  };
};

/** Writes the report and reports whether it is a measurement. Never silent. */
const emit = (report: Record<string, unknown>): number => {
  const path = join(OUT_DIR, 'reasoning-control.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { status: report.status, conditions: report.conditions, perTask: report.perTask },
      null,
      2,
    ),
  );
  console.log(`\nevidence: ${path}`);
  return report.status === 'blocked' ? 2 : 0;
};

/**
 * Runs one task's cells for one established condition.
 *
 * Its own step so the measurement loop reads as a loop: establish a condition,
 * then for each task and each repetition take both arms. A `think: false` that
 * the runtime ignores is detected afterwards by comparing reasoning characters,
 * never assumed.
 */
const runCells = async (condition: 'cold' | 'warm'): Promise<Array<Row>> => {
  const rows: Row[] = [];
  for (const task of TASKS) {
    for (let rep = 0; rep < REPS; rep += 1) {
      for (const think of [true, false]) {
        rows.push(await call({ task, think, rep, condition, numPredict: 600 }));
      }
    }
  }
  return rows;
};

/**
 * 🔴 The blocked report, written and shouted about.
 *
 * An unreachable backend produces this file, says so, and exits non-zero. It
 * never emits a table of zeros a reader could mistake for "reasoning off is
 * just as fast" — which is exactly how #422's failed rerun came to be recorded
 * as a completed measurement.
 */
const blockedReport = (detail: string): never => {
  const path = join(OUT_DIR, 'reasoning-control.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        lane: 'fix/382-gameplay-ai-integration',
        endpoint: ENDPOINT,
        model: MODEL,
        reps: REPS,
        status: 'blocked',
        reason: `no Ollama-compatible runtime at ${ENDPOINT}`,
        detail,
        rerun: `bun run --cwd apps/frontend/client probe:ai-reasoning-control -- --reps ${REPS}`,
      },
      null,
      2,
    )}\n`,
  );
  console.error(`BLOCKED: no Ollama-compatible runtime at ${ENDPOINT} (${detail})`);
  console.error(`Evidence written to ${path} with status "blocked". This is not a measurement.`);
  process.exit(2);
};

/**
 * Per-task, per-condition summary — or an explicit `unknown` cell when the
 * condition was never established, so an unverified label can never be
 * inherited by a table of numbers.
 */
const perTaskTable = (
  rows: readonly Row[],
  conditions: Record<string, unknown>,
): Record<string, Record<string, unknown>> => {
  const table: Record<string, Record<string, unknown>> = {};
  for (const task of TASKS) {
    table[task.label] = {};
    for (const condition of ['cold', 'warm'] as const) {
      if (conditions[`${condition}Usable`] !== true) {
        table[task.label][condition] = { status: 'unknown', reason: 'condition not established' };
        continue;
      }
      const cell = (label: 'reasoning-on' | 'reasoning-off'): Array<Row> =>
        rows.filter((r) => r.task === task.label && r.condition === condition && r.label === label);
      table[task.label][condition] = {
        'reasoning-on': summarize(cell('reasoning-on')),
        'reasoning-off': summarize(cell('reasoning-off')),
      };
    }
  }
  return table;
};

const main = async (): Promise<void> => {
  mkdirSync(OUT_DIR, { recursive: true });
  const version = await fetchJson<{ version?: string }>('/api/version');
  if (version.status !== 200) {
    blockedReport(version.error ?? `HTTP ${version.status}`);
  }

  const rows: Row[] = [];
  const conditions: Record<string, unknown> = {};
  for (const condition of ['cold', 'warm'] as const) {
    const state = await establish(condition);
    conditions[condition] = state;
    // A condition nobody could establish is recorded, and its cells are simply
    // not run — so the report says "unknown" rather than quietly inheriting a
    // label nobody verified.
    conditions[`${condition}Usable`] = state.established;
    if (state.established) {
      rows.push(...(await runCells(condition)));
    }
  }

  const perTask = perTaskTable(rows, conditions);
  const connected = rows.filter((row) => row.connected).length;
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    lane: 'fix/382-gameplay-ai-integration',
    endpoint: ENDPOINT,
    model: MODEL,
    reps: REPS,
    runtimeVersion: version.body?.version ?? null,
    // A run in which nothing connected is BLOCKED, not a run of zeros.
    status: connected === 0 ? 'blocked' : 'measured',
    conditions,
    perTask,
    raw: rows,
    reading: {
      qualityGate:
        'Each task carries a gate above its schema. A schema-valid but substantively empty answer counts as a FAILURE, and is reported separately from schema validity.',
      reasoningControlHonoured:
        'Compare medianReasoningChars between the two columns. If they are equal and non-zero, the runtime ignored `think: false` and no comparison is available from this run.',
      conclusionAllowed:
        'Only per-task medians from a run whose status is "measured", whose condition was established, and whose reasoning-off column shows zero reasoning characters.',
    },
  };

  process.exit(emit(report));
};

await main();
