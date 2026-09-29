// apps/e2e/scripts/ai_baseline_bench.ts
//
// Issue #382 AC-1: the reproducible before/after baseline.
//
// The issue's acceptance criterion is a "**reproducible** before/after report".
// A report is only reproducible if the thing that produced it can be re-run
// against a named model on named hardware, so this script is the deliverable
// and the markdown it writes is the artifact.
//
// 🔴 WHY THIS MEASURES AT THE WIRE, NOT ONLY IN THE CLIENT
//
// The natural place to read AI timings is the client's own telemetry buffer.
// That buffer cannot be used to compare against the issue's review baseline:
// `getTextTelemetry` did not exist before #410, so a baseline checkout has
// nothing to read. Anything measured that way could only ever be compared
// against itself.
//
// So the primary measurement here is deliberately commit-agnostic — every HTTP
// request the browser makes to the provider endpoint, with its wall-clock
// duration and its `usage` block. That number is observable from outside at
// ANY commit, which is what makes a before/after legitimate. The client
// telemetry buffer is read as a SECONDARY source for token provenance, cache
// layer and cost, and is explicitly allowed to be absent.
//
// Two independent sources are used on purpose: a client-side count and a
// wire-side count of the same work are both recorded, so a disagreement
// between them is visible rather than averaged away.
//
// Usage:
//   bun run --cwd apps/e2e bench:ai-baseline
//   bun run --cwd apps/e2e bench:ai-baseline -- --model ornith-1.5:9b --reps 5
//   bun run --cwd apps/e2e bench:ai-baseline -- --label pr-411 --skip-cold
//
// Requires: the client dev server (bun run herdr:start client) and an
// OpenAI-compatible text provider. Default endpoint is a local Ollama.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page, type Response } from 'playwright';
import { EMULATOR_PORTS } from '../src/config';

// ── Configuration ──────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const parseArgs = (
  argv: readonly string[],
): {
  endpoint: string;
  model: string;
  reps: number;
  batchSize: number;
  label: string;
  skipCold: boolean;
} => {
  const readFlag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    endpoint: readFlag('endpoint') ?? 'http://localhost:11434/v1',
    model: readFlag('model') ?? 'ornith-1.5:9b',
    reps: Number(readFlag('reps') ?? 5),
    batchSize: Number(readFlag('batch') ?? 6),
    label: readFlag('label') ?? 'current',
    skipCold: argv.includes('--skip-cold'),
  };
};

const CONFIG = parseArgs(process.argv.slice(2));
const GAME_URL = `http://localhost:${EMULATOR_PORTS.client}/game`;
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-baseline', CONFIG.label);

// ── Wire capture ───────────────────────────────────────────────────────────

/** One provider request as seen from outside the browser. */
type WireCall = {
  readonly url: string;
  readonly status: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly streamed: boolean;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cachedTokens?: number;
  /** Which response shape the token counts came from, when they were readable. */
  readonly usageShape?: 'openai' | 'ollama-native';
};

/**
 * Reads token counts out of whichever shape the provider replied with.
 *
 * The client does NOT necessarily use the OpenAI-compatible surface: the
 * `ollama` registry entry routes to Ollama's native `/api/chat`, which reports
 * `prompt_eval_count`/`eval_count` and has no `usage` block at all. A harness
 * that only understood `usage` would report zero tokens for every call and look
 * like it had measured token cost.
 *
 * Note what the native shape cannot give: Ollama's `/api/chat` response has no
 * cached-token field, so provider-side prefix-cache hits are UNOBSERVABLE on
 * this route. `cachedTokens` is therefore left undefined rather than guessed —
 * the same rule the client's own telemetry follows.
 */
