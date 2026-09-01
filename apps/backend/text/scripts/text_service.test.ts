// apps/backend/text/scripts/text_service.test.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI test harness — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: llama-server OpenAI-compatible API uses snake_case fields */
// Integration tests for the llama-server text inference service (C-392).
// Checks if herdr text is active; if not, spawns it, waits for readiness,
// runs health/model/generation checks, and stops only if started by us.
//
// Protocol (llama-server, OpenAI-compatible):
//   readiness:  GET  /health
//   model list: GET  /v1/models
//   generate:   POST /v1/chat/completions
//
// Usage:
//   bun test scripts/text_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

// Base port is 11434 (AC-3). A host with a system-wide Ollama service on
// 11434 cannot free the port without admin rights; TEXT_PORT overrides the
// probe port AND starts the compose profile directly on the override (the
// same `docker compose --profile text` invocation herdr runs).
const DEFAULT_PORT = 11434;
const LLAMA_PORT = Number(process.env.TEXT_PORT ?? DEFAULT_PORT);
const BASE_URL = `http://127.0.0.1:${LLAMA_PORT}`;
const LOCAL_STACK_DIR = resolve(ROOT, 'apps/backend/local-stack');
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 180_000;

// ── Types ───────────────────────────────────────────────────

type ModelEntry = {
  id: string;
};

type ModelListResponse = {
  data: ModelEntry[];
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;
let modelsAvailable: ModelEntry[] = [];

// ── Readiness ───────────────────────────────────────────────

/**
 * Check if llama-server is reachable and serving.
 * GET /health returns 200 once the server is ready (Ollama's root banner
 * and /api/tags are gone — the pre-C-392 endpoints do not exist here).
 */
const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return { ok: true, detail: '/health OK' };
    }
    return { ok: false, detail: `/health returned ${response.status}` };
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes('refused') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Unable to connect')
    ) {
      return { ok: false, detail: 'connection refused' };
    }
    return { ok: false, detail: message.slice(0, 80) };
  }
};

const waitForReady = async (timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = '';
  let wasEverReachable = false;

  while (Date.now() < deadline) {
    const result = await isReady();
    if (result.ok) {
      console.log(`  ✓ Ready (${result.detail})`);
      return;
    }

    if (
      !wasEverReachable &&
      !result.detail.includes('refused') &&
      !result.detail.includes('Unable to connect')
    ) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      if (
        wasEverReachable &&
        (result.detail.includes('refused') || result.detail.includes('Unable to connect'))
      ) {
        throw new Error(
          'llama-server crashed after becoming reachable — check herdr tab logs for the error',
        );
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(
    `llama-server did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`,
  );
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
}, STARTUP_TIMEOUT_MS + 30_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ text was already running — leaving it alone');
    return;
  }

  console.log('  Stopping text service...');
  if (LLAMA_PORT !== DEFAULT_PORT) {
    await $`TEXT_PORT=${LLAMA_PORT} docker compose --profile text down`
      .cwd(LOCAL_STACK_DIR)
      .nothrow();
  } else {
    await $`bun run herdr:stop text`.cwd(ROOT).nothrow();
  }
  console.log('✓ text stopped');
});

// ── Top-level await: Discover models for skip logic ─────────

const ready = await isReady();
if (!ready.ok) {
  console.log('○ text not running — starting for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  let startResult: { exitCode: number; stderr: { toString(): string } };
  if (LLAMA_PORT !== DEFAULT_PORT) {
    // Port override: a system service holds the base port — start the
    // compose profile directly on the override port.
    console.log(`  Starting compose profile text on :${LLAMA_PORT} (TEXT_PORT override)`);
    startResult = await $`TEXT_PORT=${LLAMA_PORT} docker compose --profile text up -d`
      .cwd(LOCAL_STACK_DIR)
      .nothrow();
  } else {
    startResult = await $`bun run herdr:start text`.cwd(ROOT).nothrow();
  }

  if (startResult.exitCode !== 0) {
    console.error('start failed:', startResult.stderr?.toString());
    throw new Error('Failed to start text service');
  }

  startedByUs = true;
  console.log('  Waiting for llama-server to become ready...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ text already running (${ready.detail})`);
}

// Now discover models
try {
  const modelsResponse = await fetch(`${BASE_URL}/v1/models`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (modelsResponse.ok) {
    const modelsData = (await modelsResponse.json()) as ModelListResponse;
    modelsAvailable = modelsData.data ?? [];
  }
} catch (err) {
  console.warn('  ⚠ Failed to discover models:', (err as Error).message);
}

if (modelsAvailable.length === 0) {
  console.warn('  ⚠ No models available — generation test will be skipped');
  console.warn('    Fetch models first: cd apps/backend/local-stack && bun run fetch-models');
}

// ── Tests ───────────────────────────────────────────────────

describe('llama-server text inference service', () => {
  test('/health reports readiness', async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    console.log(`  /health: ${response.status}`);
  });

  test('/v1/models lists available models', async () => {
    const response = await fetch(`${BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as ModelListResponse;
    expect(data.data).toBeArray();

    console.log(`  ${data.data.length} model(s) found`);
    for (const model of data.data) {
      expect(model.id).toBeString();
      console.log(`    • ${model.id}`);
    }
  });

  test.skipIf(modelsAvailable.length === 0)(
    '/v1/chat/completions returns a response (super lite)',
    async () => {
      const model = modelsAvailable[0]?.id as string;
      console.log(`  Model:   ${model}`);

      const t0 = Date.now();
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "OK"' }],
          max_tokens: 16,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const wallMs = Date.now() - t0;

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Model '${model}' failed (HTTP ${response.status}):\n${errorBody.slice(0, 300)}`,
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;

      if (data.error?.message) {
        throw new Error(`Model '${model}' error: ${data.error.message}`);
      }

      const content = data.choices?.[0]?.message?.content ?? '';
      expect(content.length).toBeGreaterThan(0);

      console.log(`  Output:  "${content.trim()}"`);
      console.log(`  Wall:    ${wallMs}ms`);
      if (data.usage) {
        console.log(`  Tokens:  ${data.usage.total_tokens ?? '?'} total`);
      }
    },
    120_000,
  );

  test('check_health names the endpoint when the wrong engine answers', async () => {
    // Serve a fake Ollama banner on a random port — llama-server's /health
    // is absent there, so the probe must fail naming the endpoint + engine.
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === '/') {
          return new Response('Ollama is running', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
    });
    try {
      const run = await $`bun run scripts/check_health.ts --port ${server.port}`
        .cwd(PROJECT_DIR)
        .nothrow();
      expect(run.exitCode).not.toBe(0);
      const out = run.stdout.toString() + run.stderr.toString();
      expect(out).toContain('/health');
      expect(out).toContain('llama-server');
    } finally {
      server.stop();
    }
  }, 30_000);
});