const readUsage = (body: unknown, row: { -readonly [K in keyof WireCall]: WireCall[K] }): void => {
  const record = body as Record<string, unknown>;
  const usage = record.usage as Record<string, unknown> | undefined;
  if (usage !== undefined && usage !== null) {
    const details = usage.prompt_tokens_details as { cached_tokens?: number } | undefined;
    if (typeof usage.prompt_tokens === 'number') {
      row.promptTokens = usage.prompt_tokens;
    }
    if (typeof usage.completion_tokens === 'number') {
      row.completionTokens = usage.completion_tokens;
    }
    if (typeof details?.cached_tokens === 'number') {
      row.cachedTokens = details.cached_tokens;
    }
    row.usageShape = 'openai';
    return;
  }
  if (typeof record.prompt_eval_count === 'number') {
    row.promptTokens = record.prompt_eval_count;
    row.usageShape = 'ollama-native';
  }
  if (typeof record.eval_count === 'number') {
    row.completionTokens = record.eval_count;
  }
};

/**
 * Records provider responses and, where the body is readable, the provider's
 * own token accounting.
 *
 * Counts are what make cost and prefill measurable rather than guessed. When
 * the body cannot be read (a consumed SSE stream, say) the timing still stands
 * on its own — a row with no tokens is a gap in the token column, not a dropped
 * measurement.
 */
const attachWireCapture = (page: Page, endpointHost: string, sink: WireCall[]): void => {
  const pending = new Map<import('playwright').Request, number>();
  // Body reads are asynchronous, so the rows they enrich are not final until
  // these settle. `summarizeWire` awaits them; without that, the token columns
  // race the summary and silently read as zero.
  const bodyReads: Promise<void>[] = [];

  page.on('request', (request) => {
    if (request.url().includes(endpointHost)) {
      pending.set(request, performance.now());
    }
  });

  page.on('response', (response: Response) => {
    const startedAtMs = pending.get(response.request());
    if (startedAtMs === undefined) {
      return;
    }
    pending.delete(response.request());

    const headers = response.headers();
    const contentType = headers['content-type'] ?? '';
    const streamed = contentType.includes('event-stream');
    const row: {
      -readonly [K in keyof WireCall]: WireCall[K];
    } = {
      url: response.url(),
      status: response.status(),
      startedAtMs,
      durationMs: performance.now() - startedAtMs,
      streamed,
    };

    if (!streamed) {
      bodyReads.push(
        response
          .json()
          .then((body: unknown) => {
            readUsage(body, row);
          })
          .catch(() => undefined),
      );
    }

    sink.push(row as WireCall);
  });

  wireSettler.set(sink, () => Promise.all(bodyReads).then(() => undefined));
};

/**
 * Body-read completion per capture sink.
 *
 * Kept out of `attachWireCapture`'s return type because the handler is a void
 * event listener; the settle hook is what the summarizer awaits.
 */
const wireSettler = new WeakMap<WireCall[], () => Promise<void>>();

// ── Scenarios ──────────────────────────────────────────────────────────────

/** The production `extractStructure` surface the envelope task uses. */
const SYSTEM_PROMPT = 'Summarize the scene for a JRPG. JSON only.';

const SCENE_SENTENCE =
  'A hooded stranger steps into the tavern and asks about the missing caravan. ' +
  'The innkeeper goes quiet. Return a one-sentence summary and the mood. ';

/**
 * Builds a prompt of a chosen approximate character length.
 *
 * `identity` and `repeats` are separate on purpose. An earlier version folded
 * them into one index, which silently clamped every sweep point to the same
 * size and made the context-length scenario a flat line that looked like a
 * valid measurement of nothing.
 */
const dialoguePrompt = (options: { identity: number; repeats: number }): string =>
  `Turn ${options.identity}. ${SCENE_SENTENCE.repeat(options.repeats)}`;

const percentile = (values: readonly number[], fraction: number): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] as number);
};

/** The client-side view of a batch, as reported by the seam. */
type BatchClientReport = {
  readonly requestedCalls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly wallClockMs: number;
  readonly sampleResult: { readonly spansRecorded: number; readonly coalescedSpans: number };
};

/** Where the settle hook is keyed, so a summary can await outstanding bodies. */
type SettleableSink = { readonly rows: WireCall[]; readonly settle: () => Promise<void> };

const summarizeWire = async (sink: SettleableSink): Promise<Record<string, unknown>> => {
  await sink.settle();
  const rows = sink.rows;
  const durations = rows.map((row) => row.durationMs);
  const promptTokens = rows.flatMap((row) =>
    row.promptTokens === undefined ? [] : [row.promptTokens],
  );
  return {
    providerRequests: rows.length,
    failed: rows.filter((row) => row.status >= 400).length,
    medianMs: percentile(durations, 0.5) ?? 0,
    p95Ms: percentile(durations, 0.95) ?? 0,
    totalPromptTokens: promptTokens.reduce((sum, value) => sum + value, 0),
    totalCompletionTokens: rows.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0),
    totalCachedTokens: rows.reduce((sum, row) => sum + (row.cachedTokens ?? 0), 0),
    // If this is 0 the token columns are empty and the numbers above are not
    // measurements. Reported so a zero is never mistaken for a free call.
    rowsWithUsage: rows.filter((row) => row.promptTokens !== undefined).length,
    usageShapes: [...new Set(rows.map((row) => row.usageShape ?? 'none'))],
  };
};

// ── Provider configuration ─────────────────────────────────────────────────

/**
 * Points the client at the benchmark provider by writing a v3 config vault.
 *
 * `extractStructure` — the production surface this harness measures, and the
 * one the #411 in-flight coalescer guards — takes NO endpoint override. Unlike
 * the dev text sandbox's `streamChat`, it resolves its provider from the
 * user's configured connection. So a benchmark against it has to configure a
 * real connection, not pass a URL.
 *
 * The vault is AES-GCM under a per-origin secret in localStorage. The harness
 * does not need to know that secret in advance: it loads the app once (which
 * creates the secret), reads it back, encrypts the payload with the same
 * PBKDF2/AES-GCM parameters the client uses, and reloads. This is the client's
 * own storage format, written through the browser's own crypto — no test-only
 * bypass of the encryption boundary.
 */
const seedProviderConnection = async (page: Page): Promise<void> => {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    async (options) => {
      // `getVaultSecret` only runs on the client's first WRITE, so a fresh origin
      // has no secret yet. Generate one in the client's own format (32 random
      // bytes, hex) when it is missing, then use it for both sides.
      let secret = localStorage.getItem('aikami_vault_secret');
      if (secret === null) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('aikami_vault_secret', secret);
      }

      const providerId = '3f6a1c02-1111-4a5b-9c7d-000000000001';
      const connectionId = '3f6a1c02-2222-4a5b-9c7d-000000000002';
      const now = new Date().toISOString();
      const payload = {
        schemaVersion: 3,
        providers: [
          {
            id: providerId,
            registryId: 'ollama',
            label: 'Benchmark Ollama',
            baseUrl: options.endpoint,
            source: 'detected',
          },
        ],
        connections: [
          {
            id: connectionId,
            providerId,
            capability: 'text',
            label: 'Benchmark text',
            model: options.model,
            params: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 256,
              contextSize: 8192,
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        // Every text role points at the benchmark connection, so `dialogue` and
        // `envelope` tasks both resolve to it regardless of which task the
        // scenario under test uses.
        roles: {
          narration: connectionId,
          dialogue: connectionId,
          summarization: connectionId,
          structured: connectionId,
        },
        routing: { defaults: { text: connectionId }, overrides: {} },
      };

      // Same derivation the client uses: PBKDF2-SHA256 over the per-origin
      // secret, then AES-GCM-256, packed as base64(salt || iv || ciphertext).
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000, salt },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          encoder.encode(JSON.stringify(payload)),
        ),
      );
      const packed = new Uint8Array(salt.length + iv.length + ciphertext.length);
      packed.set(salt, 0);
      packed.set(iv, salt.length);
      packed.set(ciphertext, salt.length + iv.length);
      let binary = '';
      for (const byte of packed) {
        binary += String.fromCharCode(byte);
      }
      localStorage.setItem('aikami_vault_v3', btoa(binary));
    },
    { endpoint: CONFIG.endpoint, model: CONFIG.model },
  );

  console.log(`→ seeded provider vault (${CONFIG.model} @ ${CONFIG.endpoint})`);
};

// ── Environment manifest ───────────────────────────────────────────────────

const sh = (command: string, fallback = ''): string => {
  try {
    return execFileSync('sh', ['-lc', command], { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

/**
 * The manifest is what makes a number reproducible. A latency figure without
 * its hardware, model and quantization is not a baseline — it is a rumour.
 */
const collectEnvironment = async (): Promise<Record<string, unknown>> => {
  const ollamaBase = CONFIG.endpoint.replace(/\/v1\/?$/, '');
  const modelInfo = await fetch(`${ollamaBase}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: CONFIG.model }),
  })
    .then((response) => response.json() as Promise<Record<string, unknown>>)
    .catch(() => undefined);

  const modelEntry = (
    (
      await fetch(`${ollamaBase}/api/tags`)
        .then((response) => response.json() as Promise<{ models?: unknown[] }>)
        .catch(() => undefined)
    )?.models ?? []
  ).find((entry) => (entry as { name?: string }).name === CONFIG.model) as
    | {
        size?: number;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          context_length?: number;
        };
      }
    | undefined;

  return {
    measuredAt: new Date().toISOString(),
    gitSha: sh('git rev-parse HEAD'),
    gitDescribe: sh('git describe --always --dirty'),
    clientUrl: GAME_URL,
    endpoint: CONFIG.endpoint,
    model: CONFIG.model,
    modelDetails: modelInfo?.details,
    modelParameters: modelEntry?.details?.parameter_size,
    modelQuantization: modelEntry?.details?.quantization_level,
    modelContextLength: modelEntry?.details?.context_length,
    modelBytesOnDisk: modelEntry?.size,
    ollamaVersion: sh(`curl -s ${ollamaBase}/api/version | head -c 200`),
    cpuModel: sh("lscpu | sed -n 's/^Model name: *//p' | head -1"),
    cpuCores: sh('nproc'),
    totalMemoryGb: sh('awk \'/MemTotal/ {printf "%.1f", $2/1048576}\' /proc/meminfo'),
    gpu: sh("lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -2"),
    repetitions: CONFIG.reps,
    batchSize: CONFIG.batchSize,
  };
};

// ── Report rendering ───────────────────────────────────────────────────────

/** The markdown header: hardware and model identity for one run. */
const renderHeader = (report: Record<string, unknown>): string[] => {
  const environment = report.environment as Record<string, unknown>;
  const gigabytes = (Number(environment.modelBytesOnDisk) || 0) / 1e9;
  return [
    `# #382 AI baseline — \`${String(report.label)}\``,
    '',
    `**Commit:** \`${String(environment.gitSha)}\` (${String(environment.gitDescribe)})  `,
    `**Measured:** ${String(environment.measuredAt)}  `,
    `**Endpoint:** \`${String(environment.endpoint)}\`  `,
    `**Model:** \`${String(environment.model)}\` — ${String(environment.modelParameters)} `,
    `${String(environment.modelQuantization)}, ctx ${String(environment.modelContextLength)}, `,
    `${gigabytes.toFixed(1)}GB on disk  `,
    `**Hardware:** ${String(environment.cpuModel)} × ${String(environment.cpuCores)} cores, `,
    `${String(environment.totalMemoryGb)}GB RAM  `,
    `**GPU:** ${String(environment.gpu) || 'none detected'}  `,
    `**Repetitions:** ${String(environment.repetitions)} (batch ${String(environment.batchSize)})`,
  ];
};

/**
 * Renders one scenario's wire summary.
 *
 * "0 cached tokens" and "cached tokens are not reported on this route" are
 * different claims and only one can be true. The native Ollama chat response
 * carries no cached-token field at all, so a `0` there would be a fabricated
 * measurement of something the provider never said.
 */
const renderWireTable = (summary: Record<string, unknown>): string[] => {
  const shapes = (summary.usageShapes as string[] | undefined) ?? [];
  const cacheCell = shapes.includes('openai')
    ? String(summary.totalCachedTokens)
    : 'unobservable — provider reported no cached-token field on this route';
  return [
    '| metric | value |',
    '|---|---|',
    `| provider HTTP requests | ${String(summary.providerRequests)} |`,
    `| median | ${String(summary.medianMs)} ms |`,
    `| p95 | ${String(summary.p95Ms)} ms |`,
    `| prompt tokens | ${String(summary.totalPromptTokens)} |`,
    `| completion tokens | ${String(summary.totalCompletionTokens)} |`,
    `| provider-cached prompt tokens | ${cacheCell} |`,
    `| responses with token counts | ${String(summary.rowsWithUsage)} |`,
    `| token accounting shape | ${shapes.join(', ') || 'none'} |`,
    `| failed requests | ${String(summary.failed)} |`,
  ];
};

/** Renders the client's own view of a scenario, when the seam reported one. */
const renderClientRows = (extra: Record<string, unknown> | undefined): string[] => {
  if (extra === undefined) {
    return [];
  }
  return Object.entries(extra).map(([key, value]) => `| client ${key} | ${String(value)} |`);
};

/** Renders the per-size breakdown of the context sweep, when present. */
const renderSizeRows = (bySize: Record<string, unknown>[] | undefined): string[] => {
  if (bySize === undefined) {
    return [];
  }
  return [
    '',
    '| prompt repeats | median ms | prompt tokens | completion tokens |',
    '|---|---|---|---|',
    ...bySize.map(
      (point) =>
        `| ${String(point.promptRepeats)} | ${String(point.medianMs)} | ` +
        `${String(point.totalPromptTokens)} | ${String(point.totalCompletionTokens)} |`,
    ),
  ];
};

const renderMarkdown = (report: Record<string, unknown>): string => {
  const scenarios = report.scenarios as Record<string, Record<string, unknown>>;
  const lines: string[] = [...renderHeader(report), '', '## Scenarios', ''];

  for (const [id, scenario] of Object.entries(scenarios)) {
    lines.push(
      `### ${id}`,
      '',
      `${String(scenario.description)}`,
      '',
      ...renderWireTable(scenario.wire as Record<string, unknown>),
      ...renderClientRows(scenario.client as Record<string, unknown> | undefined),
      ...renderSizeRows(scenario.bySize as Record<string, unknown>[] | undefined),
      '',
    );
  }

  return `${lines.join('\n')}\n`;
};

// ── Main ───────────────────────────────────────────────────────────────────

const requireReachable = async (url: string, what: string): Promise<void> => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    throw new Error(
      `${what} is not reachable at ${url}. Start it first, e.g. \`bun run herdr:start client\`.`,
    );
  }
};

const main = async (): Promise<void> => {
  await requireReachable(`http://localhost:${EMULATOR_PORTS.client}/`, 'The client');
  await requireReachable(`${CONFIG.endpoint}/models`, 'The text provider');

  const environment = await collectEnvironment();
  const wire: WireCall[] = [];
  const scenarios: Record<string, Record<string, unknown>> = {};

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  attachWireCapture(page, new URL(CONFIG.endpoint).host, wire);

  // A scenario is a SLICE of the wire log plus the settle hook, so a summary
  // can wait for that slice's response bodies instead of racing them.
  const settle = wireSettler.get(wire) ?? ((): Promise<void> => Promise.resolve());
  const markStart = (): number => wire.length;
  const slice = (from: number): SettleableSink => ({
    rows: wire.slice(from),
    settle: () => Promise.all([settle()]).then(() => undefined),
  });

  console.log(`→ booting ${GAME_URL} …`);
  await seedProviderConnection(page);
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  // Wait for the BENCHMARK seam, not the telemetry seam. `getTextTelemetry` was
  // added by #410 and does not exist on the review baseline, so waiting for it
  // would make this harness unable to run against the very commit it compares
  // to. `benchmarkIdenticalStructuredBatch` is the one method that is present
  // at every commit, because it is instrumentation, not product code.
  await page.waitForFunction(
    () =>
      typeof (
        window as unknown as { __AIKAMI_TEST__?: { benchmarkIdenticalStructuredBatch?: unknown } }
      ).__AIKAMI_TEST__?.benchmarkIdenticalStructuredBatch === 'function',
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(2000);

  // Writing the vault is not enough: `configService.load()` is what turns the
  // stored payload into resolvable connections. Current `main` calls it during
  // app init; the review baseline does not, so every call there would fail
  // with "no text generation provider configured". `loadTextProviderConfig` is
  // present on both sides (harmless where boot already loaded it) and puts both
  // commits into the SAME starting state: one loaded Ollama text connection.
  // Without this the comparison would measure the two commits' boot wiring
  // rather than their AI request path.
  await page.evaluate(async () => {
    const seam = (
      window as unknown as {
        __AIKAMI_TEST__?: { loadTextProviderConfig?(): Promise<void> };
      }
    ).__AIKAMI_TEST__;
    await seam?.loadTextProviderConfig?.();
  });
  await page.waitForTimeout(500);
  console.log('→ provider config loaded');

  // Routing is only recorded once a call has actually resolved, so this is
  // read at the END of the run rather than here.

  // ── S1: cold start (model not resident) ──────────────────────────────
  if (!CONFIG.skipCold) {
    const ollamaBase = CONFIG.endpoint.replace(/\/v1\/?$/, '');
    await fetch(`${ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model, keep_alive: 0 }),
    }).catch(() => undefined);
    console.log('→ S1 cold start (model evicted) …');
    const from = markStart();
    await page.evaluate(
      (input) =>
        (
          window as unknown as {
            __AIKAMI_TEST__: {
              benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
            };
          }
        ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(input),
      {
        count: 1,
        prompt: dialoguePrompt({ identity: 1, repeats: 1 }),
        systemPrompt: SYSTEM_PROMPT,
        schemaName: 'SceneEnvelope',
      },
    );
    scenarios['S1 cold-start'] = {
      description: 'First call after evicting the model: load + prefill + generate.',
      wire: await summarizeWire(slice(from)),
    };
  }

  // ── S2: warm sequential (the ordinary turn) ──────────────────────────
  console.log(`→ S2 warm sequential ×${CONFIG.reps} …`);
  {
    const from = markStart();
    for (let index = 0; index < CONFIG.reps; index++) {
      await page.evaluate(
        (input) =>
          (
            window as unknown as {
              __AIKAMI_TEST__: {
                benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
              };
            }
          ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(input),
        {
          count: 1,
          prompt: dialoguePrompt({ identity: index + 2, repeats: 1 }),
          systemPrompt: SYSTEM_PROMPT,
          schemaName: 'SceneEnvelope',
        },
      );
    }
    scenarios['S2 warm-sequential'] = {
      description: 'Sequential distinct calls — the shape of ordinary play.',
      wire: await summarizeWire(slice(from)),
    };
  }

  // ── S3: context-length sweep (prefill scaling) ───────────────────────
  console.log('→ S3 context sweep …');
  {
    const from = markStart();
    const rows: Record<string, unknown>[] = [];
    // Each point is repeated and MEDIANED. A single sample per size on a 9B
    // CPU model is dominated by decode noise — an early run produced a
    // non-monotonic curve that looked like a real measurement of nothing.
    for (const repeats of [1, 4, 16, 64]) {
      const pointFrom = markStart();
      for (let sample = 0; sample < 3; sample++) {
        await page.evaluate(
          (input) =>
            (
              window as unknown as {
                __AIKAMI_TEST__: {
                  benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
                };
              }
            ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(input),
          {
            count: 1,
            // Identity varies per sample so the provider's own prefix cache is
            // not what is being timed; the SIZE is the variable under test.
            prompt: dialoguePrompt({ identity: 1000 + repeats * 10 + sample, repeats }),
            systemPrompt: SYSTEM_PROMPT,
            schemaName: 'SceneEnvelope',
          },
        );
      }
      const point = await summarizeWire(slice(pointFrom));
      rows.push({ promptRepeats: repeats, ...point });
    }
    scenarios['S3 context-sweep'] = {
      description: 'Growing prompt against a warm model — prefill scaling.',
      wire: await summarizeWire(slice(from)),
      bySize: rows,
    };
  }

  // ── S4: identical concurrent structured calls (the #411 axis) ─────────
  console.log(`→ S4 identical-concurrent ×${CONFIG.batchSize} …`);
  {
    const from = markStart();
    const client = (await page.evaluate(
      (input) =>
        (
          window as unknown as {
            __AIKAMI_TEST__: {
              benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
            };
          }
        ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(input),
      {
        count: CONFIG.batchSize,
        prompt: dialoguePrompt({ identity: 3, repeats: 1 }),
        systemPrompt: SYSTEM_PROMPT,
        schemaName: 'SceneEnvelope',
      },
    )) as BatchClientReport;
    const scenario = slice(from);
    scenarios['S4 identical-concurrent'] = {
      description:
        `${CONFIG.batchSize} byte-identical structured calls fired at once. Provider ` +
        'requests below the requested count mean the client collapsed them.',
      wire: await summarizeWire(scenario),
      client: {
        requestedCalls: client.requestedCalls,
        succeededCalls: client.succeededCalls,
        wallClockMs: Math.round(client.wallClockMs),
        spansRecorded: client.sampleResult.spansRecorded,
        coalescedSpans: client.sampleResult.coalescedSpans,
      },
    };
  }

  // ── S5: distinct concurrent calls (local throughput) ─────────────────
  console.log(`→ S5 distinct-concurrent ×${CONFIG.batchSize} …`);
  {
    const from = markStart();
    const startedAt = Date.now();
    await Promise.all(
      Array.from({ length: CONFIG.batchSize }, (_, index) =>
        page.evaluate(
          (input) =>
            (
              window as unknown as {
                __AIKAMI_TEST__: {
                  benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
                };
              }
            ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(input),
          {
            count: 1,
            prompt: dialoguePrompt({ identity: index + 20, repeats: 1 }),
            systemPrompt: SYSTEM_PROMPT,
            schemaName: 'SceneEnvelope',
          },
        ),
      ),
    );
    scenarios['S5 distinct-concurrent'] = {
      description:
        `${CONFIG.batchSize} DIFFERENT calls at once. The issue warns against assuming ` +
        'more parallel local requests are faster; sum-of-call-time vs wall clock shows it.',
      wire: await summarizeWire(slice(from)),
      client: { wallClockMs: Date.now() - startedAt },
    };
  }

  // ── Client telemetry (secondary; absent before #410) ─────────────────
  const telemetry = (await page.evaluate(() => {
    const seam = (
      window as unknown as {
        __AIKAMI_TEST__?: {
          getTextTelemetry?(): { spans: unknown[]; summary: unknown };
          getResolvedTextRouting?(): { provider: string; model: string; endpoint: string };
        };
      }
    ).__AIKAMI_TEST__;
    if (seam?.getTextTelemetry === undefined) {
      return { absent: true as const };
    }
    // The buffer is Svelte `$state` (a reactive Proxy); round-tripping through
    // JSON inside the page yields plain data Playwright can serialize.
    return {
      absent: false as const,
      data: JSON.parse(
        JSON.stringify({
          telemetry: seam.getTextTelemetry(),
          routing: seam.getResolvedTextRouting?.(),
        }),
      ),
    };
  })) as
    | { absent: true }
    | {
        absent: false;
        data: {
          telemetry: { spans: Record<string, unknown>[]; summary: Record<string, unknown> };
          routing: Record<string, string> | undefined;
        };
      };

  await browser.close();

  const report: Record<string, unknown> = {
    label: CONFIG.label,
    environment,
    scenarios,
    clientTelemetry: telemetry.absent
      ? {
          note:
            'absent at this commit — the #382 P0 telemetry seam (getTextTelemetry) does not ' +
            'exist here, so token provenance, cache layer and cost are unavailable. The wire ' +
            'measurements above are unaffected.',
        }
      : telemetry.data,
    wireCalls: wire,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(OUT_DIR, 'report.md'), renderMarkdown(report));

  console.log(`\n✓ wrote ${join(OUT_DIR, 'report.md')}`);
  for (const [id, scenario] of Object.entries(scenarios)) {
    const summary = scenario.wire as Record<string, number>;
    console.log(
      `  ${id.padEnd(26)} ${String(summary.providerRequests).padStart(3)} req  ` +
        `median ${String(summary.medianMs).padStart(6)}ms  p95 ${String(summary.p95Ms).padStart(6)}ms`,
    );
  }
};

await main();
